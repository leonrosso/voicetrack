"""
VoiceTrack — Cloud Function Entry Point
Gestisce le richieste HTTP da Tasker e dalla webapp, e instrada ai vari endpoint.
"""

import functions_framework
import json
import logging
import os
from datetime import date, datetime, timezone, timedelta

from llm_client import parse_meal_with_llm
from sheets_client import (
    append_meal_rows,
    get_today_rows,
    get_all_meal_rows,
    get_weekly_totals,
    get_config_targets,
    get_target_history,
    target_for,
    set_config_targets,
    apply_target_span,
    update_meal_row,
    delete_meal_row,
    normalize_tipo_pasto,
    sheet_health,
    SheetConfigError,
    list_catalog,
    get_catalog_by_id,
    get_catalog_by_barcode,
    upsert_catalog_entry,
    set_catalog_preferito,
    delete_catalog_entry,
)

# Timezone Italia
TZ_ITALY = timezone(timedelta(hours=2))

# API key semplice per proteggere la Cloud Function
API_KEY = os.environ.get("VOICETRACK_API_KEY", "")

# Versione applicativa, esposta da /health (aggiornare a ogni deploy significativo)
APP_VERSION = os.environ.get("APP_VERSION", "deploy5-dash-light-2026-07-24")

# Open Food Facts (Deploy 4, §5 del Piano di Consolidamento).
# API comunitaria senza SLA (§3.9 del registro): timeout corto e
# "prodotto non trovato" gestiti dal giorno uno. Nessuna dipendenza nuova:
# si usa urllib della standard library.
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}?fields=product_name,product_name_it,brands,nutriments"
OFF_TIMEOUT_S = 8
OFF_USER_AGENT = "VoiceTrack/1.0 (uso personale)"

# CORS aperto a tutti (decisione in VoiceTrack_Workflow_Semplificato.md, 21 luglio 2026):
# con la Cloud Function in --allow-unauthenticated, la vera barriera e' gia'
# la API key applicativa (_verify_api_key) — il CORS ristretto era solo
# "hardening gratuito", non una misura di sicurezza necessaria. Aprirlo
# toglie l'attrito di preview Vercel / IP locale / branch CORS-open dedicati.
# Tasker non manda l'header Origin, quindi non e' comunque toccato dal CORS.

# Valori ammessi per il campo `fonte` (§3.3 del Piano di Consolidamento).
# "voce" e "barcode" restano per retrocompatibilita' con le righe storiche.
_FONTI_VALIDE = {
    "tasker-voce", "pwa-voce", "pwa-testo", "pwa-barcode", "pwa-catalogo",
    "voce", "barcode",
}
_FONTE_DEFAULT = "tasker-voce"

_WEEKDAY_FULL_IT = [
    "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica",
]
_MONTH_FULL_IT = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]


def _cors_headers(request):
    """
    Ritorna gli header CORS per la richiesta corrente.
    Aperto a tutti gli origin (vedi nota sopra _FONTI_VALIDE): la barriera
    reale e' la API key applicativa, non il CORS.
    """
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        "Access-Control-Max-Age": "3600",
    }


def _verify_api_key(request):
    """Verifica che la richiesta contenga la API key corretta."""
    key = request.headers.get("X-API-Key", "")
    if not API_KEY:
        return True  # Se non configurata, accetta tutto (solo per dev)
    return key == API_KEY


def _json_response(data, status=200):
    """
    Helper per creare risposte JSON, sempre con header CORS.
    Usa il request globale di Flask (functions_framework gira su Flask),
    cosi' nessun call site esistente va modificato.
    """
    from flask import request as _req
    headers = {"Content-Type": "application/json; charset=utf-8"}
    headers.update(_cors_headers(_req))
    return (json.dumps(data, ensure_ascii=False), status, headers)


def _now_italy() -> datetime:
    return datetime.now(TZ_ITALY)


def _today_label_it(d: date) -> str:
    """Es. 'giovedì 23 luglio 2026' — per il prompt LLM."""
    return f"{_WEEKDAY_FULL_IT[d.weekday()]} {d.day} {_MONTH_FULL_IT[d.month - 1]} {d.year}"


def _parse_client_target_date(body) -> date | None:
    """
    Legge target_date dal body. None se assente.
    Solleva ValueError se presente ma malformato.
    """
    raw = str((body or {}).get("target_date", "")).strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError as e:
        raise ValueError("Campo 'target_date' non valido. Usa formato YYYY-MM-DD.") from e


def _label_giorno(declared_date: date, today: date, etichetta_llm=None) -> str:
    """
    Etichetta TTS per un giorno rispetto a oggi:
    oggi / ieri / l'altro ieri / domani / dopodomani / sabato 26 luglio.
    """
    delta = (today - declared_date).days
    if delta == 0:
        return "oggi"
    if delta == 1:
        return "ieri"
    if delta == 2:
        return "l'altro ieri"
    if delta == -1:
        return "domani"
    if delta == -2:
        return "dopodomani"
    llm = str(etichetta_llm or "").strip()
    if llm and any(ch.isdigit() for ch in llm):
        return llm
    return (
        f"{_WEEKDAY_FULL_IT[declared_date.weekday()]} "
        f"{declared_date.day} {_MONTH_FULL_IT[declared_date.month - 1]}"
    )


def _with_day_prefix(riepilogo: str, label: str) -> str:
    """Prefissa il riepilogo con la conferma del giorno (es. 'Ieri hai mangiato. …')."""
    body = (riepilogo or "").strip()
    lab = (label or "").strip()
    if not lab or lab.lower() == "oggi":
        return body
    lab_cap = lab[0].upper() + lab[1:]
    low = body.lower()
    if (
        low.startswith(lab.lower())
        or low.startswith("ieri ")
        or low.startswith("l'altro ieri")
        or low.startswith("domani ")
        or low.startswith("dopodomani ")
    ):
        return body
    if not body:
        return f"{lab_cap} hai mangiato."
    return f"{lab_cap} hai mangiato. {body}"


