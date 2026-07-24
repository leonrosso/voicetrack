"""
VoiceTrack — Google Sheets Client
Gestisce lettura e scrittura dei dati pasto su Google Sheets,
piu' la tab di configurazione con i target giornalieri.
"""

import json
import os
import threading
import time
import uuid
from datetime import datetime, date, timedelta, timezone

# Calendario Italia per valid_from / target_for (CF gira in UTC).
_TZ_ITALY = timezone(timedelta(hours=2))


def _today_italy() -> date:
    return datetime.now(_TZ_ITALY).date()

from google.oauth2 import service_account
from googleapiclient.discovery import build

# --- Configurazione ---
# Il JSON delle credenziali del Service Account puo' essere:
# 1. Un file path (per sviluppo locale)
# 2. Una stringa JSON nella variabile d'ambiente (per Cloud Functions)
CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
CREDENTIALS_FILE = os.environ.get("GOOGLE_CREDENTIALS_FILE", "credentials.json")
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "")
SHEET_NAME = os.environ.get("SHEET_NAME", "Pasti")
CONFIG_SHEET_NAME = os.environ.get("CONFIG_SHEET_NAME", "Config")
TARGET_HISTORY_SHEET_NAME = os.environ.get("TARGET_HISTORY_SHEET_NAME", "TargetHistory")
CATALOG_SHEET_NAME = os.environ.get("CATALOG_SHEET_NAME", "Catalogo")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Colonne del foglio pasti (ordine fisso)
# A: timestamp | B: alimento | C: grammi | D: kcal | E: proteine | F: carboidrati
# | G: grassi | H: fonte | I: note | J: id | K: data_dichiarata | L: tipo_pasto
# NB: `id`, `data_dichiarata` e `tipo_pasto` sono IN CODA di proposito. Le righe
# storiche (senza J/K/L) restano leggibili: id="", data_dichiarata=timestamp,
# tipo_pasto → fallback sull'ora.
COLUMNS = [
    "timestamp", "alimento", "grammi", "kcal", "proteine", "carboidrati",
    "grassi", "fonte", "note", "id", "data_dichiarata", "tipo_pasto",
]

# Range completo dello schema pasti (A..L). Usato ovunque si legga/scriva il
# foglio: aggiornare qui se un giorno si aggiungono colonne.
_SHEET_RANGE = "A:L"

# Valori ammessi per tipo_pasto (colonna L + campo LLM / client).
PASTO_TYPES = ("colazione", "pranzo", "spuntino", "cena")

# Target di default usati quando la tab Config viene creata la prima volta.
DEFAULT_TARGETS = {"kcal": 2200, "proteine": 165, "carboidrati": 220, "grassi": 70}
_TARGET_KEYS = ["kcal", "proteine", "carboidrati", "grassi"]

# Etichette giorni settimana in italiano (lunedi' = 0, come datetime.weekday()).
WEEKDAY_IT = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]

# Etichette mesi in italiano (gennaio = 0).
MONTH_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]

# Cache dei titoli delle tab esistenti, valida per la durata dell'istanza "calda"
# della Cloud Function (si azzera ad ogni nuovo deploy o cold start).
_sheet_titles_cache = None

# Cache pasti in-memory (istanza CF): TTL allineato al poll PWA; single-flight
# cosi' 3× /daily_summary paralleli condividono una sola values().get.
_MEALS_CACHE_TTL_S = 20
_meals_cache_rows = None  # list[dict] | None
_meals_cache_at = 0.0
_meals_cache_lock = threading.Lock()
_meals_inflight = None  # threading.Event set when fetch done; result in _meals_inflight_result
_meals_inflight_result = None
_meals_inflight_error = None


def _invalidate_meals_cache():
    """Azzera la cache pasti dopo append/update/delete."""
    global _meals_cache_rows, _meals_cache_at
    with _meals_cache_lock:
        _meals_cache_rows = None
        _meals_cache_at = 0.0


# Cache target Config (istanza CF): stesso TTL/single-flight dei pasti.
_CONFIG_CACHE_TTL_S = 20
_config_cache_targets = None  # dict | None
_config_cache_at = 0.0
_config_cache_lock = threading.Lock()
_config_inflight = None
_config_inflight_result = None
_config_inflight_error = None

# Cache storia target (stesso TTL; invalidata insieme a Config).
_history_cache_rows = None  # list[dict] | None
_history_cache_at = 0.0


def _invalidate_config_cache():
    """Azzera la cache target + storia dopo set_config_targets."""
    global _config_cache_targets, _config_cache_at
    global _history_cache_rows, _history_cache_at
    with _config_cache_lock:
        _config_cache_targets = None
        _config_cache_at = 0.0
        _history_cache_rows = None
        _history_cache_at = 0.0


class SheetConfigError(Exception):
    """Sollevata quando SHEET_NAME non corrisponde a nessuna tab reale dello spreadsheet."""
    pass


# ---------------------------------------------------------------------------
# Autenticazione
# ---------------------------------------------------------------------------
def _get_sheets_service():
    """Crea e ritorna il servizio Google Sheets autenticato."""
    if CREDENTIALS_JSON:
        creds_dict = json.loads(CREDENTIALS_JSON)
        creds = service_account.Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    else:
        creds = service_account.Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)

    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return service.spreadsheets()


# ---------------------------------------------------------------------------
# Gestione tab
# ---------------------------------------------------------------------------
def _get_titles(sheets, force_refresh=False):
    """Ritorna la lista dei titoli delle tab, con cache di istanza."""
    global _sheet_titles_cache
    if _sheet_titles_cache is None or force_refresh:
        metadata = sheets.get(
            spreadsheetId=SPREADSHEET_ID,
            fields="sheets.properties.title"
        ).execute()
        _sheet_titles_cache = [s["properties"]["title"] for s in metadata.get("sheets", [])]
    return _sheet_titles_cache


