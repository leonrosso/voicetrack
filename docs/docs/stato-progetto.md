# VoiceTrack — Stato del Progetto (documento consolidato)

*Versione 1.0 — 20 luglio 2026. Questo documento sostituisce come fonte unica di contesto: `VoiceTrack_Roadmap.md`, `VoiceTrack_Piano_Consolidamento.md`, `VoiceTrack_Manutenzione.md`, `VoiceTrack_Rifiniture_Deploy5.md`. Le parti già completate sono condensate in §5 (storia) e §3 (censimento); i lavori aperti stanno in §7; i desideri futuri, inclusa l'integrazione Gemini, in §8.*

*Regola di aggiornamento: questo file si modifica **solo per sezione**, mai riscritto da zero. Le novità di ogni sessione di lavoro vanno prima in `docs/diario-sessioni.md` (append-only) e poi riportate qui nella sezione pertinente. Vedi `CLAUDE.md` / `.cursor/rules/voicetrack.mdc` per le regole complete.*

---

## 1. Visione

Sistema personale di tracciamento calorico e macronutrienti attivabile a voce, in italiano, che sostituisce Lifesum. Principio architetturale: **un solo cervello, client intercambiabili** — la Cloud Function è l'unica sede della logica; Tasker e PWA sono client sottili sullo stesso contratto HTTP. Dati di piena proprietà su Google Sheets.

## 2. Architettura attuale

```
CLIENT 1 — Tasker (scorciatoia personale, schermo bloccato)
  Tasto Home → AutoVoice ("traccia pasto" / "scansiona prodotto")
  → Tasker → HTTP POST (o Browse URL verso la PWA per il barcode)
  → TTS legge la risposta

CLIENT 2 — PWA (client universale, condivisibile con un link)
  https://voicetrack-chi.vercel.app
  Tab Traccia (webkitSpeechRecognition it-IT hardcoded + SpeechSynthesis)
  Overlay CERCA (catalogo + OFF; dal bottone azioni rapide, fuori dal carosello)
  Tab Barcode (BarcodeDetector + getUserMedia)
  Dashboard + Config
  Azioni rapide Diario: TESTO / CERCA / SCAN / VOCE

BACKEND — Google Cloud Function `voicetrack` (gen2, europe-west1, python312)
  /log_meal        → Claude API → JSON → Sheets → riepilogo_vocale
  /scan_barcode    → Open Food Facts v2 → Sheets (gestisce "prodotto non trovato"; upsert Catalogo)
  /catalog         → CRUD catalogo personale (tab Sheets `Catalogo`)
  /search          → ricerca catalogo + OFF text search
  /log_catalog     → log da catalogo/OFF con grammi → Sheets + bump usage
  /daily_summary   → legge Sheets, totali giornata
  /day_meals       → batch pasti 1–7 date (PWA Diario; niente TTS)
  /dashboard, /config → PWA (tab Config = fonte unica dei target)
  /health          → check senza chiave, usato come warm-up anti cold-start

DATABASE — Google Sheets (tab dati `diethropic` + tab `Config` + tab `Catalogo`)
  Pasti: timestamp | alimento | grammi | kcal | proteine | carboidrati
  | grassi | fonte (tasker-voce / pwa-voce / pwa-testo / pwa-barcode / pwa-catalogo) | note | id | data_dichiarata
  Catalogo: id | nome | alias | barcode | kcal/P/C/G per 100g | fonte | off_code | volte | ultimo_uso | preferito
```

Percorsi **morti** (non riproporre): "Hey Google → Google Assistant → AutoVoice" (hotword bloccata a livello di sistema, Assistant sostituito da Gemini); barcode via AutoBarcode/Tasker (superato dal barcode in PWA — la scansione richiede comunque lo schermo).

## 3. Censimento configurazioni critiche

Se si perdono, la pipeline muore in silenzio.

