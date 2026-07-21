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
  Tab Barcode (BarcodeDetector + getUserMedia)
  Dashboard + Config

BACKEND — Google Cloud Function `voicetrack` (gen2, europe-west1, python312)
  /log_meal        → Claude API → JSON → Sheets → riepilogo_vocale
  /scan_barcode    → Open Food Facts v2 → Sheets (gestisce "prodotto non trovato")
  /daily_summary   → legge Sheets, totali giornata
  /dashboard, /config → PWA (tab Config = fonte unica dei target)
  /health          → check senza chiave, usato come warm-up anti cold-start

DATABASE — Google Sheets (tab dati `diethropic` + tab `Config`)
  timestamp | pasto | alimento | grammi | kcal | proteine | carboidrati
  | grassi | fonte (tasker-voce / pwa-voce / pwa-barcode) | note
```

Percorsi **morti** (non riproporre): "Hey Google → Google Assistant → AutoVoice" (hotword bloccata a livello di sistema, Assistant sostituito da Gemini); barcode via AutoBarcode/Tasker (superato dal barcode in PWA — la scansione richiede comunque lo schermo).

## 3. Censimento configurazioni critiche

Se si perdono, la pipeline muore in silenzio.

- **AutoVoice:** Default Recognize Settings → Language Code `it-IT`; profili Recognized con Command Filter `traccia pasto` e `scansiona prodotto` (Exact Command disattivato); AutoVoice = assistente predefinito; task passthrough verso Assistant per i comandi non riconosciuti (Spotify ecc.).
- **Tasker:** variabili `%VTURL` e `%VTKEY`; guard clause su `%http_data`. Backup Tasker da esportare dopo ogni modifica lato Android.
- **Google Cloud:** progetto `diethropic`, regione `europe-west1`, function `voicetrack` gen2, runtime `python312`, 256 MB, timeout 60 s, entry-point `voicetrack`, `--allow-unauthenticated`; `.env.yaml` con `VOICETRACK_API_KEY`, `SHEET_NAME=diethropic`, chiave Anthropic, ID foglio. **I flag di deploy devono restare identici a ogni redeploy.**
- **URL equivalenti:** `https://europe-west1-diethropic.cloudfunctions.net/voicetrack` e `https://voicetrack-ki3pu27iiq-ew.a.run.app`.
- **Sheets:** foglio condiviso col service account; tab `diethropic` + tab `Config` (auto-creato).
- **PWA:** `https://voicetrack-chi.vercel.app/`; URL backend + chiave in localStorage. CORS ristretto al dominio Vercel.
- **Sicurezza:** la chiave API vive in **tre posti** (env Cloud Function, `%VTKEY` Tasker, localStorage PWA) — ruotarla = aggiornarli tutti e tre. Rotazione consigliata ogni 6–12 mesi (anche chiave JSON del service account).
- **Sorgenti locali:** cartella `diethropic/files` (Dropbox/Desktop) con `main.py`, `sheets_client.py`, `llm_client.py`, `requirements.txt`, `.env.yaml`.

## 4. Stato componenti

| Componente | Stato |
|---|---|
| Trigger Tasker "traccia pasto" (Home → AutoVoice, it-IT) | ✅ |
| Cloud Function + tutti gli endpoint (`/log_meal`, `/daily_summary`, `/dashboard`, `/config`, `/health`, `/scan_barcode`) | ✅ |
| PWA completa: dashboard, Config, voce (Deploy 3), barcode (Deploy 4), warm-up `/health`, cache anti cold-start, carosello swipe animato tra tab Diario/Traccia/Scan | ✅ |
| Card trend Diario con viste Anno / Mese / Settimana (`storico_annuale` / `storico_mensile` / `storico_settimanale`) | ✅ (codice; da deployare backend + Vercel) |
| Campo `fonte` esteso (`tasker-voce` / `pwa-voce` / `pwa-barcode`) | ✅ |
| Parsing bevande in ml ("500 ml di birra") | 🔧 Fix proposto nel system prompt, **da verificare coi log** |
| Focus camera barcode (parte sulla lente 0.5x) | 🔧 Bug aperto — fix pianificato (Sessione 2, §7) |
| Colonna `id` + `/update_meal` + `/delete_meal` | ✅ (codice; da deployare sul Cloud Function) |
| Edit/delete pasti nella PWA (tap→modifica, pulsante+swipe→elimina; pannello edit con animazione collapse altezza/opacità) | ✅ (codice; da deployare backend + test su telefono) |
| Config con % macro nella PWA | ✅ (codice; editor Obiettivi con slider di ripartizione **indipendenti**, grammi derivati da kcal, totale segnalato in rosso se ≠100% e salvataggio bloccato finché non è 100%; card Macronutrienti senza % accanto ai macro) |
| Card azioni rapide sul Diario (testo / scan / voce → tab Traccia o Scan) | ✅ (codice; solo giorno corrente) |
| Trigger "scansiona prodotto" → deep link PWA + shortcuts manifest | ⬜ Sessione 3 (§7) |
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
- **Schema Sheets = moltiplicatore:** i consumatori sono ≥5 (`/log_meal`, `/scan_barcode`, `/daily_summary`, `/dashboard`, `/config`). **Ogni colonna aggiunta si aggiorna in tutti insieme, nella stessa sessione.** Nessuna validazione numerica: una riga malformata inquina i totali in silenzio. `pasto` derivato dall'orario è un'euristica fragile.
- **Open Food Facts:** comunitaria, senza SLA, ha già cambiato versione (v0→v2). Mantenere la gestione "prodotto non trovato"; Nutritionix resta il fallback anticipabile.
- **PWA/Vercel:** dipendenze npm da aggiornare (React, Vite, vite-plugin-pwa, eventuale `@zxing/browser`), service worker in `autoUpdate` (un deploy rotto si propaga da solo), icone placeholder da rifare, termini free tier Vercel.
- **Costi:** ~1-2 €/mese (Claude API); tutto il resto free tier. Riverificare periodicamente.