def _get_sheet_id(sheets, title):
    """
    Ritorna il sheetId (gid) numerico della tab `title`, necessario per le
    operazioni strutturali come deleteDimension (che lavorano sul gid, non sul
    nome). Solleva SheetConfigError se la tab non esiste.
    """
    metadata = sheets.get(
        spreadsheetId=SPREADSHEET_ID,
        fields="sheets.properties(sheetId,title)"
    ).execute()
    for s in metadata.get("sheets", []):
        props = s["properties"]
        if props.get("title") == title:
            return props.get("sheetId")
    raise SheetConfigError(f"Impossibile trovare il gid della tab '{title}'.")


def _verify_sheet_exists(sheets):
    """
    Controlla che la tab SHEET_NAME (foglio pasti) esista davvero.
    Se non esiste, solleva SheetConfigError con un messaggio esplicito.
    """
    titles = _get_titles(sheets)
    if SHEET_NAME not in titles:
        disponibili = ", ".join(titles) or "nessuna tab trovata"
        raise SheetConfigError(
            f"Il foglio '{SHEET_NAME}' non esiste in questo spreadsheet. "
            f"Tab disponibili: {disponibili}"
        )


def _ensure_config_sheet(sheets):
    """
    Assicura che la tab CONFIG_SHEET_NAME esista. Se manca, la crea e ci
    scrive i target di default. Ritorna True se l'ha appena creata.
    """
    global _sheet_titles_cache
    titles = _get_titles(sheets)
    if CONFIG_SHEET_NAME in titles:
        return False

    # Crea la tab
    sheets.batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{"addSheet": {"properties": {"title": CONFIG_SHEET_NAME}}}]}
    ).execute()
    _sheet_titles_cache = None  # invalida la cache: la lista tab e' cambiata

    # Scrivi i default (layout fisso, senza header: chiave in A, valore in B)
    _write_targets(sheets, DEFAULT_TARGETS)
    return True


def sheet_health() -> bool:
    """
    Check leggero per l'endpoint /health: verifica che la tab pasti esista.
    Ritorna True/False, non solleva mai (il chiamante non deve esplodere).
    Sfrutta la cache dei titoli: a istanza calda non costa una chiamata API.
    """
    try:
        sheets = _get_sheets_service()
        _verify_sheet_exists(sheets)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Derivazione pasto / helper
# ---------------------------------------------------------------------------
def pasto_from_hour(hour: int) -> str:
    """Deriva la categoria del pasto dall'ora (fasce pensate per abitudini IT)."""
    if 5 <= hour < 11:
        return "colazione"
    if 11 <= hour < 15:
        return "pranzo"
    if 15 <= hour < 19:
        return "spuntino"
    return "cena"


def normalize_tipo_pasto(value) -> str | None:
    """
    Normalizza un tipo pasto dichiarato (voce/LLM/client) ai valori canonici.
    Ritorna None se assente o non riconosciuto (→ fallback sull'ora in lettura).
    """
    if value in (None, "", "null"):
        return None
    v = str(value).strip().lower()
    if v in PASTO_TYPES:
        return v
    if v == "merenda":
        return "spuntino"
    return None


def _to_float(value) -> float:
    """Converte un valore a float in modo sicuro (gestisce la virgola decimale IT)."""
    try:
        if isinstance(value, str):
            value = value.replace(",", ".")
        return round(float(value), 1)
    except (ValueError, TypeError):
        return 0.0


# ---------------------------------------------------------------------------
# Scrittura pasti
# ---------------------------------------------------------------------------
def append_meal_rows(
    items: list[dict],
    recorded_at: datetime,
    declared_at: datetime | None = None,
    fonte: str = "tasker-voce",
    tipo_pasto: str | None = None,
):
    """
    Appende una o piu' righe al foglio pasti.

    Args:
        items: Lista di dict con alimento, grammi, kcal, proteine, carboidrati, grassi
        recorded_at: Quando il pasto e' stato registrato (colonna timestamp)
        declared_at: Giorno del pasto (colonna data_dichiarata). Se None, coincide
                     con recorded_at.
        fonte: Origine del dato: "tasker-voce" | "pwa-voce" | "pwa-barcode"
               ("voce"/"barcode" restano validi per retrocompatibilita')
        tipo_pasto: Se dichiarato a voce/client (colazione|pranzo|spuntino|cena),
                    scritto in L; se None, L resta vuoto e in lettura si usa l'ora.
    """
    sheets = _get_sheets_service()
    _verify_sheet_exists(sheets)

    if declared_at is None:
        declared_at = recorded_at

    ts_str = recorded_at.strftime("%Y-%m-%d %H:%M:%S")
    declared_str = declared_at.strftime("%Y-%m-%d %H:%M:%S")
    tipo_str = normalize_tipo_pasto(tipo_pasto) or ""

    rows = []
    for item in items:
        rows.append([
            ts_str,
            item.get("alimento", ""),
            item.get("grammi", 0),
            item.get("kcal", 0),
            item.get("proteine", 0),
            item.get("carboidrati", 0),
            item.get("grassi", 0),
            fonte,
            "",                 # note
            str(uuid.uuid4()),  # id: UUID stabile per tap-to-edit / swipe-to-delete
            declared_str,       # data_dichiarata (giorno del pasto)
            tipo_str,           # tipo_pasto (vuoto → fallback ora in lettura)
        ])

    sheets.values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!{_SHEET_RANGE}",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows}
    ).execute()
    _invalidate_meals_cache()