- **AutoVoice:** Default Recognize Settings → Language Code `it-IT`; profili Recognized con Command Filter `traccia pasto` e `scansiona prodotto` (Exact Command disattivato); AutoVoice = assistente predefinito; task passthrough verso Assistant per i comandi non riconosciuti (Spotify ecc.).
- **Tasker:** variabili `%VTURL` e `%VTKEY`; guard clause su `%http_data`. Backup Tasker da esportare dopo ogni modifica lato Android.
- **Google Cloud:** progetto `diethropic`, regione `europe-west1`, function `voicetrack` gen2, runtime `python312`, 256 MB, timeout 60 s, entry-point `voicetrack`, `--allow-unauthenticated`; `.env.yaml` con `VOICETRACK_API_KEY`, `SHEET_NAME=diethropic`, chiave Anthropic, ID foglio. **I flag di deploy devono restare identici a ogni redeploy.**
- **URL equivalenti:** `https://europe-west1-diethropic.cloudfunctions.net/voicetrack` e `https://voicetrack-ki3pu27iiq-ew.a.run.app`.
- **Sheets:** foglio condiviso col service account; tab `diethropic` + tab `Config` (auto-creato) + tab `Catalogo` (auto-creato al primo `/catalog` o `/search` / scan ok). Schema pasti **A–K**: `timestamp` (quando registrato) … `id` (J) + **`data_dichiarata` (K)** = giorno del pasto (coincide con timestamp se non specificato; mezzogiorno del giorno scelto se backdatato). Righe legacy senza K: si usa il timestamp. **Operativo:** intestazione `data_dichiarata` in K1 sul foglio.
- **PWA:** `https://voicetrack-chi.vercel.app/`; URL backend + chiave in localStorage. CORS aperto (`*` — barriera = API key). Scan barcode: anche `vt-scan-camera-id` (deviceId back camera preferito). Cache anti cold-start: `vt-cache` (oggi + trend + target); giorni ≠ oggi: `vt-day-cache` (max 40 date, SWR). Scan: campo paste link OFF; Share Target path **`/share-off`** (+ legacy `?action=off`). Manifest: `scope: '/'`; shortcuts pressione lunga **Traccia / Scansiona / Cerca / Testo**; **`share_target`** GET `/share-off`. Solo PWA installata; dopo cambio manifest **reinstallare** l’app.
- **Sicurezza:** la chiave API vive in **tre posti** (env Cloud Function, `%VTKEY` Tasker, localStorage PWA) — ruotarla = aggiornarli tutti e tre. Rotazione consigliata ogni 6–12 mesi (anche chiave JSON del service account).
- **Sorgenti locali:** repo `voicetrack-repo/backend` (`main.py`, `sheets_client.py`, `llm_client.py`, `requirements.txt`, `.env.yaml`); frontend in `voicetrack-repo/frontend`.

## 4. Stato componenti