## 7. Lavori aperti (piano "Deploy 5" — Rifiniture)

Metodo per il frontend: repo locale + `npm run dev` + anteprima live sul telefono; AI che modifica i file direttamente; deploy Vercel a fine rifinitura. Test su telefono reale, mai in artifact.

### 7.1 Sessione 1 — Backend: identità di riga
- Colonna `id` (UUID generato da `/log_meal` e `/scan_barcode`); righe storiche senza `id` tollerate in lettura.
- Nuovi endpoint `/update_meal` e `/delete_meal` (POST, stessa chiave, stesso CORS ristretto).
- Aggiornare **insieme** tutti i consumatori dello schema (regola §6).
- Accettazione: UUID in ogni riga nuova; update/delete via curl funzionanti; `/daily_summary` e `/dashboard` ok con righe vecchie e nuove; Tasker invariato.

### 7.2 Sessione 2 — Frontend PWA
- **Edit/delete pasti:** tap → pannello modifica → `/update_meal`; swipe → conferma → `/delete_meal`; refresh dashboard + invalidazione cache `vt-cache`.
- **Config collegata:** ✅ (codice) editor Obiettivi con **slider di ripartizione indipendenti** per ogni macro (`macroPct`): trascinandone uno gli altri due NON cambiano, quindi il totale può differire da 100. La riga «Ripartizione» mostra il totale reale e diventa **rossa se ≠ 100%**, standard a 100%; `saveTargets` **blocca il salvataggio** se la somma ≠ 100% con messaggio dedicato nel pannello. I **grammi salvati sono derivati** da split + kcal (P/C ÷4, G ÷9) e riempiono esattamente le calorie quando la somma è 100; all'apertura le % sono normalizzate a 100 dai grammi salvati. Cambiando le kcal i grammi si ricalcolano live. Rimosse le % dei macro accanto a ogni voce nella card Macronutrienti del Diario. Superato il precedente modello a somma fissa 100 con ridistribuzione proporzionale. Da verificare su telefono + deploy Vercel.
- **Card azioni rapide sul Diario:** ✅ (codice) tra Macronutrienti e Pasti di oggi, tre bottoni rotondi (TESTO / SCAN / VOCE) visibili solo oggi; aprono i tab Traccia/Scan esistenti e avviano focus input, camera o microfono.
- **Card trend multi-range:** ✅ (codice) pulsanti Anno / Mese / Settimana; `/dashboard` espone anche `storico_mensile` (5 settimane, media giornaliera) e `storico_annuale` (12 mesi, media sui giorni loggati). Da deployare CF + Vercel.
- **Fix focus camera:** `track.getCapabilities().zoom` → `applyConstraints({advanced:[{zoom:2}]})`; fallback `enumerateDevices()` con deviceId salvato in localStorage; `focusMode: 'continuous'` se disponibile.
- **Fallback "prodotto non trovato" (opzionale):** dettatura vocale nome + valori per 100 g → `/log_meal`; opzionale popolare tab "Alimenti Frequenti".

### 7.3 Sessione 3 — Trigger "scansiona prodotto"
- Nuovo profilo AutoVoice Recognized (`scansiona prodotto`, stessa config "hard way") → Tasker Browse URL → `https://voicetrack-chi.vercel.app/?action=scan`.
- PWA: leggere il query param `action` e aprire il tab barcode con camera attiva.
- Bonus: shortcuts nel manifest (pressione lunga icona → "Traccia" / "Scansiona").
- Post-sessione: backup Tasker.

### 7.4 Continuo — Prodotti Conad
Auto-contribuzione a Open Food Facts durante la spesa (~20-30 prodotti ricorrenti, ~1 min/prodotto con l'app OFF). Una volta inseriti, `/scan_barcode` li trova per sempre.

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
- Minori dalla roadmap originale: "il solito" (pasti ricorrenti con shortcut vocali), tracking acqua, integrazione bilancia/smartwatch, gestione offline in Tasker, switch facile Claude ↔ altro LLM (già astratto in `llm_client.py`).

## 9. Frasi di test standard

Da rilanciare a ogni modifica di modello, system prompt o schema:
- "500 grammi di tacchino alla griglia, insalata mista e un cucchiaio d'olio" → log corretto, totali plausibili.
- "500 ml di birra" → log in grammi≈ml, **senza commenti** che rompano il JSON.
- "Un piatto di pasta" → `needs_clarification` + loop di chiarimento funzionante (Tasker e PWA).
- Barcode di un prodotto italiano comune → riga con `fonte = pwa-barcode`.
- EAN inesistente → messaggio chiaro, **nessuna riga scritta**.

## 10. Trigger di revisione

- Update Android / AutoVoice / Tasker → checklist Android (§6, primo punto).
- Redeploy → curl a `/health` + verifica `%VTURL`/`%VTKEY`.
- Email di deprecazione (Google Cloud runtime, Anthropic model) → aggiornare + frasi di test.
- Modifica schema Sheets → tutti i consumatori insieme.
- Ogni 6–12 mesi → rotazione chiavi (3 posti + service account).
- Annuncio Google su Assistant/Gemini → rivedere passthrough e §8 (Gemini orchestratore).