# ---------------------------------------------------------------------------
# Lettura pasti
# ---------------------------------------------------------------------------
def _parse_row(row: list) -> dict | None:
    """Converte una riga grezza del foglio in un dict, o None se non valida."""
    if not row or len(row) < 7:
        return None
    ts = str(row[0]).strip()
    if len(ts) < 16:
        return None
    # Giorno pasto: data_dichiarata (K) se presente, altrimenti timestamp (legacy).
    declared_raw = str(row[10]).strip() if len(row) > 10 else ""
    meal_ts = declared_raw if len(declared_raw) >= 16 else ts
    time_str = meal_ts[11:16]  # HH:MM
    try:
        hour = int(meal_ts[11:13])
    except (ValueError, IndexError):
        hour = 12
    # Tipo pasto: colonna L se dichiarata, altrimenti euristica sull'ora.
    raw_tipo = str(row[11]).strip() if len(row) > 11 else ""
    tipo = normalize_tipo_pasto(raw_tipo)
    return {
        "timestamp": ts,
        "data_dichiarata": meal_ts,
        "date": meal_ts[:10],
        "time": time_str,
        "pasto": tipo or pasto_from_hour(hour),
        "tipo_pasto": tipo or "",
        "alimento": row[1] if len(row) > 1 else "",
        "grammi": _to_float(row[2]) if len(row) > 2 else 0,
        "kcal": _to_float(row[3]) if len(row) > 3 else 0,
        "proteine": _to_float(row[4]) if len(row) > 4 else 0,
        "carboidrati": _to_float(row[5]) if len(row) > 5 else 0,
        "grassi": _to_float(row[6]) if len(row) > 6 else 0,
        "fonte": row[7] if len(row) > 7 else "",
        "note": row[8] if len(row) > 8 else "",
        # id assente sulle righe storiche → "" (tollerato in lettura, §5.1)
        "id": row[9] if len(row) > 9 else "",
    }


def _fetch_all_meal_rows_uncached() -> list[dict]:
    """Lettura Sheets completa + parse (nessuna cache)."""
    sheets = _get_sheets_service()
    _verify_sheet_exists(sheets)

    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!{_SHEET_RANGE}"
    ).execute()

    meals = []
    for row in result.get("values", []):
        parsed = _parse_row(row)
        if parsed:
            meals.append(parsed)
    return meals


def get_all_meal_rows() -> list[dict]:
    """
    Legge e parsa TUTTE le righe del foglio pasti.
    Cache TTL 20s + single-flight: N request parallele → una sola values().get.
    """
    global _meals_cache_rows, _meals_cache_at
    global _meals_inflight, _meals_inflight_result, _meals_inflight_error

    now = time.monotonic()
    with _meals_cache_lock:
        if (
            _meals_cache_rows is not None
            and (now - _meals_cache_at) < _MEALS_CACHE_TTL_S
        ):
            return list(_meals_cache_rows)

        if _meals_inflight is not None:
            waiter = _meals_inflight
            is_leader = False
        else:
            waiter = threading.Event()
            _meals_inflight = waiter
            _meals_inflight_result = None
            _meals_inflight_error = None
            is_leader = True

    if not is_leader:
        waiter.wait(timeout=55)
        with _meals_cache_lock:
            if _meals_inflight_error is not None:
                raise _meals_inflight_error
            if _meals_inflight_result is not None:
                return list(_meals_inflight_result)
            # Timeout / race: ricadi su fetch diretto (raro)
        return _fetch_all_meal_rows_uncached()

    try:
        meals = _fetch_all_meal_rows_uncached()
        with _meals_cache_lock:
            _meals_cache_rows = meals
            _meals_cache_at = time.monotonic()
            _meals_inflight_result = meals
            _meals_inflight_error = None
        return list(meals)
    except Exception as e:
        with _meals_cache_lock:
            _meals_inflight_error = e
            _meals_inflight_result = None
        raise
    finally:
        with _meals_cache_lock:
            done = _meals_inflight
            _meals_inflight = None
        if done is not None:
            done.set()


def get_today_rows(target_date: date) -> list[dict]:
    """Ritorna le righe di una data specifica (usa la lettura completa)."""
    prefix = target_date.strftime("%Y-%m-%d")
    return [m for m in get_all_meal_rows() if m["date"] == prefix]


def get_weekly_totals(end_date: date, days: int = 7) -> list[dict]:
    """
    Ritorna i totali kcal per gli ultimi `days` giorni fino a end_date incluso.
    Formato: [{"label": "lun", "date": "2026-07-14", "kcal": 1950}, ...]
    """
    all_rows = get_all_meal_rows()

    # Somma kcal per data
    kcal_by_date = {}
    for m in all_rows:
        kcal_by_date[m["date"]] = kcal_by_date.get(m["date"], 0) + m["kcal"]

    out = []
    for i in range(days - 1, -1, -1):
        d = end_date - timedelta(days=i)
        d_str = d.strftime("%Y-%m-%d")
        out.append({
            "label": WEEKDAY_IT[d.weekday()],
            "date": d_str,
            "kcal": round(kcal_by_date.get(d_str, 0), 1),
        })
    return out


# ---------------------------------------------------------------------------
# Modifica / cancellazione pasti per id (Deploy 5 §5.2)
# ---------------------------------------------------------------------------
# Campi numerici modificabili (alimento e' testo, gestito a parte).
_EDITABLE_NUMERIC = {"grammi", "kcal", "proteine", "carboidrati", "grassi"}