| Componente | Stato |
|---|---|
| Trigger Tasker "traccia pasto" (Home → AutoVoice, it-IT) | ✅ |
| Cloud Function + tutti gli endpoint (`/log_meal`, `/daily_summary`, `/day_meals`, `/dashboard`, `/config`, `/health`, `/scan_barcode`, `/catalog`, `/search`, `/log_catalog`, `/update_meal`, `/delete_meal`) | ✅ (CF deployata 2026-07-23, rev `voicetrack-00029-bob`; cache pasti+Config TTL 20s; `/day_meals` batch) |
| Log vocale su giorno passato/futuro («ieri», «domani», «sabato scorso», …) + conferma giorno nel TTS | ✅ (CF live; LLM + `data_dichiarata`; Tasker invariato) |
| Diario swipe illimitato passato/futuro + schede colorate (passato caldo / oggi verde / futuro slate) + righe pasto stesso surface/line | ✅ (codice PWA; SWR + `vt-day-cache` + fetch `/day_meals`; **swipe giorno a tutta larghezza** del `dayPager`; tab solo via bottoni; **da deployare Vercel**) |
| Card azioni rapide sul Diario (testo / cerca / scan / voce → tab Traccia o Scan) | ✅ (codice; visibile anche sui giorni storici; i log PWA usano il giorno attivo del Diario via `target_date`, ma la **voce batte** se la frase dichiara un altro giorno; fallback legacy su oggi se `target_date` assente) |
| PWA completa: dashboard, Config, voce (Deploy 3), barcode (Deploy 4), warm-up `/health` (Diario+Traccia+Scan), cache anti cold-start, schede Diario/Traccia/Scan (cambio **solo** da tab bar / azioni rapide, niente swipe tab) | ✅ |
| Scan: EAN a mano con microfono (dettatura cifre → campo) | ✅ (codice; deep link `?action=ean` / `ean_voce` / `barcode_voce` → Scan + mic, **senza** camera; **da verificare** Tasker + telefono + Vercel) |
| Scan: paste link scheda OFF + Share Target PWA | ✅ (codice; campo sotto Inquadra; `parseOffBarcode` → `/scan_barcode`; `share_target` → `/share-off` + `scope: '/'`; **dopo deploy: disinstalla/reinstalla PWA** + test OFF Condividi) |
| Catalogo personale + CERCA (frequenti/preferiti, OFF text search, log da catalogo) | ✅ (CF live; **CERCA = overlay fisso**, non tab Traccia; **stellina Diario/CERCA = toggle preferiti** con stella piena + toast; cestino in CERCA per delete; upsert match anche per nome; **da deployare Vercel** + test telefono/desktop) |
| Card trend Diario con viste Anno / Mese / Settimana (`storico_annuale` / `storico_mensile` / `storico_settimanale`) | ✅ (CF live; label kcal sopra ogni barra; **alto dx: consumate / obiettivo del range attivo** — sett: `Σ` vs `target×7`; mese: `Σ(avg×7)` vs `target×35`; anno: `Σ(avg×giorni)` vs `target×Σgiorni`; **da deployare Vercel**) |
| Campo `fonte` esteso (`tasker-voce` / `pwa-voce` / `pwa-testo` / `pwa-barcode` / `pwa-catalogo`) | ✅ |
| Parsing bevande in ml ("500 ml di birra") | 🔧 Fix proposto nel system prompt, **da verificare coi log** |
| Focus camera barcode (parte sulla lente 0.5x) | ✅ (codice su `main`; zoom hardware ~2 + `deviceId` in localStorage + AF continuo; zoom digitale 1.35; **da verificare su telefono**) |
| Colonna `id` + `/update_meal` + `/delete_meal` | ✅ (CF live) |
| Edit/delete pasti nella PWA (tap→modifica, pulsante+swipe→elimina; conferma su barra rossa inline, non tendina; pannello edit con animazione collapse altezza/opacità) | ✅ (CF live; frontend: swipe-edit = verde + bounce ~340ms poi pannello diretto senza matita/X; **stesso swipe a pannello aperto → bounce + chiude**; grammi nel pannello riscalano kcal/P/C/G da baseline; **edit + tastiera:** lock `--app-height` + `ensureEditFieldVisible` + spacer inset; **da deployare Vercel** + test telefono) |
| Scan: scelta giorno nello step quantità (Ieri/Oggi/Domani + calendario → `target_date`) | ✅ (codice; default = giorno Diario attivo; camera ed EAN stesso dialog; calendario in **overlay** come Diario (stesso enter/exit); **da verificare su telefono**) |
| Diario: calendario jump sulla card calorie (Settimana/Mese → `goToDate`) | ✅ (codice; icona subito a sinistra del testo data; **overlay** fixed a root con enter/exit easing ~240ms; tap fuori/Escape/X/data → exit poi chiude; **da verificare su telefono**) |
| Config con % macro nella PWA | ✅ (codice; editor Obiettivi con slider indipendenti, % e grammi digitabili, ±1 g per barra, **anche le kcal con barra ± (1000–4000, step 10)**, totale in rosso se ≠100% e salvataggio bloccato finché non è 100%; card Macronutrienti senza % accanto ai macro; **cambiando le kcal (slider/±/digitazione) le barre si riscalano in proporzione a 100%**, indipendenza sul tocco singolo preservata; **niente testo di aiuto** sotto il titolo — feedback solo da Ripartizione / `targetMsg`) |
| Layout Diario above-fold + Obiettivi a tutta altezza viewport | ✅ (codice; ordine calorie → azioni → macro; **fold = height fissa + grid 1fr/2fr** anti-shrink; **DayPeek peeks = stesso fold**; altezza via `--app-height`/`visualViewport` non `100dvh`; padding basso `max(40px, env(safe-area-inset-bottom))` + `viewport-fit=cover`; **hero a slot fissi** data | medio | gauge; readout centrato con fade; editor absolute nello slot medio; **data/gauge/readout tornano col gate `targetsAnimOpen`** (stesso atto di azioni/macro); collasso 2ª riga grid a `0fr` in apertura Obiettivi; **principio unificato oggi/storico**; footer Salva/Annulla fisso; anti-flash scrollbar via lock html/body + `.vt-targets-scroll`; **swipe dx/sx su tutto il dayPager** (fold+pasti) → carosello giorno, peeks adiacenti; Trend fuori; **contenimento `overflowX: clip` + `minWidth: 0`**; **guard su end/cancel** + **flushSync transition none** anti rimbalzo settle; tab Traccia/Scan solo da bottoni) |
| Trigger "scansiona prodotto" → deep link PWA + shortcuts manifest | 🔧 shortcuts PWA ✅ (Traccia/Scansiona/Cerca/Testo; **dopo deploy reinstallare**); Tasker AutoVoice ancora ⬜ (§7.3) |
| Attivazione 100% hands-free | ❌ Bloccata a livello di sistema — vedi §8 |
| Prodotti Conad su Open Food Facts | ⚠️ Auto-contribuzione progressiva durante la spesa (§7.4) |