def _resolve_meal_datetimes(body, llm_result=None):
    """
    Risolve (recorded_at, declared_at, etichetta, from_speech).

    Precedenza giorno pasto: data_riferimento LLM → target_date client → oggi.
    recorded_at e' sempre "adesso". Se il giorno dichiarato e' oggi, i due
    datetime coincidono; altrimenti declared_at = mezzogiorno locale
    (passato o futuro). Solleva ValueError solo per target_date malformato.
    """
    recorded_at = _now_italy()
    today = recorded_at.date()
    llm_result = llm_result or {}
    from_speech = False
    declared_date = None

    raw_ref = llm_result.get("data_riferimento")
    if raw_ref not in (None, "", "null"):
        try:
            declared_date = datetime.strptime(str(raw_ref).strip()[:10], "%Y-%m-%d").date()
            from_speech = True
        except ValueError:
            declared_date = None

    if declared_date is None:
        declared_date = _parse_client_target_date(body)

    etichetta_llm = llm_result.get("etichetta_giorno")

    if declared_date is None:
        return recorded_at, recorded_at, None, False

    etichetta = _label_giorno(declared_date, today, etichetta_llm)

    if declared_date == today:
        # Coincide: stesso datetime reale (ora di registrazione).
        return recorded_at, recorded_at, (etichetta if from_speech else None), from_speech

    declared_at = datetime(
        declared_date.year, declared_date.month, declared_date.day,
        12, 0, 0, tzinfo=TZ_ITALY,
    )
    return recorded_at, declared_at, etichetta, from_speech


def _resolve_meal_datetimes_or_400(body, llm_result=None):
    """Wrapper: (tuple, None) oppure (None, risposta_400)."""
    try:
        return _resolve_meal_datetimes(body, llm_result), None
    except ValueError as e:
        return None, _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": str(e),
        }, 400)


def _attach_declared_meta(payload: dict, declared_at: datetime, etichetta) -> dict:
    """Aggiunge data_dichiarata / etichetta e prefissa il riepilogo se backdatato."""
    today = _now_italy().date()
    d = declared_at.date()
    payload = dict(payload)
    payload["data_dichiarata"] = d.strftime("%Y-%m-%d")
    if d != today:
        label = etichetta or _label_giorno(d, today)
        payload["etichetta_giorno"] = label
        payload["riepilogo_vocale"] = _with_day_prefix(
            payload.get("riepilogo_vocale", ""), label
        )
    elif etichetta:
        payload["etichetta_giorno"] = etichetta
    return payload


def _resolve_tipo_pasto(body, llm_result=None):
    """
    Precedenza tipo pasto: LLM (voce) → body client (tipo_pasto / meal_type) → None.
    None = non dichiarato → in scrittura L vuota → in lettura fallback sull'ora.
    """
    llm_result = llm_result or {}
    t = normalize_tipo_pasto(llm_result.get("tipo_pasto"))
    if t:
        return t
    body = body or {}
    return normalize_tipo_pasto(body.get("tipo_pasto") or body.get("meal_type"))


@functions_framework.http
def voicetrack(request):
    """
    Entry point della Cloud Function.
    Routing basato sul path:
      GET  /health        → stato del servizio (SENZA API key: warm-up + checklist)
      POST /log_meal      → registra un pasto
      POST /scan_barcode  → registra un prodotto da codice EAN (Open Food Facts)
      POST /update_meal   → modifica una riga pasto per id
      POST /delete_meal   → elimina una riga pasto per id
      GET  /daily_summary → riepilogo giornata (TTS)
      GET  /day_meals     → pasti di 1–7 date (batch PWA Diario)
      GET  /dashboard     → dati per la webapp
      GET  /config        → legge i target
      POST /config        → salva i target
      GET  /catalog       → lista catalogo personale (q= filtro)
      POST /catalog       → upsert / star / unstar / delete
      POST /search        → ricerca catalogo + OFF
      POST /log_catalog   → logga un prodotto da catalogo/OFF con grammi
    """
    # Preflight CORS: DEVE rispondere prima del check API key,
    # perche' il browser manda l'OPTIONS senza l'header X-API-Key.
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers(request))

    path = request.path.rstrip("/")

    # /health e' pubblico (§3.2 del Piano): niente API key, contenuto minimo.
    # Usi: warm-up anti cold start dalla PWA + checklist post-redeploy in un solo curl.
    if path == "/health" and request.method == "GET":
        return _handle_health(request)

    # Verifica API key
    if not _verify_api_key(request):
        return _json_response({"error": "Unauthorized"}, 401)

    if path == "/log_meal" and request.method == "POST":
        return _handle_log_meal(request)
    elif path == "/scan_barcode" and request.method == "POST":
        return _handle_scan_barcode(request)
    elif path == "/update_meal" and request.method == "POST":
        return _handle_update_meal(request)
    elif path == "/delete_meal" and request.method == "POST":
        return _handle_delete_meal(request)
    elif path == "/daily_summary" and request.method == "GET":
        return _handle_daily_summary(request)
    elif path == "/day_meals" and request.method == "GET":
        return _handle_day_meals(request)
    elif path == "/dashboard" and request.method == "GET":
        return _handle_dashboard(request)
    elif path == "/config" and request.method == "GET":
        return _handle_get_config(request)
    elif path == "/config" and request.method == "POST":
        return _handle_set_config(request)
    elif path == "/catalog" and request.method == "GET":
        return _handle_get_catalog(request)
    elif path == "/catalog" and request.method == "POST":
        return _handle_post_catalog(request)
    elif path == "/search" and request.method == "POST":
        return _handle_search(request)
    elif path == "/log_catalog" and request.method == "POST":
        return _handle_log_catalog(request)
    else:
        return _json_response({"error": f"Endpoint non trovato: {request.method} {path}"}, 404)


def _handle_health(request):
    """
    Endpoint GET /health — pubblico, contenuto minimo.
    Verifica interna che la tab pasti esista, SENZA esporne il nome.
    """
    try:
        sheet_ok = sheet_health()
    except Exception as e:
        logging.error(f"[health] errore inatteso: {e}", exc_info=True)
        sheet_ok = False
    return _json_response({
        "status": "ok" if sheet_ok else "degraded",
        "version": APP_VERSION,
        "sheet_ok": sheet_ok,
    })