def _read_all_raw(sheets):
    """Legge tutte le righe grezze del foglio pasti (A:L), senza parsing."""
    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!{_SHEET_RANGE}"
    ).execute()
    return result.get("values", [])


def _find_raw_row_by_id(values, meal_id):
    """
    Cerca la riga con id dato nella lista grezza `values`.
    Ritorna (indice_0based, riga) oppure (None, None).

    L'indice 0-based coincide con la posizione fisica nel foglio: values[0]
    e' la riga 1. Un'eventuale riga di header non ha UUID in colonna J, quindi
    non puo' mai combaciare e viene ignorata naturalmente.
    """
    target = str(meal_id).strip()
    if not target:
        return None, None
    for idx, row in enumerate(values):
        if len(row) > 9 and str(row[9]).strip() == target:
            return idx, row
    return None, None


def update_meal_row(meal_id: str, fields: dict) -> bool:
    """
    Aggiorna in-place la riga identificata da `meal_id`, riscrivendo le
    colonne editabili: B..G (alimento, grammi, kcal, proteine, carboidrati,
    grassi) e opzionalmente L (tipo_pasto). I campi non passati in `fields`
    conservano il valore esistente. timestamp, fonte, note, id e
    data_dichiarata NON vengono toccati.

    Ritorna True se la riga e' stata trovata e aggiornata, False altrimenti
    (es. id inesistente o riga storica senza id).
    """
    sheets = _get_sheets_service()
    _verify_sheet_exists(sheets)

    values = _read_all_raw(sheets)
    idx, row = _find_raw_row_by_id(values, meal_id)
    if idx is None:
        return False

    def existing(i):
        return row[i] if len(row) > i else ""

    # alimento (colonna B, indice 1): testo, sostituito solo se presente
    alimento = fields["alimento"] if "alimento" in fields else existing(1)

    def numeric(name, i):
        if name in fields and fields[name] is not None:
            return _to_float(fields[name])
        return existing(i)

    new_row = [
        alimento,
        numeric("grammi", 2),
        numeric("kcal", 3),
        numeric("proteine", 4),
        numeric("carboidrati", 5),
        numeric("grassi", 6),
    ]

    row_number = idx + 1  # 1-based per la notazione A1
    data = [{
        "range": f"{SHEET_NAME}!B{row_number}:G{row_number}",
        "values": [new_row],
    }]
    if "tipo_pasto" in fields:
        # Vuoto / null / non riconosciuto → cancella L (torna il fallback ora).
        tipo_str = normalize_tipo_pasto(fields["tipo_pasto"]) or ""
        data.append({
            "range": f"{SHEET_NAME}!L{row_number}",
            "values": [[tipo_str]],
        })

    sheets.values().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"valueInputOption": "USER_ENTERED", "data": data},
    ).execute()
    _invalidate_meals_cache()
    return True


def delete_meal_row(meal_id: str) -> bool:
    """
    Elimina fisicamente la riga identificata da `meal_id` (deleteDimension sul
    gid della tab). Ritorna True se trovata ed eliminata, False altrimenti.
    """
    sheets = _get_sheets_service()
    _verify_sheet_exists(sheets)

    values = _read_all_raw(sheets)
    idx, _row = _find_raw_row_by_id(values, meal_id)
    if idx is None:
        return False

    sheet_id = _get_sheet_id(sheets, SHEET_NAME)
    sheets.batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": idx,       # 0-based, inclusivo
                    "endIndex": idx + 1,     # esclusivo
                }
            }
        }]}
    ).execute()
    _invalidate_meals_cache()
    return True


# ---------------------------------------------------------------------------
# Config (target giornalieri) + TargetHistory (fasce valid_from)
# ---------------------------------------------------------------------------
_HISTORY_HEADER = ["valid_from", "kcal", "proteine", "carboidrati", "grassi"]


def _clean_targets(targets: dict) -> dict:
    """Normalizza i 4 target (default se mancanti / <=0)."""
    clean = {}
    for k in _TARGET_KEYS:
        clean[k] = _to_float(targets.get(k, DEFAULT_TARGETS[k]))
        if clean[k] <= 0:
            clean[k] = DEFAULT_TARGETS[k]
    return clean


def _targets_equal(a: dict, b: dict) -> bool:
    """Confronto numerico sui 4 target (tolleranza 0.05)."""
    for k in _TARGET_KEYS:
        if abs(_to_float(a.get(k)) - _to_float(b.get(k))) > 0.05:
            return False
    return True


def _write_targets(sheets, targets: dict):
    """Scrive i 4 target nella tab Config in layout fisso (chiave|valore)."""
    values = [[k, targets.get(k, DEFAULT_TARGETS[k])] for k in _TARGET_KEYS]
    sheets.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CONFIG_SHEET_NAME}!A1:B{len(_TARGET_KEYS)}",
        valueInputOption="USER_ENTERED",
        body={"values": values}
    ).execute()


def _fetch_config_targets_uncached() -> dict:
    """Lettura tab Config A1:B4 + parse (nessuna cache). Non risolve la storia."""
    sheets = _get_sheets_service()
    _ensure_config_sheet(sheets)

    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CONFIG_SHEET_NAME}!A1:B50"
    ).execute()

    found = {}
    for row in result.get("values", []):
        if len(row) >= 2:
            key = str(row[0]).strip().lower()
            if key in _TARGET_KEYS:
                found[key] = _to_float(row[1])

    return {k: found.get(k, DEFAULT_TARGETS[k]) for k in _TARGET_KEYS}