## 5. Storia condensata e lezioni (cosa è già stato fatto)

Il percorso reale ha ribaltato la roadmap originale: la PWA (ex Fase 4) è arrivata **prima** del barcode, e il "Piano di Consolidamento" (Deploy 2-3-4: fondamenta backend, voce nella PWA, barcode nella PWA) è **completato**. AutoBarcode non è mai stato acquistato (−3-4 €). Lezioni permanenti dagli interventi passati:

1. **Lingua di riconoscimento (ricorrente):** sistema in francese, parlato in italiano → `it-IT` nelle Default Recognize Settings di AutoVoice. Gli update possono resettarla: primo sospettato se il riconoscimento impazzisce. Nella PWA il problema è strutturalmente assente (`it-IT` hardcoded).
2. **Dopo ogni redeploy:** `gcloud functions describe` (state ACTIVE) + curl diretto per isolare Cloud Function vs Tasker + verifica `%VTURL`/`%VTKEY`. Con `/health` la checklist si riduce a un solo curl.
3. **Errori silenziosi = i più costosi:** il bug "riepilogo letto ma foglio vuoto" veniva da `SHEET_NAME` sbagliata. Mantenere `_verify_sheet_exists()`, errori di config udibili via TTS, `logging.error(exc_info=True)` e i log `[log_meal]` (testo trascritto + risposta LLM).
4. **Codice nato in artifact va adattato prima del deploy** (`window.storage` → `localStorage`); Web Speech e camera **non sono testabili nell'anteprima artifact** → sviluppo frontend in locale (`npm run dev` + telefono sullo stesso Wi-Fi, AI che modifica i file direttamente — Claude Code o Cursor), deploy Vercel solo a rifinitura conclusa.
5. **PowerShell:** `curl` è alias di Invoke-WebRequest → usare `curl.exe` o `Invoke-RestMethod`, comandi su riga unica. Ogni procedura operativa va scritta in versione PowerShell.
6. **Rotazione chiave dopo esposizione in chat** già avvenuta una volta (`secrets.token_urlsafe(32)`): tocca i tre punti di §3.
7. **Lifesum trovava i prodotti Conad** solo grazie al suo database utenti proprietario (nessuna fonte italiana ufficiale); FatSecret valutata e scartata (tier Premier a pagamento per dataset non-USA). Open Food Facts confermato gratuito, senza SLA.

## 6. Nodi critici di manutenzione (tuttora validi)