def _handle_log_meal(request):
    """
    Endpoint POST /log_meal
    Body JSON: {"text": "ho mangiato 500g di tacchino...", "fonte": "pwa-voce"}
    Il campo `fonte` e' opzionale: se assente o non valido → "tasker-voce"
    (Tasker oggi non lo invia, quindi resta invariato senza toccare nulla).
    """
    body = request.get_json(silent=True) or {}
    # Valida solo target_date client qui (prima dell'LLM); la data voce si
    # risolve dopo la risposta Claude.
    try:
        _parse_client_target_date(body)
    except ValueError as e:
        return _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": "Data non valida. Usa il formato anno-mese-giorno.",
        }, 400)
    try:
        text = body.get("text", "").strip()
        fonte = body.get("fonte", _FONTE_DEFAULT)
        if fonte not in _FONTI_VALIDE:
            logging.warning(f"[log_meal] fonte non valida ricevuta: {fonte!r}, uso default")
            fonte = _FONTE_DEFAULT

        logging.info(f"[log_meal] testo ricevuto: {text!r} (fonte={fonte})")

        if not text:
            return _json_response({
                "status": "error",
                "message": "Nessun testo ricevuto. Invia il campo 'text' nel body JSON.",
                "riepilogo_vocale": "Non ho ricevuto nessun testo. Riprova."
            }, 400)

        today = _now_italy().date()
        llm_result = parse_meal_with_llm(
            text,
            today_iso=today.strftime("%Y-%m-%d"),
            today_label_it=_today_label_it(today),
        )

        logging.info(f"[log_meal] risposta LLM: {json.dumps(llm_result, ensure_ascii=False)}")

        if llm_result.get("status") == "needs_clarification":
            return _json_response(llm_result)

        resolved, date_err = _resolve_meal_datetimes_or_400(body, llm_result)
        if date_err:
            return date_err
        recorded_at, declared_at, etichetta, _from_speech = resolved

        if llm_result.get("status") == "ok" and llm_result.get("items"):
            tipo = _resolve_tipo_pasto(body, llm_result)
            append_meal_rows(
                llm_result["items"],
                recorded_at=recorded_at,
                declared_at=declared_at,
                fonte=fonte,
                tipo_pasto=tipo,
            )
            if tipo:
                llm_result = dict(llm_result)
                llm_result["tipo_pasto"] = tipo

        return _json_response(_attach_declared_meta(llm_result, declared_at, etichetta))

    except SheetConfigError as e:
        logging.error(f"[log_meal] configurazione foglio errata: {e}")
        return _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": f"Errore di configurazione del foglio: {str(e)}"
        }, 500)

    except Exception as e:
        logging.error(f"[log_meal] errore interno: {e}", exc_info=True)
        return _json_response({
            "status": "error",
            "message": f"Errore interno: {str(e)}",
            "riepilogo_vocale": "Si è verificato un errore. Riprova."
        }, 500)


# ---------------------------------------------------------------------------
# Deploy 4 — Barcode via Open Food Facts
# Flusso stateless, stesso pattern needs_clarification di /log_meal:
#   1° POST {"barcode": "..."}            → se manca la quantita', ritorna
#      needs_clarification + scheda prodotto (nome, valori per 100 g)
#   2° POST {"barcode": "...", "grammi": 150} → ricalcola, scrive su Sheets
# ---------------------------------------------------------------------------

def _fetch_off_product(barcode):
    """
    Interroga Open Food Facts v2.
    Ritorna (product_dict, None) se trovato,
            (None, None)         se il prodotto non esiste,
            (None, "messaggio")  per errori di rete/servizio.
    """
    import urllib.request
    import urllib.error
    import urllib.parse

    url = OFF_URL.format(barcode=urllib.parse.quote(barcode))
    req = urllib.request.Request(url, headers={"User-Agent": OFF_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=OFF_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, None  # convenzione OFF v2: 404 = barcode sconosciuto
        logging.error(f"[scan_barcode] OFF HTTP {e.code} per {barcode}")
        return None, f"Open Food Facts ha risposto con errore {e.code}."
    except Exception as e:
        logging.error(f"[scan_barcode] OFF non raggiungibile: {e}")
        return None, "Open Food Facts non è raggiungibile al momento."

    if data.get("status") != 1 or not data.get("product"):
        return None, None
    return data["product"], None


def _off_per_100g(product):
    """
    Estrae kcal e macro per 100 g dai nutriments OFF.
    Ritorna None se mancano le calorie (dati inutilizzabili).
    """
    n = product.get("nutriments") or {}

    def num(key):
        try:
            return float(n.get(key))
        except (TypeError, ValueError):
            return None

    def per100(base_key):
        # Alcuni prodotti (es. bevande/yogurt da preparare) hanno valori OFF
        # solo sotto le chiavi "_prepared_100g": senza questo fallback la
        # scheda risulta "senza valori nutrizionali" anche se i dati esistono.
        val = num(f"{base_key}_100g")
        if val is None:
            val = num(f"{base_key}_prepared_100g")
        return val

    kcal = per100("energy-kcal")
    if kcal is None:
        kj = per100("energy")  # OFF: spesso solo kJ
        kcal = round(kj / 4.184, 1) if kj is not None else None
    if kcal is None:
        return None

    return {
        "kcal": round(kcal, 1),
        "proteine": round(per100("proteins") or 0.0, 1),
        "carboidrati": round(per100("carbohydrates") or 0.0, 1),
        "grassi": round(per100("fat") or 0.0, 1),
    }


def _off_display_name(product, barcode):
    """Nome leggibile del prodotto, con brand se disponibile."""
    nome = (product.get("product_name_it") or product.get("product_name") or "").strip()
    brand = (product.get("brands") or "").split(",")[0].strip()
    if not nome:
        nome = brand or f"Prodotto {barcode}"
    elif brand and brand.lower() not in nome.lower():
        nome = f"{nome} ({brand})"
    return nome


def _handle_scan_barcode(request):
    """
    Endpoint POST /scan_barcode
    Body JSON: {"barcode": "8001120000000", "grammi": 150, "fonte": "pwa-barcode"}
    `grammi` opzionale: se assente → needs_clarification con scheda prodotto.
    """
    body = request.get_json(silent=True) or {}
    resolved, date_err = _resolve_meal_datetimes_or_400(body)
    if date_err:
        return date_err
    recorded_at, declared_at, etichetta, _from_speech = resolved
    try:
        barcode = str(body.get("barcode", "")).strip()
        fonte = body.get("fonte", "pwa-barcode")
        if fonte not in _FONTI_VALIDE:
            logging.warning(f"[scan_barcode] fonte non valida: {fonte!r}, uso pwa-barcode")
            fonte = "pwa-barcode"

        logging.info(f"[scan_barcode] barcode={barcode!r} grammi={body.get('grammi')!r} (fonte={fonte})")

        # EAN-8/13, UPC-12: solo cifre, lunghezza plausibile
        if not barcode.isdigit() or not (8 <= len(barcode) <= 14):
            return _json_response({
                "status": "error",
                "message": f"Codice a barre non valido: {barcode!r}",
                "riepilogo_vocale": "Il codice scansionato non sembra valido. Riprova."
            }, 400)

        product, err = _fetch_off_product(barcode)

        if err:
            return _json_response({
                "status": "error",
                "message": err,
                "riepilogo_vocale": err + " Riprova tra poco."
            }, 502)

        # §3.9 del registro: "prodotto non trovato" gestito dal giorno uno.
        # 200 con status dedicato: per il client e' un esito normale, non un guasto.
        if product is None:
            return _json_response({
                "status": "not_found",
                "barcode": barcode,
                "message": f"Prodotto {barcode} non presente su Open Food Facts.",
                "riepilogo_vocale": "Prodotto non trovato. Puoi registrarlo a voce dal tab Traccia."
            })

        per100 = _off_per_100g(product)
        nome = _off_display_name(product, barcode)

        if per100 is None:
            return _json_response({
                "status": "error",
                "barcode": barcode,
                "message": f"'{nome}' è su Open Food Facts ma senza valori nutrizionali utilizzabili.",
                "riepilogo_vocale": f"Ho trovato {nome}, ma mancano i valori nutrizionali. Registralo a voce."
            })

        # Quantita' assente o non valida → riuso del pattern needs_clarification.
        grammi_raw = body.get("grammi")
        try:
            grammi = float(grammi_raw)
        except (TypeError, ValueError):
            grammi = None
        if grammi is None or grammi <= 0:
            return _json_response({
                "status": "needs_clarification",
                "barcode": barcode,
                "product": {"nome": nome, "per_100g": per100},
                "message": f"Trovato: {nome}. Indicare la quantità in grammi.",
                "riepilogo_vocale": f"Trovato: {nome}. Quanti grammi?"
            })

        grammi = round(grammi, 1)
        fattore = grammi / 100.0
        item = {
            "alimento": nome,
            "grammi": grammi,
            "kcal": round(per100["kcal"] * fattore, 1),
            "proteine": round(per100["proteine"] * fattore, 1),
            "carboidrati": round(per100["carboidrati"] * fattore, 1),
            "grassi": round(per100["grassi"] * fattore, 1),
        }

        tipo = _resolve_tipo_pasto(body)
        append_meal_rows(
            [item],
            recorded_at=recorded_at,
            declared_at=declared_at,
            fonte=fonte,
            tipo_pasto=tipo,
        )

        # Upsert silenzioso nel catalogo personale (barcode + nutrienti).
        try:
            upsert_catalog_entry(
                nome=nome,
                per_100g=per100,
                barcode=barcode,
                off_code=barcode,
                fonte="barcode",
                bump_usage=True,
                now_ts=recorded_at.strftime("%Y-%m-%d %H:%M:%S"),
            )
        except Exception as e:
            logging.warning(f"[scan_barcode] upsert catalogo fallito: {e}")

        riepilogo = (
            f"Registrato: {nome}, {round(grammi)} grammi. "
            f"{round(item['kcal'])} calorie, {round(item['proteine'])} grammi di proteine."
        )
        payload = {
            "status": "ok",
            "items": [item],
            "totale": {k: item[k] for k in ("kcal", "proteine", "carboidrati", "grassi")},
            "riepilogo_vocale": riepilogo,
        }
        if tipo:
            payload["tipo_pasto"] = tipo
        return _json_response(_attach_declared_meta(payload, declared_at, etichetta))

    except SheetConfigError as e:
        logging.error(f"[scan_barcode] configurazione foglio errata: {e}")
        return _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": f"Errore di configurazione del foglio: {str(e)}"
        }, 500)

    except Exception as e:
        logging.error(f"[scan_barcode] errore interno: {e}", exc_info=True)
        return _json_response({
            "status": "error",
            "message": f"Errore interno: {str(e)}",
            "riepilogo_vocale": "Si è verificato un errore. Riprova."
        }, 500)