def _parse_history_row(row: list) -> dict | None:
    """Parsa una riga TargetHistory (salta header / righe malformate)."""
    if not row or len(row) < 2:
        return None
    raw = str(row[0]).strip()
    if not raw or raw.lower() == "valid_from":
        return None
    try:
        valid = datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    band = {"valid_from": valid.strftime("%Y-%m-%d")}
    for i, k in enumerate(_TARGET_KEYS):
        band[k] = _to_float(row[i + 1]) if len(row) > i + 1 else DEFAULT_TARGETS[k]
        if band[k] <= 0:
            band[k] = DEFAULT_TARGETS[k]
    return band


def _earliest_meal_date() -> date | None:
    """Prima data pasto sul foglio, o None se vuoto / errore."""
    try:
        rows = get_all_meal_rows()
    except Exception:
        return None
    dates = []
    for m in rows:
        try:
            dates.append(datetime.strptime(m["date"][:10], "%Y-%m-%d").date())
        except (ValueError, TypeError, KeyError):
            continue
    return min(dates) if dates else None


def _ensure_target_history_sheet(sheets, seed_targets: dict | None = None):
    """
    Assicura la tab TargetHistory. Se manca o e' vuota, backfill una riga
    valid_from = min(prima data pasti, oggi) con i target correnti/default.
    """
    global _sheet_titles_cache
    titles = _get_titles(sheets)
    created = False
    if TARGET_HISTORY_SHEET_NAME not in titles:
        sheets.batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"requests": [{
                "addSheet": {"properties": {"title": TARGET_HISTORY_SHEET_NAME}}
            }]}
        ).execute()
        _sheet_titles_cache = None
        created = True

    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TARGET_HISTORY_SHEET_NAME}!A1:E50"
    ).execute()
    values = result.get("values") or []
    has_data = any(_parse_history_row(r) for r in values)

    if created or not has_data:
        seed = _clean_targets(seed_targets or DEFAULT_TARGETS)
        today = _today_italy()
        earliest = _earliest_meal_date()
        start = earliest if earliest is not None and earliest < today else today
        body = [
            _HISTORY_HEADER,
            [
                start.strftime("%Y-%m-%d"),
                seed["kcal"],
                seed["proteine"],
                seed["carboidrati"],
                seed["grassi"],
            ],
        ]
        sheets.values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{TARGET_HISTORY_SHEET_NAME}!A1:E2",
            valueInputOption="USER_ENTERED",
            body={"values": body}
        ).execute()


def _fetch_target_history_uncached() -> list[dict]:
    """Lettura TargetHistory ordinata per valid_from (poi ordine foglio)."""
    sheets = _get_sheets_service()
    _ensure_config_sheet(sheets)
    mirror = _fetch_config_targets_uncached()
    _ensure_target_history_sheet(sheets, seed_targets=mirror)

    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TARGET_HISTORY_SHEET_NAME}!A1:E200"
    ).execute()

    bands = []
    for row in result.get("values") or []:
        parsed = _parse_history_row(row)
        if parsed:
            bands.append(parsed)

    # Stabile: data asc, poi ordine di lettura (ultime righe stesso giorno vincono in target_for)
    bands.sort(key=lambda b: b["valid_from"])
    return bands


def target_for(day: date, history: list[dict] | None = None) -> dict:
    """
    Target in vigore nel giorno D: ultima fascia con valid_from <= D
    (ultimo impostato prima della mezzanotte di D+1).
    """
    if history is None:
        history = get_target_history()
    best = None
    day_str = day.strftime("%Y-%m-%d") if isinstance(day, date) else str(day)[:10]
    for band in history:
        if band["valid_from"] <= day_str:
            best = band
        else:
            break
    if best is None:
        return dict(DEFAULT_TARGETS)
    return {k: best[k] for k in _TARGET_KEYS}


def get_target_history() -> list[dict]:
    """Lista fasce TargetHistory (cache TTL 20s, condivisa col lock Config)."""
    global _history_cache_rows, _history_cache_at

    now = time.monotonic()
    with _config_cache_lock:
        if (
            _history_cache_rows is not None
            and (now - _history_cache_at) < _CONFIG_CACHE_TTL_S
        ):
            return [dict(b) for b in _history_cache_rows]

    bands = _fetch_target_history_uncached()
    with _config_cache_lock:
        _history_cache_rows = bands
        _history_cache_at = time.monotonic()
    return [dict(b) for b in bands]


def get_config_targets() -> dict:
    """
    Target corrente = target_for(oggi) dalla storia (A1:B4 e' lo specchio legacy).
    Se la copia Config e' in ritardo rispetto a una fascia gia' in vigore,
    risincronizza A1:B4. Cache TTL 20s + single-flight.
    """
    global _config_cache_targets, _config_cache_at
    global _config_inflight, _config_inflight_result, _config_inflight_error

    now = time.monotonic()
    with _config_cache_lock:
        if (
            _config_cache_targets is not None
            and (now - _config_cache_at) < _CONFIG_CACHE_TTL_S
        ):
            return dict(_config_cache_targets)

        if _config_inflight is not None:
            waiter = _config_inflight
            is_leader = False
        else:
            waiter = threading.Event()
            _config_inflight = waiter
            _config_inflight_result = None
            _config_inflight_error = None
            is_leader = True

    if not is_leader:
        waiter.wait(timeout=55)
        with _config_cache_lock:
            if _config_inflight_error is not None:
                raise _config_inflight_error
            if _config_inflight_result is not None:
                return dict(_config_inflight_result)
        history = get_target_history()
        return target_for(_today_italy(), history)

    try:
        history = _fetch_target_history_uncached()
        today = _today_italy()
        resolved = target_for(today, history)
        # Specchio Config: allinea se una fascia "da domani" e' diventata attiva
        sheets = _get_sheets_service()
        mirror = _fetch_config_targets_uncached()
        if not _targets_equal(mirror, resolved):
            _write_targets(sheets, resolved)
        with _config_cache_lock:
            _history_cache_rows = history
            _history_cache_at = time.monotonic()
            _config_cache_targets = resolved
            _config_cache_at = time.monotonic()
            _config_inflight_result = resolved
            _config_inflight_error = None
        return dict(resolved)
    except Exception as e:
        with _config_cache_lock:
            _config_inflight_error = e
            _config_inflight_result = None
        raise
    finally:
        with _config_cache_lock:
            done = _config_inflight
            _config_inflight = None
        if done is not None:
            done.set()