- **Livello Android = il più fragile.** Update di Android/AutoVoice/Tasker possono resettare assistente predefinito (Gemini tende a riprendersi il ruolo), lingua, permessi, o far uccidere Tasker dalla battery optimization. Dopo ogni update: test "traccia pasto", verifica it-IT e assistente predefinito. Grazie alla PWA il guasto è **tollerabile, non bloccante** (paracadute).
- **Passthrough verso Assistant ha una scadenza:** si appoggia a un'app in dismissione (Assistant → Gemini). Non "se" ma "quando".
- **Claude API:** model string deprecati periodicamente (`llm_client.py`); ogni cambio modello o system prompt → rilanciare le **frasi di test standard** (§9). System prompt versionato.
- **Google Cloud:** deprecazione runtime `python312` prima o poi; migrazione Cloud Functions → Cloud Run functions in corso lato Google.
- **Schema Sheets = moltiplicatore:** i consumatori pasti sono ≥6 (`/log_meal`, `/scan_barcode`, `/daily_summary`, `/day_meals`, `/dashboard`, `/config`); il **Catalogo** è una tab separata (`/catalog`, `/search`, `/log_catalog`) e non allunga lo schema A–K dei pasti. **Ogni colonna aggiunta ai pasti si aggiorna in tutti i consumatori insieme, nella stessa sessione.** Nessuna validazione numerica: una riga malformata inquina i totali in silenzio. `pasto` derivato dall'orario di **`data_dichiarata`** (fallback timestamp) è un'euristica fragile; i backdate a mezzogiorno finiscono spesso in «pranzo».
- **Open Food Facts:** comunitaria, senza SLA, ha già cambiato versione (v0→v2). Mantenere la gestione "prodotto non trovato"; Nutritionix resta il fallback anticipabile.
- **PWA/Vercel:** dipendenze npm da aggiornare (React, Vite, vite-plugin-pwa, eventuale `@zxing/browser`), service worker in `autoUpdate` (un deploy rotto si propaga da solo), icone placeholder da rifare, termini free tier Vercel.
- **Costi:** ~1-2 €/mese (Claude API); tutto il resto free tier. Riverificare periodicamente.

## 7. Lavori aperti (piano "Deploy 5" — Rifiniture)

Metodo per il frontend: repo locale + `npm run dev` + anteprima live sul telefono; AI che modifica i file direttamente; deploy Vercel a fine rifinitura. Test su telefono reale, mai in artifact. **Limitazione PWA:** layout viewport / safe-area / gesture bar Android e il salto `100dvh` cold-start vs refresh si verificano solo in modalità **standalone** (app installata); Chrome con barra indirizzi (`npm run dev`) maschera il problema. Altre limitazioni già note: Web Speech e camera non in anteprima sandbox.

### 7.1 Sessione 1 — Backend: identità di riga
- Colonna `id` (UUID generato da `/log_meal` e `/scan_barcode`); righe storiche senza `id` tollerate in lettura.
- Nuovi endpoint `/update_meal` e `/delete_meal` (POST, stessa chiave, stesso CORS ristretto).
- Aggiornare **insieme** tutti i consumatori dello schema (regola §6).
- Accettazione: UUID in ogni riga nuova; update/delete via curl funzionanti; `/daily_summary` e `/dashboard` ok con righe vecchie e nuove; Tasker invariato.