# ---------------------------------------------------------------------------
# Deploy 5 §5.2 — Modifica / cancellazione pasti per id
# Stessa API key e stessi header CORS (ristretti al dominio Vercel) degli
# altri endpoint: entrambi passano dal check in `voicetrack()` e da
# `_json_response`. Tasker non li usa → invariato.
# ---------------------------------------------------------------------------

# Campi che il client PWA puo' modificare via /update_meal.
_UPDATABLE_FIELDS = (
    "alimento", "grammi", "kcal", "proteine", "carboidrati", "grassi", "tipo_pasto",
)


def _handle_update_meal(request):
    """
    Endpoint POST /update_meal
    Body JSON: {"id": "<uuid>", "grammi": 180, "kcal": 320, ...}
    Modifica solo i campi passati; gli altri restano invariati.
    """
    try:
        body = request.get_json(silent=True) or {}
        meal_id = str(body.get("id", "")).strip()
        if not meal_id:
            return _json_response({
                "status": "error",
                "message": "Campo 'id' mancante o vuoto."
            }, 400)

        fields = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
        if not fields:
            return _json_response({
                "status": "error",
                "message": "Nessun campo modificabile nel body. "
                           f"Campi ammessi: {', '.join(_UPDATABLE_FIELDS)}."
            }, 400)

        logging.info(f"[update_meal] id={meal_id!r} campi={list(fields.keys())}")

        ok = update_meal_row(meal_id, fields)
        if not ok:
            return _json_response({
                "status": "not_found",
                "id": meal_id,
                "message": f"Nessuna riga con id {meal_id} (o riga storica senza id)."
            }, 404)

        return _json_response({"status": "ok", "id": meal_id, "updated": fields})

    except SheetConfigError as e:
        logging.error(f"[update_meal] configurazione foglio errata: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)

    except Exception as e:
        logging.error(f"[update_meal] errore interno: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore interno: {str(e)}"}, 500)


def _handle_delete_meal(request):
    """
    Endpoint POST /delete_meal
    Body JSON: {"id": "<uuid>"}
    Elimina fisicamente la riga corrispondente.
    """
    try:
        body = request.get_json(silent=True) or {}
        meal_id = str(body.get("id", "")).strip()
        if not meal_id:
            return _json_response({
                "status": "error",
                "message": "Campo 'id' mancante o vuoto."
            }, 400)

        logging.info(f"[delete_meal] id={meal_id!r}")

        ok = delete_meal_row(meal_id)
        if not ok:
            return _json_response({
                "status": "not_found",
                "id": meal_id,
                "message": f"Nessuna riga con id {meal_id} (o riga storica senza id)."
            }, 404)

        return _json_response({"status": "ok", "id": meal_id, "deleted": True})

    except SheetConfigError as e:
        logging.error(f"[delete_meal] configurazione foglio errata: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)

    except Exception as e:
        logging.error(f"[delete_meal] errore interno: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore interno: {str(e)}"}, 500)