def _append_history_row(sheets, valid_from: date, targets: dict):
    """Appende una riga a TargetHistory (senza header)."""
    sheets.values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TARGET_HISTORY_SHEET_NAME}!A:E",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": [[
            valid_from.strftime("%Y-%m-%d"),
            targets["kcal"],
            targets["proteine"],
            targets["carboidrati"],
            targets["grassi"],
        ]]}
    ).execute()


def _band_row(valid_from: date | str, targets: dict) -> dict:
    vf = valid_from.strftime("%Y-%m-%d") if isinstance(valid_from, date) else str(valid_from)[:10]
    return {
        "valid_from": vf,
        "kcal": targets["kcal"],
        "proteine": targets["proteine"],
        "carboidrati": targets["carboidrati"],
        "grassi": targets["grassi"],
    }


def _rewrite_target_history(sheets, bands: list[dict]):
    """Riscrive l'intera tab TargetHistory (header + fasce ordinate)."""
    ordered = sorted(bands, key=lambda b: b["valid_from"])
    values = [_HISTORY_HEADER]
    for b in ordered:
        values.append([
            b["valid_from"],
            b["kcal"],
            b["proteine"],
            b["carboidrati"],
            b["grassi"],
        ])
    sheets.values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TARGET_HISTORY_SHEET_NAME}!A:E",
    ).execute()
    sheets.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TARGET_HISTORY_SHEET_NAME}!A1",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()


def apply_target_span(
    targets: dict,
    mode: str,
    start: date,
    end: date | None = None,
) -> dict:
    """
    Applica i target su un ambito temporale e riscrive TargetHistory.

    mode:
      - "from": fascia a start, elimina tutte le fasce con valid_from > start
      - "day": solo start (equivalente a range con end=start)
      - "range": [start, end] inclusivi; ripristina a end+1 il piano pre-edit

    Ritorna il target corrente (in vigore oggi).
    """
    clean = _clean_targets(targets)
    today = _today_italy()
    mode_n = (mode or "from").strip().lower()
    if mode_n in ("day", "solo", "single"):
        mode_n = "day"
        end = start
    elif mode_n in ("range", "intervallo"):
        mode_n = "range"
    elif mode_n in ("from", "forward", "poi"):
        mode_n = "from"
    else:
        raise ValueError("mode non valido: usa from | day | range")

    if mode_n == "range":
        if end is None:
            raise ValueError("Per mode=range serve 'end' (YYYY-MM-DD)")
        if end < start:
            raise ValueError("'end' deve essere >= 'start'")
        if (end - start).days > 366:
            raise ValueError("Intervallo massimo 366 giorni")

    sheets = _get_sheets_service()
    _ensure_config_sheet(sheets)
    history = _fetch_target_history_uncached()
    start_str = start.strftime("%Y-%m-%d")

    if mode_n == "from":
        # Tiene solo fasce strettamente prima di start; elimina start e tutto il dopo.
        new_bands = [b for b in history if b["valid_from"] < start_str]
        existing = target_for(start, history)
        if not _targets_equal(existing, clean):
            new_bands.append(_band_row(start, clean))
        # Se i valori coincidono gia' (fascia precedente), basta aver tagliato il futuro.
    else:
        # day / range
        assert end is not None
        end_str = end.strftime("%Y-%m-%d")
        end_plus = end + timedelta(days=1)
        end_plus_str = end_plus.strftime("%Y-%m-%d")
        restore = target_for(end_plus, history)

        # Tieni fasce fuori da [start, end]; togli anche end+1 (la riscriviamo).
        new_bands = [
            b for b in history
            if not (start_str <= b["valid_from"] <= end_str)
            and b["valid_from"] != end_plus_str
        ]
        new_bands.append(_band_row(start, clean))
        if not _targets_equal(restore, clean):
            new_bands.append(_band_row(end_plus, restore))

    # Coalesce: se due fasce consecutive identiche, tieni solo la prima
    new_bands.sort(key=lambda b: b["valid_from"])
    coalesced = []
    for b in new_bands:
        if coalesced and _targets_equal(coalesced[-1], b):
            continue
        coalesced.append(b)
    new_bands = coalesced

    _ensure_target_history_sheet(sheets, seed_targets=clean)
    _rewrite_target_history(sheets, new_bands)

    current = target_for(today, new_bands)
    _write_targets(sheets, current)
    _invalidate_config_cache()
    return current


def set_config_targets(targets: dict, valid_from: date | None = None) -> dict:
    """
    Compat: equivale a apply_target_span(..., mode='from', start=valid_from|oggi).
    """
    today = _today_italy()
    vf = valid_from if valid_from is not None else today
    return apply_target_span(targets, mode="from", start=vf)