### 7.2 Sessione 2 — Frontend PWA
- **Edit/delete pasti:** tap matita / swipe → pannello modifica → `/update_meal`; swipe elimina → conferma **sulla barra rossa** → `/delete_meal`. Swipe modifica: reveal verde + bounce (~340ms) poi pannello diretto (niente matita/X); **a pannello aperto lo stesso swipe** ripete bounce e chiude. Grammi nel pannello riscalano kcal/P/C/G dalla baseline di apertura. Con tastiera aperta: lock `--app-height` (fold stabile), scroll del campo attivo nella `visualViewport`, spacer inset sotto i pasti. Refresh dashboard + invalidazione cache `vt-cache`.
- **Config collegata:** ✅ (codice) editor Obiettivi con **slider di ripartizione indipendenti** per ogni macro (`macroPct`): trascinandone uno gli altri due NON cambiano, quindi il totale può differire da 100. La riga «Ripartizione» mostra il totale reale e diventa **rossa se ≠ 100%**, standard a 100%; `saveTargets` **blocca il salvataggio** se la somma ≠ 100% con messaggio dedicato nel pannello. **Digitando le calorie** (`onTargetKcalChange`) le barre tengono le proporzioni attuali ma vengono **riscalate a somma 100** (`normalize100`) e i grammi si ricalcolano di conseguenza (`gramsFromPctOne`): è il modo naturale per riportare la ripartizione a 100%. I **grammi salvati sono derivati** da split + kcal (P/C ÷4, G ÷9) e riempiono esattamente le calorie quando la somma è 100; all'apertura le % sono normalizzate a 100 dai grammi salvati. Rimosse le % dei macro accanto a ogni voce nella card Macronutrienti del Diario. Da verificare su telefono + deploy Vercel.
- **Card azioni rapide sul Diario:** ✅ (codice) tra Macronutrienti e Pasti di oggi, quattro bottoni rotondi (TESTO / CERCA / SCAN / VOCE) visibili anche sui giorni storici; aprono i tab Traccia/Scan esistenti e avviano focus input, mode cerca, camera o microfono. I flussi di log PWA inviano `target_date` (giorno Diario); su `/log_meal` la **data detta a voce** ha precedenza. Con calorie + macro formano il **fold** della prima viewport; «Pasti di oggi» inizia sotto lo scroll.
- **Obiettivi a tutta altezza:** ✅ (codice) con pannello Obiettivi aperto la card calorie cresce **verso il basso** nello spazio del fold (macro/azioni nascoste); bordo alto fermo sotto le tab; contenuto data/kcal ancorato in alto (`justifyContent: flex-start` fisso, niente salto). Fold con `minHeight: calc(var(--app-height) - 150px)` (`--app-height` da `visualViewport`, non `100dvh`) e `paddingBottom: max(40px, env(safe-area-inset-bottom))`. Da verificare su telefono **installato** anche dopo refresh.
- **Card trend multi-range:** ✅ (CF live) pulsanti Anno / Mese / Settimana; `/dashboard` espone anche `storico_mensile` (5 settimane, media giornaliera) e `storico_annuale` (12 mesi, media sui giorni loggati); label kcal (`LabelList`) sopra ogni barra; **alto dx segue il range:** sett `Σ` vs `target×7`; mese `Σ(avg×7)` vs `target×(n×7)`; anno `Σ(avg×giorniMese)` vs `target×Σgiorni` (mese corrente fino a oggi). **Da deployare Vercel.**
- **Fix focus camera:** ✅ (codice) `openScanCameraStream()` + `applyScanTrackConstraints()`: `deviceId` preferito in localStorage (`vt-scan-camera-id`), switch post-permesso via `enumerateDevices` evitando ultra-wide/front; `applyConstraints({advanced:[{zoom:~2, focusMode/exposure/whiteBalance continuous}]})` con fallback zoom di primo livello; zoom digitale di rinforzo `SCAN_DIGITAL_ZOOM=1.35`. Da verificare su telefono.
- **Catalogo / CERCA:** ✅ (CF live) tab Sheets `Catalogo`; `/catalog`, `/search`, `/log_catalog`; **overlay CERCA** dal bottone azioni rapide (non mode in Traccia); CTA «Aggiungi al catalogo» su Scan not_found; **stellina Diario/CERCA = toggle preferiti** (`star`/`unstar`, stella piena se preferito, toast «Aggiunto/Rimosso dai preferiti»); se non in catalogo la stellina Diario apre ancora overlay salva; **cestino in CERCA** → `action=delete`; upsert match anche per nome (anti-duplicati). **Da deployare Vercel** + test.
- **Fallback "prodotto non trovato":** ✅ (codice) form valori per 100 g → `POST /catalog` (oltre al percorso a voce).

### 7.3 Sessione 3 — Trigger "scansiona prodotto"
- Nuovo profilo AutoVoice Recognized (`scansiona prodotto`, stessa config "hard way") → Tasker Browse URL → `https://voicetrack-chi.vercel.app/?action=scan`.
- PWA: `?action=scan` apre tab barcode con camera; **`?action=ean`** (alias `ean_voce` / `barcode_voce`) apre Scan e avvia dettatura EAN **senza** camera (codice ✅; da collegare in Tasker + backup).
- Bonus: shortcuts nel manifest (pressione lunga icona → **Traccia / Scansiona / Cerca / Testo**) ✅ (codice; deep link già in PWA; **dopo deploy reinstallare** PWA). Eventuale `?action=cerca` supportato. **Share Target** OFF → `/share-off` ✅ (codice; dopo deploy **reinstallare** PWA e verificare lista Condividi).
- Post-sessione: backup Tasker.