def _totals(rows):
    """Somma kcal e macro su una lista di righe pasto."""
    return {
        "kcal": round(sum(r.get("kcal", 0) for r in rows), 1),
        "proteine": round(sum(r.get("proteine", 0) for r in rows), 1),
        "carboidrati": round(sum(r.get("carboidrati", 0) for r in rows), 1),
        "grassi": round(sum(r.get("grassi", 0) for r in rows), 1),
    }


def _handle_daily_summary(request):
    """
    Endpoint GET /daily_summary
    Parametro opzionale: ?date=2026-04-04 (default: oggi)
    """
    try:
        date_str = request.args.get("date", "")
        today = _now_italy().date()
        if date_str:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        else:
            target_date = today

        rows = get_today_rows(target_date)
        tot = _totals(rows)

        # Target del giorno richiesto (storia), non solo il corrente
        history = get_target_history()
        target = target_for(target_date, history)

        kcal_rimaste = round(target["kcal"] - tot["kcal"], 1)
        proteine_rimaste = round(target["proteine"] - tot["proteine"], 1)

        day_label = _label_giorno(target_date, today)
        day_cap = day_label[0].upper() + day_label[1:]
        riepilogo = (
            f"{day_cap} hai mangiato {round(tot['kcal'])} calorie: "
            f"{round(tot['proteine'])} grammi di proteine, "
            f"{round(tot['carboidrati'])} di carboidrati, "
            f"{round(tot['grassi'])} di grassi. "
        )
        if kcal_rimaste > 0:
            riepilogo += f"Ti restano circa {round(kcal_rimaste)} calorie e {round(proteine_rimaste)} grammi di proteine."
        else:
            riepilogo += f"Hai superato il target di {round(abs(kcal_rimaste))} calorie."

        return _json_response({
            "status": "ok",
            "data": str(target_date),
            "pasti_registrati": len(rows),
            "totale": tot,
            "target": target,
            "rimanenti": {
                "kcal": kcal_rimaste,
                "proteine": proteine_rimaste,
                "carboidrati": round(target["carboidrati"] - tot["carboidrati"], 1),
                "grassi": round(target["grassi"] - tot["grassi"], 1),
            },
            "dettaglio": rows,
            "riepilogo_vocale": riepilogo
        })

    except SheetConfigError as e:
        logging.error(f"[daily_summary] configurazione foglio errata: {e}")
        return _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": f"Errore di configurazione del foglio: {str(e)}"
        }, 500)

    except Exception as e:
        logging.error(f"[daily_summary] errore interno: {e}", exc_info=True)
        return _json_response({
            "status": "error",
            "message": f"Errore nel riepilogo: {str(e)}",
            "riepilogo_vocale": "Si è verificato un errore nel riepilogo. Riprova."
        }, 500)