# ---------------------------------------------------------------------------
# Catalogo personale (prodotti frequenti / preferiti)
# A id | B nome | C alias | D barcode | E kcal_100 | F proteine_100 |
# G carboidrati_100 | H grassi_100 | I fonte | J off_code | K volte |
# L ultimo_uso | M preferito
# ---------------------------------------------------------------------------
_CATALOG_HEADER = [
    "id", "nome", "alias", "barcode",
    "kcal_100", "proteine_100", "carboidrati_100", "grassi_100",
    "fonte", "off_code", "volte", "ultimo_uso", "preferito",
]
_CATALOG_RANGE = "A:M"
_CATALOG_FONTI = {"off", "manuale", "barcode"}


def _ensure_catalog_sheet(sheets):
    """
    Assicura che la tab Catalogo esista con header. Se manca, la crea.
    Ritorna True se l'ha appena creata.
    """
    global _sheet_titles_cache
    titles = _get_titles(sheets)
    if CATALOG_SHEET_NAME in titles:
        return False

    sheets.batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{"addSheet": {"properties": {"title": CATALOG_SHEET_NAME}}}]}
    ).execute()
    _sheet_titles_cache = None

    sheets.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CATALOG_SHEET_NAME}!A1:M1",
        valueInputOption="USER_ENTERED",
        body={"values": [_CATALOG_HEADER]},
    ).execute()
    return True


def _parse_catalog_row(row: list) -> dict | None:
    """Converte una riga Catalogo in dict, o None se header/invalida."""
    if not row or len(row) < 2:
        return None
    rid = str(row[0]).strip() if len(row) > 0 else ""
    if not rid or rid.lower() == "id":
        return None
    nome = str(row[1]).strip() if len(row) > 1 else ""
    if not nome:
        return None
    preferito_raw = str(row[12]).strip().lower() if len(row) > 12 else ""
    return {
        "id": rid,
        "nome": nome,
        "alias": str(row[2]).strip() if len(row) > 2 else "",
        "barcode": str(row[3]).strip() if len(row) > 3 else "",
        "per_100g": {
            "kcal": _to_float(row[4]) if len(row) > 4 else 0,
            "proteine": _to_float(row[5]) if len(row) > 5 else 0,
            "carboidrati": _to_float(row[6]) if len(row) > 6 else 0,
            "grassi": _to_float(row[7]) if len(row) > 7 else 0,
        },
        "fonte": str(row[8]).strip() if len(row) > 8 else "manuale",
        "off_code": str(row[9]).strip() if len(row) > 9 else "",
        "volte": int(_to_float(row[10])) if len(row) > 10 else 0,
        "ultimo_uso": str(row[11]).strip() if len(row) > 11 else "",
        "preferito": preferito_raw in ("true", "1", "yes", "si", "sì"),
    }


def _catalog_row_values(entry: dict) -> list:
    """Serializza un entry catalogo nella riga A:M."""
    p = entry.get("per_100g") or {}
    return [
        entry.get("id", ""),
        entry.get("nome", ""),
        entry.get("alias", ""),
        entry.get("barcode", ""),
        p.get("kcal", 0),
        p.get("proteine", 0),
        p.get("carboidrati", 0),
        p.get("grassi", 0),
        entry.get("fonte", "manuale"),
        entry.get("off_code", ""),
        entry.get("volte", 0),
        entry.get("ultimo_uso", ""),
        "true" if entry.get("preferito") else "false",
    ]


def _read_catalog_raw(sheets):
    result = sheets.values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CATALOG_SHEET_NAME}!{_CATALOG_RANGE}",
    ).execute()
    return result.get("values", [])


def _sort_catalog(entries: list[dict]) -> list[dict]:
    """Preferiti prima, poi volte desc, poi ultimo_uso desc (sort stabili)."""
    out = list(entries)
    out.sort(key=lambda e: e.get("ultimo_uso") or "", reverse=True)
    out.sort(key=lambda e: int(e.get("volte") or 0), reverse=True)
    out.sort(key=lambda e: 0 if e.get("preferito") else 1)
    return out


def list_catalog(q: str = "") -> list[dict]:
    """
    Lista prodotti del catalogo, ordinati. Se `q` non e' vuoto, filtra per
    substring case-insensitive su nome + alias.
    """
    sheets = _get_sheets_service()
    _ensure_catalog_sheet(sheets)
    values = _read_catalog_raw(sheets)
    entries = []
    for row in values:
        parsed = _parse_catalog_row(row)
        if parsed:
            entries.append(parsed)

    needle = (q or "").strip().lower()
    if needle:
        filtered = []
        for e in entries:
            hay = f"{e['nome']} {e.get('alias') or ''}".lower()
            if needle in hay:
                filtered.append(e)
        entries = filtered

    return _sort_catalog(entries)


def get_catalog_by_id(catalog_id: str) -> dict | None:
    """Ritorna un entry per id, o None."""
    target = str(catalog_id or "").strip()
    if not target:
        return None
    for e in list_catalog():
        if e["id"] == target:
            return e
    return None


def get_catalog_by_barcode(barcode: str) -> dict | None:
    """Ritorna un entry per barcode (o off_code uguale), o None."""
    code = str(barcode or "").strip()
    if not code:
        return None
    for e in list_catalog():
        if e.get("barcode") == code or e.get("off_code") == code:
            return e
    return None


