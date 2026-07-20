"""
VoiceTrack — Google Sheets Client
Gestisce lettura e scrittura dei dati pasto su Google Sheets,
piu' la tab di configurazione con i target giornalieri.
"""

import json
import os
import uuid
from datetime import datetime, date, timedelta
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

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Colonne del foglio pasti (ordine fisso)
# A: timestamp | B: alimento | C: grammi | D: kcal | E: proteine | F: carboidrati | G: grassi | H: fonte | I: note | J: id
# NB (Deploy 5 §5.1): `id` e' aggiunto IN CODA di proposito. Cosi' nessuna
# colonna esistente si sposta e le righe storiche (che arrivano con lunghezza
# < 10 dall'API) vengono lette con id = "" senza rompere nulla.
COLUMNS = ["timestamp", "alimento", "grammi", "kcal", "proteine", "carboidrati", "grassi", "fonte", "note", "id"]

# Range completo dello schema pasti (A..J). Usato ovunque si legga/scriva il
# foglio: aggiornare qui se un giorno si aggiungono colonne.
_SHEET_RANGE = "A:J"

# Target di default usati quando la tab Config viene creata la prima volta.
DEFAULT_TARGETS = {"kcal": 2200, "proteine": 165, "carboidrati": 220, "grassi": 70}
_TARGET_KEYS = ["kcal", "proteine", "carboidrati", "grassi"]

# Etichette giorni settimana in italiano (lunedi' = 0, come datetime.weekday()).
WEEKDAY_IT = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]

# Cache dei titoli delle tab esistenti, valida per la durata dell'istanza "calda"
# della Cloud Function (si azzera ad ogni nuovo deploy o cold start).
_sheet_titles_cache = None


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
def append_meal_rows(items: list[dict], timestamp: datetime, fonte: str = "tasker-voce"):
    """
    Appende una o piu' righe al foglio pasti.

    Args:
        items: Lista di dict con alimento, grammi, kcal, proteine, carboidrati, grassi
        timestamp: Datetime del pasto
        fonte: Origine del dato: "tasker-voce" | "pwa-voce" | "pwa-barcode"
               ("voce"/"barcode" restano validi per retrocompatibilita')
    """
    sheets = _get_sheets_service()
    _verify_sheet_exists(sheets)

    ts_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")

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
        ])

    sheets.values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!{_SHEET_RANGE}",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows}
    ).execute()


# ---------------------------------------------------------------------------
# Lettura pasti
# ---------------------------------------------------------------------------
def _parse_row(row: list) -> dict | None:
    """Converte una riga grezza del foglio in un dict, o None se non valida."""
    if not row or len(row) < 7:
        return None
    ts = row[0]
    if len(ts) < 16:
        return None
    time_str = ts[11:16]  # HH:MM
    try:
        hour = int(ts[11:13])
    except (ValueError, IndexError):
        hour = 12
    return {
        "timestamp": ts,
        "date": ts[:10],
        "time": time_str,
        "pasto": pasto_from_hour(hour),
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


def get_all_meal_rows() -> list[dict]:
    """Legge e parsa TUTTE le righe del foglio pasti (una sola chiamata API)."""
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
    """Legge tutte le righe grezze del foglio pasti (A:J), senza parsing."""
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
    Aggiorna in-place la riga identificata da `meal_id`, riscrivendo solo le
    colonne editabili (B..G = alimento, grammi, kcal, proteine, carboidrati,
    grassi). I campi non passati in `fields` conservano il valore esistente.
    timestamp, fonte, note e id NON vengono toccati.

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
    sheets.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{SHEET_NAME}!B{row_number}:G{row_number}",
        valueInputOption="USER_ENTERED",
        body={"values": [new_row]},
    ).execute()
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
    return True


# ---------------------------------------------------------------------------
# Config (target giornalieri) — leggibili e scrivibili dalla webapp
# ---------------------------------------------------------------------------
def _write_targets(sheets, targets: dict):
    """Scrive i 4 target nella tab Config in layout fisso (chiave|valore)."""
    values = [[k, targets.get(k, DEFAULT_TARGETS[k])] for k in _TARGET_KEYS]
    sheets.values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{CONFIG_SHEET_NAME}!A1:B{len(_TARGET_KEYS)}",
        valueInputOption="USER_ENTERED",
        body={"values": values}
    ).execute()


def get_config_targets() -> dict:
    """
    Legge i target dalla tab Config. Se la tab non esiste, la crea con i
    default e li ritorna. Chiavi mancanti vengono completate coi default.
    """
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


def set_config_targets(targets: dict) -> dict:
    """
    Salva i target nella tab Config (creandola se manca). Ritorna i target
    effettivamente salvati (con eventuali default per chiavi mancanti).
    """
    sheets = _get_sheets_service()
    _ensure_config_sheet(sheets)

    clean = {}
    for k in _TARGET_KEYS:
        clean[k] = _to_float(targets.get(k, DEFAULT_TARGETS[k]))
        if clean[k] <= 0:
            clean[k] = DEFAULT_TARGETS[k]

    _write_targets(sheets, clean)
    return clean
