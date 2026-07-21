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
    set_config_targets,
    update_meal_row,
    delete_meal_row,
    pasto_from_hour,
    sheet_health,
    SheetConfigError,
)

# Timezone Italia
TZ_ITALY = timezone(timedelta(hours=2))

# API key semplice per proteggere la Cloud Function
API_KEY = os.environ.get("VOICETRACK_API_KEY", "")

# Versione applicativa, esposta da /health (aggiornare a ogni deploy significativo)
APP_VERSION = os.environ.get("APP_VERSION", "deploy5-cors-open-2026-07-21")

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
_FONTI_VALIDE = {"tasker-voce", "pwa-voce", "pwa-testo", "pwa-barcode", "voce", "barcode"}
_FONTE_DEFAULT = "tasker-voce"


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
      GET  /dashboard     → dati per la webapp
      GET  /config        → legge i target
      POST /config        → salva i target
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
    elif path == "/dashboard" and request.method == "GET":
        return _handle_dashboard(request)
    elif path == "/config" and request.method == "GET":
        return _handle_get_config(request)
    elif path == "/config" and request.method == "POST":
        return _handle_set_config(request)
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
    try:
        body = request.get_json(silent=True) or {}
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

        # 1. Chiama l'LLM per estrarre alimenti e macro
        llm_result = parse_meal_with_llm(text)

        logging.info(f"[log_meal] risposta LLM: {json.dumps(llm_result, ensure_ascii=False)}")

        # 2. Se l'LLM chiede chiarimento, ritorna subito senza scrivere
        if llm_result.get("status") == "needs_clarification":
            return _json_response(llm_result)

        # 3. Se l'LLM ha estratto gli alimenti, scrivi su Google Sheets
        if llm_result.get("status") == "ok" and llm_result.get("items"):
            now = datetime.now(TZ_ITALY)
            append_meal_rows(llm_result["items"], now, fonte=fonte)

        return _json_response(llm_result)

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

    kcal = num("energy-kcal_100g")
    if kcal is None:
        kj = num("energy_100g")  # OFF: spesso solo kJ
        kcal = round(kj / 4.184, 1) if kj is not None else None
    if kcal is None:
        return None

    return {
        "kcal": round(kcal, 1),
        "proteine": round(num("proteins_100g") or 0.0, 1),
        "carboidrati": round(num("carbohydrates_100g") or 0.0, 1),
        "grassi": round(num("fat_100g") or 0.0, 1),
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
    try:
        body = request.get_json(silent=True) or {}
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

        now = datetime.now(TZ_ITALY)
        append_meal_rows([item], now, fonte=fonte)

        riepilogo = (
            f"Registrato: {nome}, {round(grammi)} grammi. "
            f"{round(item['kcal'])} calorie, {round(item['proteine'])} grammi di proteine."
        )
        return _json_response({
            "status": "ok",
            "items": [item],
            "totale": {k: item[k] for k in ("kcal", "proteine", "carboidrati", "grassi")},
            "riepilogo_vocale": riepilogo
        })

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
_UPDATABLE_FIELDS = ("alimento", "grammi", "kcal", "proteine", "carboidrati", "grassi")


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
        if date_str:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        else:
            target_date = datetime.now(TZ_ITALY).date()

        rows = get_today_rows(target_date)
        tot = _totals(rows)

        # Target letti dalla tab Config (creata coi default se non esiste)
        target = get_config_targets()

        kcal_rimaste = round(target["kcal"] - tot["kcal"], 1)
        proteine_rimaste = round(target["proteine"] - tot["proteine"], 1)

        riepilogo = (
            f"Oggi hai mangiato {round(tot['kcal'])} calorie: "
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


def _handle_dashboard(request):
    """
    Endpoint GET /dashboard
    Ritorna il pacchetto dati completo per la webapp: pasti di oggi,
    trend (settimana / mese / anno), target. Una sola lettura del foglio pasti.
    """
    try:
        today = datetime.now(TZ_ITALY).date()
        today_str = today.strftime("%Y-%m-%d")

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

        # Ultimi 7 giorni (kcal giornaliere)
        settimana = []
        for j in range(6, -1, -1):
            d = today - timedelta(days=j)
            d_str = d.strftime("%Y-%m-%d")
            settimana.append({
                "label": WEEKDAY_IT[d.weekday()],
                "date": d_str,
                "kcal": round(kcal_by_date.get(d_str, 0), 1),
            })

        # Ultime 5 settimane rolling (7 giorni ciascuna): media giornaliera
        # sul bucket (giorni senza pasti contano 0). date = inizio bucket.
        mensile = []
        for w in range(4, -1, -1):
            start = today - timedelta(days=(w * 7) + 6)
            day_totals = []
            for i in range(7):
                d = start + timedelta(days=i)
                day_totals.append(kcal_by_date.get(d.strftime("%Y-%m-%d"), 0))
            avg = round(sum(day_totals) / 7, 1) if any(day_totals) else 0
            mensile.append({
                "label": f"{start.day}/{start.month}",
                "date": start.strftime("%Y-%m-%d"),
                "kcal": avg,
            })

        # Ultimi 12 mesi di calendario: media giornaliera sui giorni con
        # almeno un pasto (0 se nessun pasto nel mese).
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
            d = month_start
            while d <= month_end:
                d_str = d.strftime("%Y-%m-%d")
                if d_str in kcal_by_date:
                    logged.append(kcal_by_date[d_str])
                d += timedelta(days=1)
            avg = round(sum(logged) / len(logged), 1) if logged else 0
            annuale.append({
                "label": MONTH_IT[mo - 1],
                "date": month_start.strftime("%Y-%m-%d"),
                "kcal": avg,
            })

        target = get_config_targets()

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
        })

    except SheetConfigError as e:
        logging.error(f"[dashboard] configurazione foglio errata: {e}")
        return _json_response({"status": "error", "message": str(e)}, 500)

    except Exception as e:
        logging.error(f"[dashboard] errore interno: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _handle_get_config(request):
    """Endpoint GET /config — ritorna i target giornalieri."""
    try:
        target = get_config_targets()
        return _json_response({"status": "ok", "target": target})
    except Exception as e:
        logging.error(f"[config:get] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)


def _handle_set_config(request):
    """
    Endpoint POST /config
    Body JSON: {"target": {"kcal":2200,"proteine":165,"carboidrati":220,"grassi":70}}
    (accetta anche i 4 campi al primo livello, per comodita').
    """
    try:
        body = request.get_json(silent=True) or {}
        target = body.get("target", body)
        saved = set_config_targets(target)
        return _json_response({"status": "ok", "target": saved})
    except Exception as e:
        logging.error(f"[config:set] errore: {e}", exc_info=True)
        return _json_response({"status": "error", "message": f"Errore: {str(e)}"}, 500)