def upsert_catalog_entry(
    *,
    nome: str,
    per_100g: dict,
    barcode: str = "",
    alias: str = "",
    fonte: str = "manuale",
    off_code: str = "",
    preferito: bool | None = None,
    catalog_id: str = "",
    bump_usage: bool = False,
    now_ts: str = "",
) -> dict:
    """
    Crea o aggiorna un prodotto nel catalogo.
    Match: catalog_id, altrimenti barcode/off_code, altrimenti append nuovo.
    Se bump_usage, incrementa volte e aggiorna ultimo_uso.
    """
    sheets = _get_sheets_service()
    _ensure_catalog_sheet(sheets)
    values = _read_catalog_raw(sheets)

    nome = (nome or "").strip()
    if not nome:
        raise ValueError("nome obbligatorio per upsert catalogo")

    fonte = (fonte or "manuale").strip().lower()
    if fonte not in _CATALOG_FONTI:
        fonte = "manuale"

    barcode = str(barcode or "").strip()
    off_code = str(off_code or barcode or "").strip()
    alias = str(alias or "").strip()
    catalog_id = str(catalog_id or "").strip()

    p100 = {
        "kcal": _to_float(per_100g.get("kcal", 0)),
        "proteine": _to_float(per_100g.get("proteine", 0)),
        "carboidrati": _to_float(per_100g.get("carboidrati", 0)),
        "grassi": _to_float(per_100g.get("grassi", 0)),
    }

    # Trova riga esistente: id → barcode/off_code → nome (casefold),
    # cosi' un secondo "salva da Diario" non crea duplicati senza barcode.
    match_idx = None
    existing = None
    nome_key = nome.casefold().strip()
    for idx, row in enumerate(values):
        parsed = _parse_catalog_row(row)
        if not parsed:
            continue
        if catalog_id and parsed["id"] == catalog_id:
            match_idx, existing = idx, parsed
            break
        if barcode and (parsed.get("barcode") == barcode or parsed.get("off_code") == barcode):
            match_idx, existing = idx, parsed
            break
        if off_code and (parsed.get("off_code") == off_code or parsed.get("barcode") == off_code):
            match_idx, existing = idx, parsed
            break
    if existing is None and nome_key and not catalog_id:
        for idx, row in enumerate(values):
            parsed = _parse_catalog_row(row)
            if not parsed:
                continue
            if str(parsed.get("nome", "")).casefold().strip() == nome_key:
                match_idx, existing = idx, parsed
                break

    if existing:
        entry = {
            **existing,
            "nome": nome or existing["nome"],
            "alias": alias if alias else existing.get("alias", ""),
            "barcode": barcode or existing.get("barcode", ""),
            "per_100g": p100,
            "fonte": fonte or existing.get("fonte", "manuale"),
            "off_code": off_code or existing.get("off_code", ""),
        }
        if preferito is not None:
            entry["preferito"] = bool(preferito)
        if bump_usage:
            entry["volte"] = int(existing.get("volte") or 0) + 1
            entry["ultimo_uso"] = now_ts or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row_number = match_idx + 1
        sheets.values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{CATALOG_SHEET_NAME}!A{row_number}:M{row_number}",
            valueInputOption="USER_ENTERED",
            body={"values": [_catalog_row_values(entry)]},
        ).execute()
        return entry

    entry = {
        "id": catalog_id or str(uuid.uuid4()),
        "nome": nome,
        "alias": alias,
        "barcode": barcode,
        "per_100g": p100,
        "fonte": fonte,
        "off_code": off_code,
        "volte": 1 if bump_usage else 0,
        "ultimo_uso": (now_ts or datetime.now().strftime("%Y-%m-%d %H:%M:%S")) if bump_usage else "",
        "preferito": bool(preferito) if preferito is not None else False,
    }
    sheets.values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CATALOG_SHEET_NAME}!{_CATALOG_RANGE}",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": [_catalog_row_values(entry)]},
    ).execute()
    return entry


def set_catalog_preferito(catalog_id: str, preferito: bool) -> dict | None:
    """Imposta o toglie la stella. Ritorna entry aggiornato o None."""
    entry = get_catalog_by_id(catalog_id)
    if not entry:
        return None
    return upsert_catalog_entry(
        catalog_id=entry["id"],
        nome=entry["nome"],
        per_100g=entry["per_100g"],
        barcode=entry.get("barcode", ""),
        alias=entry.get("alias", ""),
        fonte=entry.get("fonte", "manuale"),
        off_code=entry.get("off_code", ""),
        preferito=preferito,
    )


def delete_catalog_entry(catalog_id: str) -> bool:
    """Elimina fisicamente la riga catalogo. Ritorna True se trovata."""
    sheets = _get_sheets_service()
    _ensure_catalog_sheet(sheets)
    values = _read_catalog_raw(sheets)
    target = str(catalog_id or "").strip()
    if not target:
        return False

    match_idx = None
    for idx, row in enumerate(values):
        parsed = _parse_catalog_row(row)
        if parsed and parsed["id"] == target:
            match_idx = idx
            break
    if match_idx is None:
        return False

    sheet_id = _get_sheet_id(sheets, CATALOG_SHEET_NAME)
    sheets.batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": match_idx,
                    "endIndex": match_idx + 1,
                }
            }
        }]}
    ).execute()
    return True


def bump_catalog_usage(catalog_id: str, now_ts: str = "") -> dict | None:
    """Incrementa volte + ultimo_uso. Ritorna entry o None."""
    entry = get_catalog_by_id(catalog_id)
    if not entry:
        return None
    return upsert_catalog_entry(
        catalog_id=entry["id"],
        nome=entry["nome"],
        per_100g=entry["per_100g"],
        barcode=entry.get("barcode", ""),
        alias=entry.get("alias", ""),
        fonte=entry.get("fonte", "manuale"),
        off_code=entry.get("off_code", ""),
        bump_usage=True,
        now_ts=now_ts,
    )