### 7.4 Continuo — Prodotti Conad
Auto-contribuzione a Open Food Facts durante la spesa (~20-30 prodotti ricorrenti, ~1 min/prodotto con l'app OFF). Una volta inseriti, `/scan_barcode` li trova per sempre; il catalogo personale li cache-izza al primo scan ok.

### 7.5 Bug da chiudere
- Parsing bevande in ml: verificare coi log che il fix nel system prompt funzioni; rilanciare le frasi di test.

## 8. Desideri futuri e opzioni parcheggiate (non attive, ma da non perdere)

- ⭐ **Gemini come orchestratore dell'intera pipeline.** Oggi Gemini apre la PWA per nome ("apri VoiceTrack") ma non passa parametri né chiama endpoint HTTP. Gerarchia attuale: Tasker per i trigger profondi (deep link + schermo bloccato), PWA client universale, Gemini lanciatore generico. **Rivalutare a ogni annuncio Google su estensioni/azioni Gemini** — è anche la risposta naturale alla fine del passthrough Assistant. Desiderio importante di lungo periodo: collegare Gemini a tutta la pipeline.
- **Attivazione 100% hands-free** ("Hey Google" è bloccata a livello hardware/sistema). Tre opzioni aperte: Wispr Flow (già installato), routine Google, pulsante Bluetooth fisico. Ognuna introduce una dipendenza nuova da mantenere.
- **Multi-utente light:** solo quando un familiare lo chiede davvero. Versione minima: mappatura `chiave → tab dati + target` nel tab Config; ogni utente = un tab. Supabase se gli utenti superano la manciata.
- **Supporto iOS:** Web Speech su Safari inaffidabile → fallback `MediaRecorder` + trascrizione server-side (Whisper/Google STT), solo se compare un iPhone in famiglia.
- **Wrap nativo (TWA/Capacitor):** stessa PWA in APK per widget/Play Store; solo in scenario oltre-famiglia.
- **Nutritionix** come layer di verifica dei dati LLM / fallback barcode.
- **Migrazione a Supabase** se Sheets diventa stretto (limiti: 10M celle, quota API col polling ogni 20 s della dashboard).
- Minori dalla roadmap originale: **"il solito" multi-alimento** (`PastiTipo` — i singoli prodotti frequenti sono già nel Catalogo), **alias vocali in `/log_meal`** (risoluzione catalogo prima del LLM), tracking acqua, integrazione bilancia/smartwatch, gestione offline in Tasker, switch facile Claude ↔ altro LLM (già astratto in `llm_client.py`).

## 9. Frasi di test standard

Da rilanciare a ogni modifica di modello, system prompt o schema:
- "500 grammi di tacchino alla griglia, insalata mista e un cucchiaio d'olio" → log corretto, totali plausibili; A e K coincidenti; nessun prefisso giorno nel TTS.
- "500 ml di birra" → log in grammi≈ml, **senza commenti** che rompano il JSON.
- "Un piatto di pasta" → `needs_clarification` + loop di chiarimento funzionante (Tasker e PWA).
- "ieri 200 grammi di yogurt" → K = ieri (12:00), A = adesso; TTS inizia con «Ieri hai mangiato…».
- "domani 200 grammi di yogurt" → K = domani (12:00); TTS «Domani hai mangiato…»; scheda Domani con sfondo slate.
- "l'altro ieri …" / "sabato scorso …" → etichetta corretta (+ numero del giorno se weekday).
- Diario su giorno X + frase con «ieri …» → vince la voce (non X); PWA salta al giorno dichiarato.
- `GET /daily_summary?date=<ieri>` → TTS **non** dice «Oggi»; dice «Ieri hai mangiato…».
- `GET /daily_summary?date=<domani>` → «Domani hai mangiato…».
- Swipe Diario oltre oggi → scheda futura navigabile, sfondo distinto.
- Barcode di un prodotto italiano comune → riga con `fonte = pwa-barcode` (+ entry in Catalogo).
- EAN inesistente → messaggio chiaro, **nessuna riga scritta**; CTA aggiungi al catalogo.
- CERCA (query vuota) → frequenti/preferiti; tap → grammi → riga con `fonte = pwa-catalogo`.

## 10. Trigger di revisione

- Update Android / AutoVoice / Tasker → checklist Android (§6, primo punto).
- Redeploy → curl a `/health` + verifica `%VTURL`/`%VTKEY`.
- Email di deprecazione (Google Cloud runtime, Anthropic model) → aggiornare + frasi di test.
- Modifica schema Sheets → tutti i consumatori insieme.
- Ogni 6–12 mesi → rotazione chiavi (3 posti + service account).
- Annuncio Google su Assistant/Gemini → rivedere passthrough e §8 (Gemini orchestratore).