def _handle_day_meals(request):
    """
    Endpoint GET /day_meals?dates=YYYY-MM-DD,YYYY-MM-DD,...
    Batch per la PWA Diario: una lettura foglio, pasti di 1–7 date.
    Per ogni data include anche `target` risolto dalla storia (valid_from).
    """
    try:
        raw = (request.args.get("dates") or "").strip()
        if not raw:
            return _json_response({
                "status": "error",
                "message": "Parametro dates obbligatorio (es. dates=2026-07-22,2026-07-23)",
            }, 400)

        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if not parts or len(parts) > 7:
            return _json_response({
                "status": "error",
                "message": "Serve da 1 a 7 date ISO (YYYY-MM-DD) separate da virgola",
            }, 400)

        wanted = []
        wanted_dates = []
        seen = set()
        for p in parts:
            try:
                d = datetime.strptime(p, "%Y-%m-%d").date()
            except ValueError:
                return _json_response({
                    "status": "error",
                    "message": f"Data non valida: {p!r} (atteso YYYY-MM-DD)",
                }, 400)
            key = d.strftime("%Y-%m-%d")
            if key not in seen:
                seen.add(key)
                wanted.append(key)
                wanted_dates.append(d)

        all_rows = get_all_meal_rows()
        by_date = {}
        for m in all_rows:
            by_date.setdefault(m["date"], []).append(m)

        history = get_target_history()
        days = {}
        for key, d in zip(wanted, wanted_dates):
            days[key] = {
                "dettaglio": by_date.get(key, []),
                "target": target_for(d, history),
            }
        return _json_response({"status": "ok", "days": days})

    except SheetConfigError as e:
        logging.error(f"[day_meals] configurazione foglio errata: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)

    except Exception as e:
        logging.error(f"[day_meals] errore interno: {e}", exc_info=True)
        return _json_response({
            "status": "error",
            "message": f"Errore nel caricamento pasti: {str(e)}",
        }, 500)


def _handle_dashboard(request):
    """
    Endpoint GET /dashboard
    Ritorna il pacchetto dati completo per la webapp: pasti di oggi,
    trend (settimana / mese / anno), target. Una sola lettura del foglio pasti.

    Query: week_offset=N (default 0, intero <= 0). N=0 → ultimi 7 giorni
    (today-6…today); N=-1 → i 7 giorni precedenti, ecc.
    """
    try:
        today = datetime.now(TZ_ITALY).date()
        today_str = today.strftime("%Y-%m-%d")

        raw_off = (request.args.get("week_offset") or "0").strip()
        try:
            week_offset = int(raw_off)
        except ValueError:
            return _json_response({
                "status": "error",
                "message": "week_offset deve essere un intero <= 0",
            }, 400)
        if week_offset > 0:
            week_offset = 0

        all_rows = get_all_meal_rows()

        # Pasti di oggi. `id` = UUID reale della riga (per tap-to-edit /
        # swipe-to-delete). Le righe storiche senza id ricevono un fallback
        # "legacy-N": univoco come key React ma NON valido per update/delete
        # (il frontend, Sessione 2, disabilita le azioni su questi id).
        oggi_rows = []
        for i, m in enumerate(r for r in all_rows if r["date"] == today_str):
            oggi_rows.append({
                "id": m["id"] or f"legacy-{i}",
                "pasto": m["pasto"],
                "time": m["time"],
                "alimento": m["alimento"],
                "grammi": m["grammi"],
                "kcal": m["kcal"],
                "proteine": m["proteine"],
                "carboidrati": m["carboidrati"],
                "grassi": m["grassi"],
                "fonte": m["fonte"] or "voce",
            })

        # Trend dalle stesse righe gia' lette
        kcal_by_date = {}
        for m in all_rows:
            kcal_by_date[m["date"]] = kcal_by_date.get(m["date"], 0) + m["kcal"]

        from sheets_client import WEEKDAY_IT, MONTH_IT

        history = get_target_history()

        # Finestra settimanale: 7 giorni che terminano in today + week_offset*7
        # offset 0 → today-6…today; offset -1 → today-13…today-7; …
        week_end = today + timedelta(days=week_offset * 7)
        week_start = week_end - timedelta(days=6)
        settimana = []
        for j in range(6, -1, -1):
            d = week_end - timedelta(days=j)
            d_str = d.strftime("%Y-%m-%d")
            t_day = target_for(d, history)
            settimana.append({
                "label": WEEKDAY_IT[d.weekday()],
                "date": d_str,
                "kcal": round(kcal_by_date.get(d_str, 0), 1),
                "target_kcal": t_day["kcal"],
            })

        # Ultime 5 settimane rolling (7 giorni ciascuna): media giornaliera
        # sul bucket (giorni senza pasti contano 0). date = inizio bucket.
        # target_kcal = media dei target giornalieri del bucket.
        mensile = []
        for w in range(4, -1, -1):
            start = today - timedelta(days=(w * 7) + 6)
            day_totals = []
            day_targets = []
            for i in range(7):
                d = start + timedelta(days=i)
                day_totals.append(kcal_by_date.get(d.strftime("%Y-%m-%d"), 0))
                day_targets.append(target_for(d, history)["kcal"])
            avg = round(sum(day_totals) / 7, 1) if any(day_totals) else 0
            avg_tgt = round(sum(day_targets) / 7, 1) if day_targets else 0
            mensile.append({
                "label": f"{start.day}/{start.month}",
                "date": start.strftime("%Y-%m-%d"),
                "kcal": avg,
                "target_kcal": avg_tgt,
            })

        # Ultimi 12 mesi di calendario: media giornaliera sui giorni con
        # almeno un pasto (0 se nessun pasto nel mese).
        # target_kcal = media dei target su tutti i giorni del mese nel range
        # (mese corrente: fino a oggi), allineata al peso usato per actual.
        annuale = []
        for m_offset in range(11, -1, -1):
            # Primo giorno del mese m_offset mesi fa
            y = today.year
            mo = today.month - m_offset
            while mo <= 0:
                mo += 12
                y -= 1
            month_start = date(y, mo, 1)
            if mo == 12:
                month_end = date(y + 1, 1, 1) - timedelta(days=1)
            else:
                month_end = date(y, mo + 1, 1) - timedelta(days=1)
            logged = []
            target_days = []
            d = month_start
            while d <= month_end:
                d_str = d.strftime("%Y-%m-%d")
                if d_str in kcal_by_date:
                    logged.append(kcal_by_date[d_str])
                # Peso target: mese corrente solo fino a oggi
                if d <= today:
                    target_days.append(target_for(d, history)["kcal"])
                d += timedelta(days=1)
            avg = round(sum(logged) / len(logged), 1) if logged else 0
            avg_tgt = round(sum(target_days) / len(target_days), 1) if target_days else 0
            annuale.append({
                "label": MONTH_IT[mo - 1],
                "date": month_start.strftime("%Y-%m-%d"),
                "kcal": avg,
                "target_kcal": avg_tgt,
            })

        # Solo lettura dalla history gia' caricata: evita get_config_targets()
        # che puo' riscrivere il tab Config e contendersi Sheets sotto poll/pager
        # (sintomo tipico: 503 intermittenti su /dashboard).
        target = target_for(today, history)

        return _json_response({
            "status": "ok",
            "oggi": {
                "data": today_str,
                "pasti": oggi_rows,
                "totale": _totals(oggi_rows),
            },
            "storico_settimanale": settimana,
            "storico_mensile": mensile,
            "storico_annuale": annuale,
            "target": target,
            "week_offset": week_offset,
            "week_start": week_start.strftime("%Y-%m-%d"),
            "week_end": week_end.strftime("%Y-%m-%d"),
        })

    except SheetConfigError as e:
        logging.error(f"[dashboard] configurazione foglio errata: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)

    except Exception as e:
        logging.error(f"[dashboard] errore interno: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _handle_get_config(request):
    """Endpoint GET /config — target corrente + storia fasce."""
    try:
        target = get_config_targets()
        history = get_target_history()
        return _json_response({
            "status": "ok",
            "target": target,
            "target_history": history,
        })
    except Exception as e:
        logging.error(f"[config:get] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _handle_set_config(request):
    """
    Endpoint POST /config
    Body JSON: {
      "target": {"kcal":2200,"proteine":165,"carboidrati":220,"grassi":70},
      "mode": "from"|"day"|"range",   # default from
      "start": "YYYY-MM-DD",          # default oggi (o da effective/valid_from)
      "end": "YYYY-MM-DD"             # obbligatorio se mode=range
    }
    Compat: effective today|tomorrow oppure valid_from → mode=from.
    """
    try:
        body = request.get_json(silent=True) or {}
        target = body.get("target", body)
        today = _now_italy().date()

        def _parse_iso(raw, field):
            s = str(raw or "").strip()
            if not s:
                return None
            try:
                return datetime.strptime(s[:10], "%Y-%m-%d").date()
            except ValueError:
                raise ValueError(f"Campo '{field}' non valido. Usa YYYY-MM-DD.")

        try:
            start = _parse_iso(body.get("start"), "start")
            end = _parse_iso(body.get("end"), "end")
            valid_from = _parse_iso(body.get("valid_from"), "valid_from")
        except ValueError as e:
            return _json_response({"status": "error", "message": str(e)}, 400)

        mode = str(body.get("mode") or "").strip().lower()
        effective = str(body.get("effective") or "").strip().lower()

        # Compat legacy
        if not mode:
            if valid_from is not None:
                mode = "from"
                start = valid_from
            elif effective in ("tomorrow", "domani"):
                mode = "from"
                start = today + timedelta(days=1)
            elif effective in ("today", "oggi") or effective == "":
                mode = "from"
                if start is None:
                    start = today
            else:
                mode = "from"
                if start is None:
                    start = today

        if start is None:
            start = today

        if mode in ("day", "solo", "single"):
            mode = "day"
            end = start
        elif mode in ("range", "intervallo"):
            mode = "range"
            if end is None:
                return _json_response({
                    "status": "error",
                    "message": "Per mode=range serve 'end' (YYYY-MM-DD)",
                }, 400)
        else:
            mode = "from"

        saved = apply_target_span(target, mode=mode, start=start, end=end)
        history = get_target_history()
        return _json_response({
            "status": "ok",
            "target": saved,
            "target_history": history,
            "mode": mode,
            "start": start.strftime("%Y-%m-%d"),
            "end": (end.strftime("%Y-%m-%d") if end is not None and mode != "from" else None),
        })
    except ValueError as e:
        return _json_response({"status": "error", "message": str(e)}, 400)
    except Exception as e:
        logging.error(f"[config:set] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


# ---------------------------------------------------------------------------
# Catalogo personale + ricerca + log da catalogo
# ---------------------------------------------------------------------------

def _catalog_public(entry: dict) -> dict:
    """Shape JSON uniforme per catalogo / search results."""
    return {
        "id": entry.get("id", ""),
        "nome": entry.get("nome", ""),
        "alias": entry.get("alias", ""),
        "barcode": entry.get("barcode", ""),
        "per_100g": entry.get("per_100g") or {},
        "fonte": entry.get("fonte", "manuale"),
        "off_code": entry.get("off_code", ""),
        "volte": entry.get("volte", 0),
        "ultimo_uso": entry.get("ultimo_uso", ""),
        "preferito": bool(entry.get("preferito")),
        "origine": "catalogo",
    }


def _handle_get_catalog(request):
    """GET /catalog?q= — lista ordinata, filtro opzionale."""
    try:
        q = request.args.get("q", "")
        items = [_catalog_public(e) for e in list_catalog(q)]
        return _json_response({"status": "ok", "items": items})
    except SheetConfigError as e:
        logging.error(f"[catalog:get] foglio: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)
    except Exception as e:
        logging.error(f"[catalog:get] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _handle_post_catalog(request):
    """
    POST /catalog
    - upsert (default): { nome, per_100g, barcode?, alias?, fonte?, preferito?, id? }
    - action=star|unstar|delete: { id, action }
    """
    try:
        body = request.get_json(silent=True) or {}
        action = str(body.get("action", "")).strip().lower()

        if action in ("star", "unstar", "delete"):
            catalog_id = str(body.get("id", "")).strip()
            if not catalog_id:
                return _json_response({
                    "status": "error",
                    "message": "Campo 'id' obbligatorio per action star/unstar/delete.",
                }, 400)
            if action == "delete":
                ok = delete_catalog_entry(catalog_id)
                if not ok:
                    return _json_response({
                        "status": "not_found",
                        "id": catalog_id,
                        "message": f"Nessun prodotto catalogo con id {catalog_id}.",
                    }, 404)
                return _json_response({"status": "ok", "id": catalog_id, "deleted": True})

            entry = set_catalog_preferito(catalog_id, preferito=(action == "star"))
            if not entry:
                return _json_response({
                    "status": "not_found",
                    "id": catalog_id,
                    "message": f"Nessun prodotto catalogo con id {catalog_id}.",
                }, 404)
            return _json_response({"status": "ok", "item": _catalog_public(entry)})

        # Upsert
        nome = str(body.get("nome", "")).strip()
        per_100g = body.get("per_100g") or {}
        if not nome:
            return _json_response({
                "status": "error",
                "message": "Campo 'nome' obbligatorio.",
            }, 400)
        if not isinstance(per_100g, dict) or "kcal" not in per_100g:
            # Accetta anche kcal/P/C/G a primo livello
            if any(k in body for k in ("kcal", "proteine", "carboidrati", "grassi")):
                per_100g = {
                    "kcal": body.get("kcal", 0),
                    "proteine": body.get("proteine", 0),
                    "carboidrati": body.get("carboidrati", 0),
                    "grassi": body.get("grassi", 0),
                }
            else:
                return _json_response({
                    "status": "error",
                    "message": "Serve per_100g con almeno kcal (o kcal a primo livello).",
                }, 400)

        preferito = body.get("preferito")
        if preferito is not None:
            preferito = bool(preferito)

        entry = upsert_catalog_entry(
            nome=nome,
            per_100g=per_100g,
            barcode=str(body.get("barcode", "")).strip(),
            alias=str(body.get("alias", "")).strip(),
            fonte=str(body.get("fonte", "manuale")).strip() or "manuale",
            off_code=str(body.get("off_code", body.get("barcode", ""))).strip(),
            preferito=preferito,
            catalog_id=str(body.get("id", "")).strip(),
        )
        return _json_response({"status": "ok", "item": _catalog_public(entry)})

    except ValueError as e:
        return _json_response({"status": "error", "message": str(e)}, 400)
    except SheetConfigError as e:
        logging.error(f"[catalog:post] foglio: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)
    except Exception as e:
        logging.error(f"[catalog:post] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _search_off_text(q: str, page_size: int = 8) -> list[dict]:
    """
    Ricerca testuale Open Food Facts. Ritorna lista nello shape search result
    (origine=off). Fallisce silenziosamente → lista vuota.
    """
    import urllib.request
    import urllib.error
    import urllib.parse

    needle = (q or "").strip()
    if not needle or len(needle) < 2:
        return []

    params = urllib.parse.urlencode({
        "search_terms": needle,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": page_size,
        "fields": "code,product_name,product_name_it,brands,nutriments",
    })
    url = f"https://world.openfoodfacts.org/cgi/search.pl?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": OFF_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=OFF_TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logging.warning(f"[search] OFF text search fallita: {e}")
        return []

    out = []
    for product in data.get("products") or []:
        code = str(product.get("code") or "").strip()
        per100 = _off_per_100g(product)
        if not code or per100 is None:
            continue
        nome = _off_display_name(product, code)
        out.append({
            "id": "",
            "nome": nome,
            "alias": "",
            "barcode": code,
            "per_100g": per100,
            "fonte": "off",
            "off_code": code,
            "volte": 0,
            "ultimo_uso": "",
            "preferito": False,
            "origine": "off",
        })
    return out


def _handle_search(request):
    """
    POST /search  body: { "q": "yogurt" }
    q vuoto → top frequenti/preferiti dal catalogo.
    Altrimenti match catalogo; se < 3 hit → aggiunge OFF text search.
    """
    try:
        body = request.get_json(silent=True) or {}
        q = str(body.get("q", "")).strip()

        catalog_hits = [_catalog_public(e) for e in list_catalog(q)]
        results = list(catalog_hits)

        if q and len(catalog_hits) < 3:
            # Evita duplicati barcode gia' in catalogo
            seen = {
                (r.get("barcode") or r.get("off_code") or "").strip()
                for r in catalog_hits
                if (r.get("barcode") or r.get("off_code"))
            }
            for off_item in _search_off_text(q):
                code = (off_item.get("barcode") or "").strip()
                if code and code in seen:
                    continue
                results.append(off_item)
                if code:
                    seen.add(code)

        return _json_response({
            "status": "ok",
            "q": q,
            "items": results,
        })

    except SheetConfigError as e:
        logging.error(f"[search] foglio: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)
    except Exception as e:
        logging.error(f"[search] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _per100_from_body(body):
    """
    Valida i valori nutrizionali per 100g eventualmente gia' inclusi nel body
    (es. arrivano dalla risposta di /search appena fatta): se validi, evitano
    una seconda chiamata di rete a OFF dentro _handle_log_catalog.
    Ritorna None se mancanti/non validi.
    """
    raw = body.get("per_100g")
    if not isinstance(raw, dict):
        return None
    try:
        kcal = float(raw.get("kcal"))
    except (TypeError, ValueError):
        return None

    def numf(key):
        try:
            return round(float(raw.get(key)), 1)
        except (TypeError, ValueError):
            return 0.0

    return {
        "kcal": round(kcal, 1),
        "proteine": numf("proteine"),
        "carboidrati": numf("carboidrati"),
        "grassi": numf("grassi"),
    }


def _handle_log_catalog(request):
    """
    POST /log_catalog
    Body: { catalog_id? | barcode? | off_code?, grammi, fonte?, nome?, per_100g? }
    Risolve scheda (catalogo, valori gia' forniti dal client, o fetch OFF),
    scala, scrive pasto, bump usage / upsert.
    """
    body = request.get_json(silent=True) or {}
    resolved, date_err = _resolve_meal_datetimes_or_400(body)
    if date_err:
        return date_err
    recorded_at, declared_at, etichetta, _from_speech = resolved
    try:
        catalog_id = str(body.get("catalog_id", body.get("id", ""))).strip()
        barcode = str(body.get("barcode", "")).strip()
        off_code = str(body.get("off_code", "")).strip() or barcode
        fonte = body.get("fonte", "pwa-catalogo")
        if fonte not in _FONTI_VALIDE:
            fonte = "pwa-catalogo"

        try:
            grammi = float(body.get("grammi"))
        except (TypeError, ValueError):
            grammi = None
        if grammi is None or grammi <= 0:
            return _json_response({
                "status": "error",
                "message": "Campo 'grammi' obbligatorio e > 0.",
                "riepilogo_vocale": "Indica i grammi.",
            }, 400)

        entry = None
        if catalog_id:
            entry = get_catalog_by_id(catalog_id)
        if entry is None and barcode:
            entry = get_catalog_by_barcode(barcode)
        if entry is None and off_code and off_code != barcode:
            entry = get_catalog_by_barcode(off_code)

        nome = None
        per100 = None
        resolved_barcode = barcode or off_code

        if entry:
            nome = entry["nome"]
            per100 = entry["per_100g"]
            resolved_barcode = entry.get("barcode") or entry.get("off_code") or resolved_barcode
            catalog_id = entry["id"]
        else:
            code = resolved_barcode
            client_per100 = _per100_from_body(body)
            if client_per100:
                # Valori gia' forniti dal client (es. arrivano dalla risposta
                # di /search appena fatta): evita una seconda chiamata di
                # rete a OFF, che altrove ha causato "failed to fetch" per
                # timeout lato client con OFF lento / cold start.
                per100 = client_per100
                fallback_nome = f"Prodotto {code}" if code else "Prodotto"
                nome = str(body.get("nome", "")).strip() or fallback_nome
                resolved_barcode = code
            else:
                # Nessun valore dal client: fetch OFF (fallback, es. client
                # non aggiornato o chiamata diretta senza passare da /search).
                if not code or not code.isdigit():
                    return _json_response({
                        "status": "error",
                        "message": "Prodotto non trovato nel catalogo e nessun barcode OFF valido.",
                        "riepilogo_vocale": "Prodotto non trovato.",
                    }, 404)
                product, err = _fetch_off_product(code)
                if err:
                    return _json_response({
                        "status": "error",
                        "message": err,
                        "riepilogo_vocale": err,
                    }, 502)
                if product is None:
                    return _json_response({
                        "status": "not_found",
                        "message": f"Prodotto {code} non trovato.",
                        "riepilogo_vocale": "Prodotto non trovato.",
                    }, 404)
                per100 = _off_per_100g(product)
                nome = _off_display_name(product, code)
                if per100 is None:
                    return _json_response({
                        "status": "error",
                        "message": f"'{nome}' senza valori nutrizionali utilizzabili.",
                        "riepilogo_vocale": "Mancano i valori nutrizionali.",
                    }, 422)
                resolved_barcode = code

        grammi = round(grammi, 1)
        fattore = grammi / 100.0
        item = {
            "alimento": nome,
            "grammi": grammi,
            "kcal": round(per100["kcal"] * fattore, 1),
            "proteine": round(per100["proteine"] * fattore, 1),
            "carboidrati": round(per100["carboidrati"] * fattore, 1),
            "grassi": round(per100["grassi"] * fattore, 1),
        }

        now_ts = recorded_at.strftime("%Y-%m-%d %H:%M:%S")
        tipo = _resolve_tipo_pasto(body)
        append_meal_rows(
            [item],
            recorded_at=recorded_at,
            declared_at=declared_at,
            fonte=fonte,
            tipo_pasto=tipo,
        )

        # Upsert / bump catalogo
        try:
            upsert_catalog_entry(
                catalog_id=catalog_id or "",
                nome=nome,
                per_100g=per100,
                barcode=resolved_barcode or "",
                off_code=resolved_barcode or "",
                fonte=entry.get("fonte", "off") if entry else "off",
                bump_usage=True,
                now_ts=now_ts,
            )
        except Exception as e:
            logging.warning(f"[log_catalog] upsert catalogo fallito: {e}")

        riepilogo = (
            f"Registrato: {nome}, {round(grammi)} grammi. "
            f"{round(item['kcal'])} calorie, {round(item['proteine'])} grammi di proteine."
        )
        payload = {
            "status": "ok",
            "items": [item],
            "totale": {k: item[k] for k in ("kcal", "proteine", "carboidrati", "grassi")},
            "riepilogo_vocale": riepilogo,
        }
        if tipo:
            payload["tipo_pasto"] = tipo
        return _json_response(_attach_declared_meta(payload, declared_at, etichetta))

    except SheetConfigError as e:
        logging.error(f"[log_catalog] foglio: {e}")
        return _json_response({
            "status": "error",
            "message": str(e),
            "riepilogo_vocale": f"Errore di configurazione del foglio: {str(e)}",
        }, 500)
    except Exception as e:
        logging.error(f"[log_catalog] errore: {e}", exc_info=True)
        return _json_response({
            "status": "error",
            "message": f"Errore interno: {str(e)}",
            "riepilogo_vocale": "Si è verificato un errore. Riprova.",
        }, 500)

