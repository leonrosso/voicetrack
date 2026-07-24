# VoiceTrack — Diario delle Sessioni (append-only)

*Regola: questo file si aggiorna SOLO aggiungendo una nuova voce IN CIMA, sotto questa intestazione. Non si modificano né si cancellano le voci esistenti. A fine sessione, l'AI (Claude Code, Cursor o altro) aggiunge qui la voce e poi riporta le modifiche di stato nelle sezioni pertinenti di `stato-progetto.md` (§4 stato componenti, §3 censimento se sono nate nuove superfici, §7 lavori aperti).*

*Formato voce:*

```
## AAAA-MM-GG — Titolo sessione (strumento usato)
**Fatto:** …
**Nuove superfici/config:** … (o "nessuna")
**Bug aperti/chiusi:** …
**Prossimo passo:** …
```

---

## 2026-07-24 — Target dal Diario (ambiti) + pager settimane Statistiche (Cursor)
**Fatto:** (1) `apply_target_span` su TargetHistory: mode `from` / `day` / `range` con riscrittura foglio; POST `/config` body `mode+start[+end]` (compat `effective`/`valid_from`). (2) Obiettivi PWA: chip Solo questo giorno / Da questo giorno in poi / Intervallo… (calendario range); bozza da `dayTarget`; ancora = giorno Diario. (3) `/dashboard?week_offset=N` + frecce settimane in vista Settimana.
**Nuove superfici/config:** POST `/config` ambiti; query `week_offset`; calendario `selectMode=range`.
**Bug aperti/chiusi:** chiuso (codice) salvataggio obiettivi ignorava il giorno Diario; CF+Vercel da deployare.
**Prossimo passo:** deploy CF + Vercel; test ambiti su giorno passato + scorrimento settimane.

---

## 2026-07-24 — Tipo pasto dichiarato a voce (Cursor)
**Fatto:** colonna Sheets `tipo_pasto` (L) + schema pasti A–L; LLM estrae `tipo_pasto` (colazione|pranzo|spuntino|cena) solo se detto esplicitamente, altrimenti null; precedenza voce → body client (`tipo_pasto`/`meal_type`) → vuoto; in lettura L valorizzato vince, senò fallback `pasto_from_hour`; `/log_meal`/`/scan_barcode`/`/log_catalog` scrivono L; `/update_meal` accetta `tipo_pasto`. Tasker/PWA UI invariati (i gruppi Diario usano già `pasto`).
**Nuove superfici/config:** header `tipo_pasto` in L1 sul foglio; range `A:L`; `APP_VERSION` `deploy5-tipo-pasto-2026-07-24`.
**Bug aperti/chiusi:** chiuso (codice) «ieri a cena» finiva in pranzo per mezzogiorno; CF da redeployare + header L1.
**Prossimo passo:** header L1; deploy CF; test «ieri a cena …» → gruppo Cena; frase senza tipo → euristica ora.

---

## 2026-07-23 — Storia target + dual-view Statistiche (Cursor)
**Fatto:** tab Sheets `TargetHistory` (append-only, `valid_from` + kcal/P/C/G); helper `target_for(D)` = ultima fascia con `valid_from ≤ D`; `/config` GET/POST con `target_history` e `effective` today|tomorrow; `/daily_summary`, `/dashboard` (`target_kcal` per barra + history), `/day_meals` (target per giorno). PWA: Diario passato/futuro usa target del giorno; Statistiche toggle ATTUALE/STORICO (`vt-stats-mode`); Obiettivi chip Da oggi/Da domani + invalidazione cache.
**Nuove superfici/config:** tab `TargetHistory`; localStorage `vt-stats-mode`; POST `/config` body `effective`.
**Bug aperti/chiusi:** chiuso (codice) mismatch Diario storico vs target corrente; CF e Vercel da deployare.
**Prossimo passo:** deploy CF + Vercel; test cambio obiettivo a metà settimana (vista attuale vs storica) e «Da domani».

---

## 2026-07-23 — Confronto kcal per range (sett/mese/anno) (Cursor)
**Fatto:** card Statistiche — confronto alto dx segue il toggle: **Settimana** `Σ kcal` vs `target×7`; **Mese** `Σ(avg×7)` vs `target×(n×7)` (5 settimane rolling); **Anno** `Σ(avg×giorniMese)` vs `target×Σgiorni` (mese corrente fino a oggi); caption `sett./mese/anno`; `…` se serie attiva vuota.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy Vercel.

---

## 2026-07-23 — Confronto kcal settimanali in Statistiche (Cursor)
**Fatto:** card Statistiche Diario — in alto a destra `consumate / obiettivo` settimanale (`sum(storico_settimanale.kcal)` vs `target.kcal × 7`), IBM Plex Mono + hint Restano/Superato (`C.good`/`C.alert`); fisso anche con grafico su Mese/Anno; `…` se serie settimana assente.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy Vercel.

---

## 2026-07-23 — Label kcal sopra barre trend (Cursor)
**Fatto:** card Statistiche Diario — `LabelList` su `BarChart` con `kcal` arrotondate sopra ogni barra (IBM Plex Mono 9px, `C.inkMuted`); `margin.top` 16 + altezza chart 124px per evitare clip. Vale per Settimana / Mese / Anno.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy Vercel.

---

## 2026-07-23 — Calendario accanto alla data (Cursor)
**Fatto:** icona calendario nella scheda calorie spostata subito a sinistra del testo data (gap 6px, cluster centrato); allineato anche in DayPeek. Non più a metà tra freccia e data.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy Vercel.

---

## 2026-07-23 — Animazione enter/exit calendario (Cursor)
**Fatto:** `DayJumpCalendar` — fade scrim + scale/translate pannello (~240ms, ease-out in / ease-in out); chiusura (tap fuori, Escape, X, scelta data) anima l’exit e solo poi chiama `onClose` (parent resta `diaryCalOpen`/`scanCalOpen` true → swipe bloccato). Call site Diario/Scan: `onSelect` non setta più open=false.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono — apri/chiudi calendario Diario e Scan con easing.

---

## 2026-07-23 — Calendario overlay (Cursor)
**Fatto:** `DayJumpCalendar` non più inline (tagliato da overflow/transform del carosello): overlay fixed a root (Diario + Scan), tap sullo sfondo / Escape / X chiude; pannello centrato a schermo intero.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) calendario Diario tagliato/illeggibile all’apertura.
**Prossimo passo:** verifica telefono — apri calendario dalla scheda calorie, tap fuori chiude.

---

## 2026-07-23 — Calendario a metà tra freccia e data (Cursor)
**Fatto:** icona calendario nella scheda calorie riposizionata a metà tra freccia indietro e inizio testo data (layout sandwich flex su centro + DayPeek).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy Vercel.

---

## 2026-07-23 — Shortcuts pressione lunga icona (Cursor)
**Fatto:** manifest PWA `shortcuts` allineati alle azioni rapide (§7.3 + Diario): **Traccia** (`?action=voice`), **Scansiona** (`?action=scan`), **Cerca** (`?action=cerca`), **Testo** (`?action=text`); description + icone path assoluto `/pwa-192x192.png`. Deep link già gestiti da `consumeUrlAction` / `launchQuickAction`.
**Nuove superfici/config:** 4 shortcuts WebAPK (pressione lunga icona).
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** deploy Vercel → **disinstalla/reinstalla** PWA → pressione lunga icona → 4 azioni.

---

## 2026-07-23 — Calendario visibile subito al refresh (Cursor)
**Fatto:** icona calendario in colonna griglia fissa (`32px 26px 1fr 32px`) a sinistra della data, fuori dal flex centrato con ellipsis — così non viene clipata da `overflow:hidden` al primo layout/refresh. Stesso layout decorativo su `DayPeek`.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) icona calendario assente al refresh poi compare.
**Prossimo passo:** verifica telefono — refresh Diario, icona subito visibile.

---

## 2026-07-23 — Calendario a sinistra della data (Cursor)
**Fatto:** icona calendario sul Diario spostata a sinistra del titolo giorno (prima era a destra).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica telefono / deploy se non già in coda.

---

## 2026-07-23 — Fix Share Target path + scope (Cursor)
**Fatto:** `share_target.action` da `/?action=off` a **`/share-off`** (senza query: Chrome/Android spesso non registrava il target). Manifest `scope: '/'` esplicito (prima `./` da base relativa). `consumeUrlAction` riconosce path `/share-off` + legacy `?action=off`. Aggiunto `frontend/vercel.json` rewrite SPA così `/share-off` non fa 404.
**Nuove superfici/config:** path `/share-off`; `vercel.json` rewrites.
**Bug aperti/chiusi:** Share Target assente dalla lista Condividi (probabile causa action con `?` / scope relativo) — fix codice; serve **disinstallare e reinstallare** la PWA dopo deploy.
**Prossimo passo:** deploy Vercel → disinstalla VoiceTrack → cancella dati sito → reinstalla → OFF Condividi → VoiceTrack.

---

## 2026-07-23 — Link OFF in Scan + Share Target (Cursor)
**Fatto:** (1) sotto la card Inquadra, campo «LINK OPEN FOOD FACTS» per incollare URL scheda OFF (o EAN nudo) → `parseOffBarcode` → stesso flusso `sendBarcode` / `/scan_barcode`. (2) manifest PWA `share_target` GET `/?action=off` (params title/text/url); deep link apre Scan e cerca il prodotto. L’ordine nel foglio Condividi Android non è forzabile: usare VoiceTrack qualche volta lo promuove. Richiede PWA installata + deploy Vercel / aggiornamento SW.
**Nuove superfici/config:** `parseOffBarcode`; stato `offLink`; `?action=off` + share_target in `vite.config.js`.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera).
**Prossimo passo:** deploy Vercel; su telefono (PWA installata) — paste link OFF → quantità; da OFF Condividi → VoiceTrack.

---

## 2026-07-23 — Swipe chiusura pannello edit (Cursor)
**Fatto:** a pannello modifica aperto, sulla riga pasto lo stesso swipe sx→dx (barra verde + peek→bounce ~340ms) richiude il pannello (`runEditRevealThenClose`); tap sulla riga resta chiusura immediata; swipe opposto bloccato mentre si edita.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera).
**Prossimo passo:** verifica telefono — swipe apre e richiude con stessa animazione; tap/Annulla ok.

---

## 2026-07-23 — Deep link EAN a voce (Cursor)
**Fatto:** deep link PWA `?action=ean` (alias `ean_voce`, `barcode_voce`) → tab Scan **senza** camera + avvio `listenManualEan` (`kickManualEan`). `?action=scan` resta fotocamera. Tasker Browse URL: `https://voicetrack-chi.vercel.app/?action=ean`.
**Nuove superfici/config:** query `action=ean` (+ alias); `kickManualEan` / `scanStateRef`.
**Bug aperti/chiusi:** invariati. Nota: Chrome può richiedere un tap sul mic se Browse URL non conta come user gesture.
**Prossimo passo:** Tasker profilo/comando → Browse URL; backup Tasker; test telefono + deploy Vercel.

---

## 2026-07-23 — Pannello edit sopra la tastiera (Cursor)
**Fatto:** digitazione nel pannello modifica pasto: (1) lock `--app-height` mentre `editingId` (`lockAppHeightRef` + `data-vt-lock-app-height` anche nello script `index.html`, così il fold non si schiaccia con la tastiera); (2) `ensureEditFieldVisible` / `scheduleEnsureEditFieldVisible` su focus dei campi (`data-vt-edit-panel` + `visualViewport`); (3) spacer sotto la lista pasti = inset tastiera. Niente autofocus all’apertura; Obiettivi/CERCA/Traccia invariati.
**Nuove superfici/config:** attr `data-vt-lock-app-height`, `data-vt-edit-panel`; stato `keyboardInset`.
**Bug aperti/chiusi:** chiuso (codice) campi edit sotto tastiera / fold che collassa. Invariati ml parsing; focus camera.
**Prossimo passo:** verifica telefono — focus Grammi/Grassi con tastiera; Salva raggiungibile; chiudi edit → fold normale.

---

## 2026-07-23 — Edit pasti + calendari Diario/Scan (Cursor)
**Fatto:** (1) pannello edit: cambiando i **grammi** riscala kcal/P/C/G dalla baseline di `openEdit` (`new = base * newG/baseG`, 1 decimale; vuoto/0/invalid → non tocca i macro). (2) swipe modifica: barra **verde** + coreografia peek→bounce→apre pannello (~340ms), **senza** conferma matita/X; delete rosso invariato. (3) step «Quanti grammi?» Scan (camera/EAN): chip **Ieri/Oggi/Domani** + calendario; data via `target_date` / `activeLogDateRef` (default giorno Diario). (4) card calorie: icona calendario accanto al titolo giorno → `DayJumpCalendar` con toggle **Settimana/Mese**, tap giorno → `goToDate`.
**Nuove superfici/config:** componente `DayJumpCalendar`; stato `editBaseline`, `scanLogDate`, `diaryCalOpen`/`diaryCalMode`.
**Bug aperti/chiusi:** chiuso (codice) conferma intermedia swipe-edit; invariati ml parsing; focus camera.
**Prossimo passo:** verifica telefono (`npm run dev`) — swipe edit fluido; grammi proporzionali; scan backdate; salto calendario Diario.

---

## 2026-07-23 — Swipe giorno a tutta larghezza (Cursor)
**Fatto:** swipe orizzontale sul Diario cambia giorno su tutto il `dayPager` (calorie + azioni + macro + pasti), non solo sulla card calorie. Cambio tab Diario/Traccia/Scan **solo** dai bottoni in cima (rimosso swipe tab). Guard: `data-no-day-swipe` + `stopPropagation` sulle righe pasto; blocco con Obiettivi / edit / conferma aperti. Trend resta fuori dal carosello giorno.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera).
**Prossimo passo:** verifica su telefono — swipe fold/pasti = giorno; swipe riga = edit/delete; bottoni tab ok.

---

## 2026-07-23 — Righe pasto colore scheda giorno (Cursor)
**Fatto:** `MealRow` riceve `surface`/`line` da `daySurface`/`dayLine` (passato caldo / oggi verde / futuro slate). Sfondo riga opaco (non transparent) così lo swipe continua a coprire i pulsanti modifica/elimina. Bordi riga e pannello edit allineati al `line` del giorno.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) righe pasti sempre `C.surface` su schede passate/future. Invariati ml parsing; focus camera.
**Prossimo passo:** verifica su telefono / Vercel — ieri/domani senza “tessere” grigio-verdi sulle righe.

## 2026-07-23 — Fold Diario height+grid anti-shrink (Cursor)
**Fatto:** fold Diario (centro + DayPeek) da `minHeight`+flex a **`height` fissa** + **CSS grid** `1fr / 2fr` (gap 22px). Obiettivi collassa la 2ª riga a `0fr` (transition solo con `targetsMounted`). Elimina il reflow che faceva nascere la scheda calorie grande e restringersi.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) shrink calorie post-transition-fix. Invariati ml parsing; focus camera.
**Prossimo passo:** verifica telefono — open/swipe senza restringimento; Obiettivi ancora fluido.

## 2026-07-23 — Anti-shrink scheda calorie al mount (Cursor)
**Fatto:** sul fold Diario, `transition` di flex-grow/altezza/opacity (azioni+macro, slot data, gauge, readout) attive **solo** con `targetsMounted` (ciclo Obiettivi). A cold start / refresh niente animazione `flex-grow 0→2` che faceva nascere la scheda calorie grande e restringersi in ~0.28s. Apertura/chiusura Obiettivi invariata.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) shrink calorie all’apertura. Invariati ml parsing; focus camera.
**Prossimo passo:** verifica telefono — open app / swipe giorno senza restringimento calorie; Obiettivi ancora fluido.

## 2026-07-23 — DayPeek allineato al fold (Cursor)
**Fatto:** `DayPeek` (slot adiacenti del carosello giorno) replica lo above-the-fold del centro: minHeight fold, frecce+Obiettivi decorativi, card azioni TESTO/CERCA/SCAN/VOCE, Macronutrienti con `MacroRow`; `pointer-events: none`. Elimina il flash calorie→macro vs calorie→azioni a fine swipe. Logica swipe/Obiettivi/MealRow/backend invariata.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) flash layout allo swipe giorno. Invariati ml parsing; focus camera.
**Prossimo passo:** verifica su telefono (`npm run dev`) — swipe ieri/domani senza salto di layout.

## 2026-07-23 — Cache Config + /day_meals batch (Cursor)
**Fatto:** cache TTL 20s + single-flight su `get_config_targets` (invalidate su `set_config_targets`); nuovo `GET /day_meals?dates=` (1–7 date, una lettura pasti, solo `dettaglio`); PWA Diario fa una fetch batch al posto di N `/daily_summary`. Tasker e forma `/daily_summary` invariati. Deploy CF → `voicetrack-00029-bob`, ACTIVE; `/health` `deploy5-day-meals-2026-07-23`.
**Nuove superfici/config:** endpoint `/day_meals`; docs DEPLOY.md.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera).
**Prossimo passo:** deploy Vercel; test telefono swipe (una request Network per i giorni da aggiornare).

## 2026-07-23 — Cache schede giorno (Cursor)
**Fatto:** accelerato caricamento Diario giorni ≠ oggi senza cambiare contratti API. Backend: cache in-memory TTL 20s + single-flight su `get_all_meal_rows` (3× `/daily_summary` paralleli → 1 lettura Sheets); invalidate su append/update/delete. Frontend: SWR su `dayCache` (mostra subito se in cache, loading solo a vuoto), persistenza `vt-day-cache` (max 40 giorni), warm `/health` anche su Diario, peeks futuro da cache. Deploy CF → `voicetrack-00028-dib`, ACTIVE; `/health` `deploy5-day-cache-2026-07-23`; Tasker invariato.
**Nuove superfici/config:** localStorage `vt-day-cache` `{version:1, days:{YYYY-MM-DD:{meals,at}}}`.
**Bug aperti/chiusi:** chiuso (codice) peeks futuro sempre vuoti (`mealsForOffset`/`metaForOffset` ignoravano cache per offset>0). Invariati ml parsing; focus camera.
**Prossimo passo:** deploy Vercel; test telefono swipe ieri/domani (2ª visita istantanea) + log su giorno storico aggiorna cache.

## 2026-07-23 — Sfondo schede passate (Cursor)
**Fatto:** schede Diario dei giorni passati (`dayOffset < 0`) usano `C.surfacePast` / `linePast` (marrone caldo), distinte da oggi (verde) e futuro (slate). Helper `daySurface`/`dayLine` a tre vie.
**Nuove superfici/config:** `C.surfacePast`, `C.linePast`.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica su telefono / Vercel (oggi verde, ieri caldo, domani slate).

## 2026-07-23 — Diario futuro illimitato + sfondo schede (Cursor)
**Fatto:** Diario swipe senza tetto passato/futuro (`dayOffset` libero); schede future con `C.surfaceFuture` / `lineFuture` (slate); titoli Ieri/Domani; prefetch `daily_summary` anche su offset > 0. Backend: rimossi limiti «no future» e «max 1 anno»; etichette TTS `domani`/`dopodomani`; prompt LLM ammette date future. Tasker invariato. Deploy CF → `voicetrack-00027-nuv`, ACTIVE.
**Nuove superfici/config:** `C.surfaceFuture`, `C.lineFuture`; helper `daySurface`/`diaryDayTitle`.
**Bug aperti/chiusi:** chiuso (codice+live backend) blocco navigazione/log oltre oggi. Invariati ml parsing; focus camera.
**Prossimo passo:** deploy Vercel; test swipe domani (sfondo slate) + «domani 200 g yogurt» TTS su telefono/Tasker.

## 2026-07-23 — Data dichiarata + log vocale giorni passati (Cursor)
**Fatto:** colonna Sheets `data_dichiarata` (K) distinta da `timestamp` (A); `/log_meal` passa «oggi è…» all'LLM e risolve date relative («ieri», «l'altro ieri», «sabato scorso», …); precedenza voce > `target_date` Diario > oggi; validazione no future / max 1 anno; riepilogo TTS con conferma giorno; stesso split A/K su `/scan_barcode` e `/log_catalog`; fix `/daily_summary` che diceva sempre «Oggi» anche con `?date≠oggi`; PWA usa `data_dichiarata` restituita per refresh + salto `dayOffset`. Tasker invariato. Aggiornati `DEPLOY.md`, §3/§4/§9 stato. Deploy CF gen2 → revisione `voicetrack-00026-qaw`, state ACTIVE; `/health` 200 (`deploy5-data-dichiarata-2026-07-23`); `/daily_summary?date=ieri` → «Ieri hai mangiato…».
**Nuove superfici/config:** schema pasti A–K (`data_dichiarata`); risposta API `data_dichiarata` / `etichetta_giorno`; header K1 da aggiungere sul foglio Google.
**Bug aperti/chiusi:** chiuso (codice+live) TTS summary «Oggi» su giorni storici. Invariati ml parsing; focus camera. Nota UX accettata: backdate a 12:00 → fascia «pranzo».
**Prossimo passo:** header K1 sul foglio; test frasi §9 (voce + Diario+ieri + Tasker TTS); deploy Vercel PWA.

## 2026-07-22 — Didascalia mic EAN (Cursor)
**Fatto:** sotto il pulsante microfono della card «inserisci l'EAN» (tab Scan) aggiunto il testo «OPPURE DETTA IL CODICE EAN», stesso stile e gap bottone→testo (`gap-3` + mono 12px) della didascalia «TOCCA E INQUADRA» sulla card fotocamera. Titolo card: «INSERIMENTO MANUALE», centrato (ex «OPPURE INSERISCI L'EAN A MANO»).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica su telefono.

## 2026-07-22 — Commit + push GitHub + deploy CF (Cursor)
**Fatto:** commit `ce69ead` (PWA: camera barcode, swipe edit/delete, EAN a voce, mkcert/HTTPS locale + docs) e push su `origin/main`. Deploy Cloud Function `voicetrack` gen2 → revisione `voicetrack-00025-sic`, state ACTIVE; `/health` 200 (`sheet_ok: true`). Backend era già in git (nessuna diff locale); il redeploy porta in produzione catalogo/search/log_catalog, update/delete meal, trend multi-range, match-nome catalogo, `target_date`.
**Nuove superfici/config:** nessuna nuova; CF live su URL esistenti.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera / EAN / edit-delete da verificare su telefono). Frontend produzione: dipende da deploy Vercel (se collegato a `main`, auto dopo il push).
**Prossimo passo:** conferma PWA su Vercel; test telefono (camera, swipe, EAN mic, edit/delete, CERCA).

## 2026-07-22 — Mic EAN sotto il campo, più grande (Cursor)
**Fatto:** pulsante dettatura EAN spostato sotto la riga input+✓ (non più a dx); bottone circolare 56px centrato, icona 24px.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verifica su telefono.

## 2026-07-22 — Mic dettatura EAN a mano (Cursor)
**Fatto:** nella card «OPPURE INSERISCI L'EAN A MANO» del tab Scan aggiunto pulsante microfono (stesso pattern di grammi scan/CERCA): SpeechRecognition `it-IT` one-shot, estrae solo le cifre e le scrive nel campo. Stato `eanListening` + abort in `resetScan`.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` — dettare EAN cifra per cifra o in blocco, poi conferma ✓.

## 2026-07-22 — Fix focus camera barcode 0.5x (Cursor)
**Fatto:** in `startScan` apertura camera via `openScanCameraStream()`: prova `deviceId` salvato (`vt-scan-camera-id`), altrimenti `facingMode: environment`; dopo il permesso `enumerateDevices` + scelta back non-ultra-wide e persistenza del deviceId. Constraint track: zoom fisico mirato a 2 (clamp su `caps.zoom`) + `focusMode`/`exposureMode`/`whiteBalanceMode` continuous; fallback zoom di primo livello se `advanced` fallisce. Zoom digitale ridotto da 1.8 a 1.35 (rinforzo dopo lo zoom hardware, non sostituto).
**Nuove superfici/config:** localStorage `vt-scan-camera-id`.
**Bug aperti/chiusi:** chiuso (codice) focus camera 0.5x — da verificare su telefono. Invariato ml parsing.
**Prossimo passo:** test su telefono con `npm run dev` — SCAN: verifica lente ~1x/fuoco, secondo avvio riusa deviceId, EAN ancora ok se serve.

## 2026-07-22 — Swipe modifica: barra verde come elimina (Cursor)
**Fatto:** swipe sx→dx non apre più subito il pannello: mostra barra verde (`C.good`) a altezza fissa con wipe da sinistra, nome pasto in easing, icone matita + X. Matita → `openEdit` (pannello sotto come prima); X/tap annulla. Stato `confirmEditId` mutuamente esclusivo con conferma elimina.
**Nuove superfici/config:** `confirmEditId`; CSS `vt-edit-confirm-*`.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono — swipe modifica/elimina, matita apre pannello, X chiude, altezza riga stabile.

## 2026-07-22 — Swipe su altro pasto chiude edit (Cursor)
**Fatto:** `onRowTouchStart` non blocca più lo swipe se un altro pasto è in modifica o in conferma elimina: chiude quello aperto e avvia lo swipe sul pasto toccato (modifica o elimina). Tap sullo stesso pasto aperto continua a chiudere senza swipe.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono — edit aperto + swipe su altro pasto (sx modifica / dx elimina).

## 2026-07-22 — Conferma elimina sulla barra pasto (Cursor)
**Fatto:** in `MealRow` la conferma di eliminazione non è più una tendina sotto la riga: dopo swipe (o Elimina dal pannello edit) la riga stessa diventa barra rossa (`C.alert`) con testo «Eliminare «…»?» e pulsanti Elimina/Annulla inline. Swipe disabilitato in conferma; tap Annulla o tap sulla barra chiude come prima.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x). UX conferma delete aggiornata in codice.
**Prossimo passo:** verifica su telefono con `npm run dev` (swipe elimina → barra rossa; Annulla; Elimina; Elimina da pannello edit).

## 2026-07-22 — Diario: principio layout unificato oggi/storico (Cursor)
**Fatto:** nel contenitore `Azioni + macro` del Diario, `flexGrow` non dipende più dal giorno (`dayOffset`): valore unico (`2`) sia per oggi sia per storico. Mantiene identico il principio di distribuzione verticale tra le due card nei due contesti e rimuove l’effetto “macro più piccola” sui giorni passati.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) disallineamento layout today vs storico dopo apertura card azioni su tutti i giorni. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (oggi/storico: altezza blocco azioni+macro coerente; apertura Obiettivi e swipe giorno/tab invariati).

## 2026-07-22 — Giorno attivo per azioni Diario (Cursor)
**Fatto:** backend e frontend ora supportano `target_date` opzionale (`YYYY-MM-DD`) per `/log_meal`, `/scan_barcode`, `/log_catalog`: se assente resta il comportamento legacy su oggi (compat Tasker), se presente il log va nel giorno selezionato nel Diario. In PWA aggiunto latch della data (`activeLogDateRef`) per tenere coerenti i flussi multi-step (chiarimenti voce e scan con grammi) anche cambiando tab/scheda, e i success path dei log usano refresh contestuale del giorno (oggi via dashboard, storico via `dayCache/historyTick`).
**Nuove superfici/config:** payload API PWA con `target_date`; helper backend `_resolve_target_datetime`; ref frontend `activeLogDateRef`.
**Bug aperti/chiusi:** chiuso (codice) card azioni visibile solo oggi + registrazioni che finivano sempre su oggi quando si operava da un giorno storico. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** test su telefono con `npm run dev` per i casi: giorno storico + TESTO/VOCE/SCAN/CERCA, chiarimento voce, scan 2-step, navigazione tab durante il flusso.

## 2026-07-22 — Fix rimbalzo giorno: flush transition (Cursor)
**Fatto:** in `finishDayCommit`, `flushSync` applica prima `dayDragging=true` (transition none), poi reflow su `dayTrackRef`, poi `dayOffset` + snap `dayDrag→0`. Evita la seconda animazione ±w→0 che WebKit faceva ancora con transition accesa dopo il remap degli slot.
**Nuove superfici/config:** `dayTrackRef`; import `flushSync`.
**Bug aperti/chiusi:** mirato rimbalzo/secondo swipe che restava dopo il solo guard touchcancel. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su telefono con `npm run dev` (swipe giorno lungo).

## 2026-07-22 — Fix rimbalzo swipe giorno (Cursor)
**Fatto:** `onDaySwipeEnd` non azzera più `dayDrag` se c’è un commit in volo (`dayPendingCommitRef`) — evita il rimbalzo da `touchcancel`/secondo end dopo `shiftDay`. `finishDayCommit` salta `setDayDrag(0)` se già a 0. Nessun visual-preserve tipo tab (sulle slot virtuali causerebbe un secondo slide).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) rimbalzo/secondo swipe automatico al cambio giorno. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su telefono con `npm run dev` (swipe lungo/corto, frecce, tab sotto la card).

## 2026-07-22 — Fix larghezza carosello giorno (Cursor)
**Fatto:** contenimento CSS sul carosello giorno annidato nel Diario — `overflowX: clip` + `minWidth: 0` / `maxWidth: 100%` su `dayPagerRef` e sui pannelli tab Diario/Traccia/Scan (stesso pattern anti-overflow del pager tab). Chiude il layout a doppia larghezza senza toccare swipe, Obiettivi, overlay o `--app-height`.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) pagina doppia larghezza dopo carosello giorno. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su desktop + telefono con `npm run dev` (larghezza, swipe giorno vs tab, Obiettivi, CERCA/stellina).

## 2026-07-22 — Carosello giorno tipo tab (Cursor)
**Fatto:** swipe sulla card calorie ora trascina un carosello a 3 slot (ieri|corrente|dopo) con `translateX` + settle come le tab; peeks adiacenti con calorie/macro/pasti; prefetch `/daily_summary` in `dayCache`; frecce usano la stessa animazione. Gesto solo dalla card calorie (`data-no-tab-swipe`); trend resta fisso; tab non si muovono. Direzione: dx → giorno prima, sx → giorno dopo.
**Nuove superfici/config:** componente `DayPeek`; stato `dayCache` / `dayDragX` / `dayDragging`.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su telefono con `npm run dev` (swipe card calorie vs swipe tab sotto); deploy Vercel.

## 2026-07-22 — Swipe giorno: direzione invertita (Cursor)
**Fatto:** invertita la direzione swipe sulla card calorie — dx → giorno prima, sx → giorno dopo (max oggi).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati.
**Prossimo passo:** verificare su telefono con `npm run dev`.

## 2026-07-22 — Swipe giorno sulla card calorie (Cursor)
**Fatto:** sulla card calorie del Diario, swipe orizzontale cambia giorno (dx → giorno prima, sx → giorno dopo fino a oggi); stessi limiti delle frecce (no futuro; indietro solo con API collegata). `data-no-tab-swipe` + `touchAction: pan-y` per non rubare il carosello tab né lo scroll verticale; disabilitato con Obiettivi aperto o su bottoni.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su telefono con `npm run dev`; deploy Vercel.

## 2026-07-22 — Toggle preferiti stellina Diario + CERCA (Cursor)
**Fatto:** stellina piena se `preferito`; tap su alimento già in catalogo → `action star|unstar` + toast basso «Aggiunto/Rimosso dai preferiti»; se assente apre ancora overlay salva. CERCA: ★ toggle + cestino elimina dal catalogo (conferma). Indice `GET /catalog` per match nome/alias. Backend upsert: match anche per nome casefold (anti-duplicati senza barcode).
**Nuove superfici/config:** toast snackbar; `catalogItems` in PWA; trash su riga CERCA catalogo.
**Bug aperti/chiusi:** chiuso (codice) stellina sempre vuota / impossibile togliere preferito / duplicati da ri-salvataggio. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su `npm run dev`; deploy CF (match nome) + Vercel; in CERCA eliminare il duplicato «petto di pollo» di troppo.

## 2026-07-22 — Overlay salva-catalogo da stellina Diario (Cursor)
**Fatto:** tap ★ su riga pasto apre overlay `position:fixed` fuori dal carosello (come CERCA), non più mini-form inline; `focus({ preventScroll: true })`, Esc/tap fuori/X, body overflow locked, swipe tab bloccato; pager con `overflowX: clip` anti scroll-into-view.
**Nuove superfici/config:** overlay `saveCatalogOpen` (stati meal/form invariati).
**Bug aperti/chiusi:** chiuso (codice) layout raddoppiato in orizzontale al tap ★. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su desktop + telefono con `npm run dev`; deploy Vercel.

## 2026-07-21 — Overlay CERCA: swipe-down per chiudere (Cursor)
**Fatto:** sulla barra titolo dell'overlay CERCA, swipe verticale verso il basso (≥100 px) chiude il foglio (oltre a X / Esc / tap fuori); feedback `translateY` + fade backdrop; gesto solo dalla cima, non interferisce con lo scroll della lista.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su telefono con `npm run dev`; deploy Vercel.

## 2026-07-21 — CERCA come overlay (Cursor)
**Fatto:** CERCA non passa più dal carosello Traccia (rompeva il layout desktop via focus/scroll-into-view). Bottone CERCA apre overlay `position:fixed` sopra l'app (maxWidth 420, lista scrollabile, Esc/tap fuori/X per chiudere); `focus({ preventScroll: true })`; body overflow locked; swipe tab bloccato con overlay aperto. Traccia torna solo a voce/testo LLM.
**Nuove superfici/config:** stato `searchOpen` (overlay); rimosso `tracciaMode`.
**Bug aperti/chiusi:** chiuso (codice) layout sfasato su desktop al click CERCA. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare su desktop + telefono; deploy Vercel.

## 2026-07-21 — Catalogo personale, frequenti e ricerca (Cursor)
**Fatto:** tab Sheets `Catalogo` (auto-create) + CRUD in `sheets_client`; endpoint `/catalog` (GET/POST con action star|unstar|delete), `/search` (catalogo poi OFF text search), `/log_catalog`; upsert silenzioso da `/scan_barcode` ok; fonte `pwa-catalogo`. PWA: quarto bottone CERCA nelle azioni rapide; Traccia con toggle LIBERO/CERCA (lista frequenti, query, grammi, log); CTA «Aggiungi al catalogo» su Scan not_found; stella su riga Diario → salva in catalogo (valori /100 g).
**Nuove superfici/config:** tab Sheets `Catalogo` (A–M); endpoint `/catalog`, `/search`, `/log_catalog`; env opzionale `CATALOG_SHEET_NAME`.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x). Feature nuova in codice, da deployare CF + Vercel + test telefono.
**Prossimo passo:** deploy Cloud Function + Vercel; test CERCA frequenti → grammi → riga; scan ok → compare in catalogo; not_found → aggiunta manuale; follow-up: alias vocali in `/log_meal`, “il solito” multi-item, deep link `?action=cerca`.

## 2026-07-21 — PWA: --app-height stabile cold start vs refresh (Cursor)
**Fatto:** su Android standalone `100dvh` al refresh diventa più alto e slarga il fold. Introdotto `--app-height` da `visualViewport.height` (script early in `index.html` + `useEffect` in `App.jsx`); tutti i `minHeight: calc(100dvh - 150px)` → `calc(var(--app-height) - 150px)`; fold `paddingBottom: max(40px, env(safe-area-inset-bottom))`.
**Nuove superfici/config:** CSS var `--app-height`.
**Bug aperti/chiusi:** mirato layout ok all’apertura ma slargato dopo un refresh. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** deploy Vercel; verifica su PWA installata: apri da icona → ok; refresh → deve restare uguale (non slargarsi).

## 2026-07-21 — PWA safe-area: margine sotto Grassi in standalone (Cursor)
**Fatto:** fix viewport PWA standalone — in `frontend/index.html` meta `viewport-fit=cover`; wrapper root con padding `env(safe-area-inset-*)`; fold Diario `paddingBottom: calc(22px + env(safe-area-inset-bottom))` (box-sizing border-box); `#root` a `min-height: 100dvh`. Il `100dvh` c’era già; il bug era l’area gesture Android non sottratta senza safe-area.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso (codice) margine assente sotto card Grassi in PWA installata vs ok in Chrome/`npm run dev`. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verificare **solo** dopo deploy Vercel + reinstall/apertura PWA standalone sul telefono (non basta `npm run dev` in browser).

## 2026-07-21 — Obiettivi: ritorno un solo atto / gate sync (Cursor)
**Fatto:** annullato il solo-allineamento durate (#3) come strategia. Data, gauge e readout usano il gate `targetsOpen || targetsAnimOpen` (non più `targetsMounted`): in chiusura tornano **nello stesso istante** di azioni/macro ed editor che collassa — un solo atto invece del buco ~300ms. Durate reveal 0.28s.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** riprova ritorno naturale via sync coreografico (#2). Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (chiusura: chrome hero + azioni insieme); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: ritorno durate allineate 0.28s (Cursor)
**Fatto:** annullato lo snap altezze (#1). In rivelazione post-chiusura, data/gauge animano di nuovo `maxHeight`/`height` e insieme a readout usano **opacity 0.28s** (stesso ordine di grandezza del collapse grid / flex-grow) così fade e grow finiscono insieme.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** riprova ritorno più naturale via sync durate. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; se ancora innaturale valutare sync gate (#2) o ripristino snap (#1).

## 2026-07-21 — Obiettivi: ritorno snap altezze + fade sync (Cursor)
**Fatto:** in chiusura Obiettivi, data/gauge tornano a dimensione piena senza animare `maxHeight`/`height` (snap); solo `opacity 0.3s ease-out` su data, gauge e readout — evita drift del centro kcal mentre sfuma. Collapse in apertura invariato.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** mitigato ritorno poco naturale post-chiusura. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: nasconde data in apertura (Cursor)
**Fatto:** come il gauge, anche lo slot data della hero collassa/fade con Obiettivi aperto (`maxHeight` 0 + opacity, stesso gate `targetsOpen || targetsMounted`) → più spazio allo slot medio in alto.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** più spazio per Ripartizione (data + gauge nascosti in apertura). Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: nasconde gauge in apertura (Cursor)
**Fatto:** nello slot gauge della hero in `frontend/src/App.jsx`, con Obiettivi aperto/montato collapse `height`/`marginTop` a 0 + fade (stesso gate `targetsOpen || targetsMounted` del readout) → ~22px in più allo slot medio per Ripartizione; in chiusura ripristino con easing.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** mitigato mancanza spazio per riga Ripartizione (prova gauge prima della data). Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (Ripartizione visibile senza scroll se possibile; altrimenti valutare nascosta data / spacing); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: fade readout post-chiusura (Cursor)
**Fatto:** sul readout kcal nello slot medio di `frontend/src/App.jsx`, transition opacità asimmetrica: `0.15s ease` in nascondita (apertura Obiettivi), `0.5s ease-out` in rivelazione dopo smontaggio — riduce il flash del conto al ritorno.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** mitigato flash readout in chiusura Obiettivi. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (chiusura Obiettivi: conto che riappare in fade); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: layout a slot fissi (Cursor)
**Fatto:** in `frontend/src/App.jsx`, hero card ristrutturata in tre slot fissi (data | medio | gauge). Rimossi spacer `flex-grow` e flag `targetsCentered` (causa dello scorrimento kcal in chiusura). Nello slot medio: readout sempre centrato con fade opacità (nascosto mentre `targetsOpen`/`targetsMounted`); editor Obiettivi in `position:absolute; inset:0` con collapse grid esistente. Readout riappare solo dopo smontaggio → niente drift verticale. Anti-flash scrollbar e collasso azioni/macro invariati.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso scorrimento/rimbalzo scritte kcal in chiusura Obiettivi. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (conto centrato a chiuso; apertura full-slot senza drift; chiusura senza scorrimento scritte); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: centraggio conto + no rimbalzo gauge in chiusura (Cursor)
**Fatto:** in `frontend/src/App.jsx`, hero card: (1) rimossa la commutazione `marginTop` gauge `14px`↔`auto` (causa del rimbalzo in chiusura); gauge sempre in fondo con `marginTop: 14px` fisso. (2) Due spacer `flex-grow` sopra/sotto il blocco kcal con flag `targetsCentered`: a scheda chiusa centrano conto+bottone tra data e gauge; in apertura snap a 0 (niente transition, così non competono col pannello); dopo la chiusura tornano con easing 0.28s. Anti-flash scrollbar precedente invariato.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiusi rimbalzo gauge in chiusura e conto troppo alto vicino alla data. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (chiusura senza rimbalzo gauge; conto centrato a chiuso; apertura Obiettivi ancora ok senza scrollbar); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: rollback maxHeight + anti-flash senza scroll forzato (Cursor)
**Fatto:** il 2° fix (`maxHeight` sulla fold + `targetsScrollReady`) costringeva a scorrere dentro Obiettivi. Revert di quei vincoli: la scheda torna a espandersi tutta. Anti-flash ridotto a (1) `overflow: hidden` su `html`/`body` mentre `targetsMounted`, (2) hero `overflowY: hidden`, (3) classe `.vt-targets-scroll` con scrollbar nascosta (scroll touch ancora possibile su schermi corti).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** ripristinato layout a tutta altezza; flash scrollbar mitigato senza forzare scroll interno. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (scheda intera senza scorrere; niente barra a destra in apertura); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: fix scrollbar flash (2° passaggio) (Cursor)
**Fatto:** il primo fix (`overflowY: hidden` sulla hero) non bastava. In `frontend/src/App.jsx`: (1) fold above-the-fold con `maxHeight` + `overflow: hidden` solo mentre Obiettivi è montato → la pagina non cresce durante l’animazione; (2) `targetsScrollReady`: lo scroll interno dell’editor passa a `overflowY: auto` solo a `transitionend` di `grid-template-rows`, altrimenti `hidden` → niente barra a destra mentre il pannello è ancora basso. Hero resta `overflowY: hidden` a montato.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** riprovato chiusura flash scrollbar all’apertura Obiettivi. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (apri/chiudi Obiettivi: nessuna barra durante l’animazione; su schermo corto scroll interno dopo l’apertura); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: no scrollbar flash all’apertura (Cursor)
**Fatto:** sulla card calorie (hero) in `frontend/src/App.jsx`, `overflowY` con Obiettivi montato passa da `auto` a `hidden`. Durante l’animazione di apertura il contenuto non mostra più una barra di scorrimento a destra che poi spariva; lo scroll interno dell’editor (contenuto + footer Salva/Annulla fisso) resta invariato.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso flash scrollbar all’apertura Obiettivi. Invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (apri Obiettivi: niente barra a destra durante l’animazione; su schermo corto lo scroll interno e i bottoni restano ok); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: rimosso testo di aiuto (Cursor)
**Fatto:** nell’editor Obiettivi di `frontend/src/App.jsx` eliminato lo span di descrizione sotto «OBIETTIVI GIORNALIERI» (riscalamento barre / indipendenza slider / totale 100%). Resta il feedback via riga Ripartizione e `targetMsg` al salvataggio.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (contenuto fino a Ripartizione entra meglio nella card); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: slider calorie con ± (Cursor)
**Fatto:** nell’editor Obiettivi di `frontend/src/App.jsx` il campo Calorie non è più un semplice `TargetInput`: nuovo componente `KcalSlider` con input digitabile + barra range e tasti −/+ alle estremità (stesso layout dei macro). Range 1000–4000 kcal, step ±10; valori digitati fuori range restano accettati, slider/± restano clampati. Chiama ancora `onTargetKcalChange` → barre macro riscalate a 100%. `TargetInput` invariato (edit pasto).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (slider/±/digitazione kcal; barre a 100%; Salva); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: fix rimbalzo apertura + bottoni Salva/Annulla visibili (Cursor)
**Fatto:** corretti due bug introdotti dall'easing precedente in `frontend/src/App.jsx`. (1) **Rimbalzo:** rimossi i due spacer con `flex-grow` animato ai lati del blocco calorie (facevano muovere il conto in modo non monotono mentre la card cresceva) e riportato il pannello Obiettivi alla sola animazione grid (`flex: targetsAnimOpen ? 1 : undefined`, la classe `.vt-edit-collapse` gestisce la transizione di `grid-template-rows`). Il conto ora resta ancorato in alto (`justifyContent: 'flex-start'` costante), niente più rimbalzo. Gauge con `marginTop: 'auto'` a Obiettivi chiuso per restare in fondo alla card senza spacer. (2) **Ripartizione + Salva/Annulla non visibili su telefono:** l'editor era clippato da `.vt-edit-collapse-inner { overflow: hidden }`. Ora il contenuto (titolo/help/Calorie/slider/Ripartizione/msg) è in un blocco `flex:1, minHeight:0, overflowY:auto` (scorre se serve) e la riga bottoni è un footer fisso (`flexShrink:0`): i bottoni restano sempre a fondo pannello, visibili anche su schermi corti. Accorciato il testo di aiuto.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiusi rimbalzo apertura Obiettivi e bottoni tagliati su telefono. Invariati (ml parsing; focus camera 0.5x). NB: shell non disponibile in sessione → build/lint non eseguiti, solo revisione manuale.
**Prossimo passo:** verifica su telefono con `npm run dev` (apertura fluida senza rimbalzo; Ripartizione + Salva/Annulla sempre visibili, slider scrollabili); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: easing apertura + kcal riscala barre a 100% (Cursor)
**Fatto:** due richieste sulla scheda Obiettivi in `frontend/src/App.jsx`. (1) **Easing all'apertura:** il conto calorie non "scatta" più verso l'alto. Rimossi i flip istantanei keyed su `targetsMounted` (hero card `justifyContent` ora sempre `flex-start`, `padding`/`gap` del fold costanti); aggiunti due spacer flessibili (`flexGrow` 1→0 con `transition: flex-grow 0.28s`) sopra e sotto il blocco kcal, così il conto sale con easing invece che di colpo. Il blocco azioni+macro non si smonta più di scatto: ora è sempre montato e **collassa con easing** via `flexGrow: targetsAnimOpen ? 0 : (dayOffset===0 ? 2 : 1)` + `flexBasis:0` + `overflow:hidden` + `opacity` (transizione flex-grow/margin-top/opacity ~280 ms), lasciando crescere la hero card con continuità (equal-thirds preservato a Obiettivi chiuso). Il pannello Obiettivi passa da `flex` istantaneo a `flexGrow` transizionato (grid-template-rows + flex-grow) per un hand-off dello spazio senza dip del conto. (2) **Matematica kcal:** `onTargetKcalChange` non ricalcola più le % dai grammi fissi (che faceva scendere il totale sotto 100). Ora tiene le proporzioni attuali delle barre e le **riscala a somma 100** (`normalize100`), poi deriva i grammi (`gramsFromPctOne`): digitando un nuovo valore di calorie le tre barre si aggiustano in proporzione fino a 100%. `setMacroSlider`/`setMacroGrams` invariati → **indipendenza sul tocco singolo** preservata. Aggiornato il testo di aiuto nel pannello.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x). NB: shell non disponibile in sessione → build/lint non eseguiti, solo revisione manuale del codice.
**Prossimo passo:** verifica su telefono con `npm run dev` (apri/chiudi Obiettivi con easing del conto; digita kcal e controlla che le barre tornino a 100% in proporzione; muovi una barra da sola e verifica che le altre non cambino); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi: ± ai lati barra + spacing (Cursor)
**Fatto:** in `MacroSlider` i tasti ± sono a sinistra/destra della range (non più accanto a %/g); `marginTop: 10px` sotto Calorie e `gap-6` tra le tre barre macro.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`.

## 2026-07-21 — Obiettivi: %/g digitabili e ±1 g (Cursor)
**Fatto:** nell’editor Obiettivi, più spazio tra le tre barre macro (`gap-5`); % e grammi digitabili; tasti ± per ogni barra (±1 g). I grammi in `targetDraft` sono la quantità precisa; slider/% aggiornano solo quel macro; salvataggio ancora bloccato se la ripartizione ≠100%.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (digitazione %, g, ±, slider, Salva a 100%).

## 2026-07-21 — Data e frecce giorno; no refresh (Cursor)
**Fatto:** sulla card calorie del Diario: label data `14px`; frecce prev/next `size={22}` / hit area 32px; rimosso il pulsante RefreshCw accanto alla data (resta solo «Oggi» quando si sfoglia lo storico).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`.

## 2026-07-21 — Spacing card calorie (Cursor)
**Fatto:** sulla card calorie del Diario, con Obiettivi chiuso `justifyContent: space-between` distribuisce data / kcal+resto / barra sull’altezza della card (più aria tra titolo e conto, barra in basso senza vuoto sotto). Padding basso `34px` (vs 22px) per alzare di poco conto e barra. Con Obiettivi aperto resta `flex-start` e padding 22px. Il blocco kcal+«Restano» è raggruppato in un unico figlio flex.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; se all’apri Obiettivi data/kcal saltano, tornare a spacer fissi con `flex-start` sempre.

## 2026-07-21 — Swap card azioni / macronutrienti (Cursor)
**Fatto:** sul Diario, ordine above-fold aggiornato a calorie → azioni (TESTO/SCAN/VOCE) → Macronutrienti; «Pasti di oggi» resta sotto lo scroll.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Fix salto testo Obiettivi (Cursor)
**Fatto:** sulla card calorie del Diario, `justifyContent` è sempre `flex-start` (prima passava da `center` a `flex-start` all’apertura Obiettivi, facendo saltare data e kcal). Uniformato anche `marginTop` della gauge a 14px.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso salto testo data/kcal all’apri/chiudi Obiettivi. Invariati ml parsing; focus camera 0.5x.
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Fix fold Diario: padding basso + Obiettivi senza salto (Cursor)
**Fatto:** sul wrapper above-fold del Diario aggiunto `paddingBottom: 22px` (pari al gap tra card) così TESTO/SCAN/VOCE non finisce a filo sullo schermo. Rimosso `scrollIntoView` all’apertura Obiettivi e il `minHeight` fullscreen sulla card calorie: il bordo alto resta fermo sotto le tab e il pannello si apre solo verso il basso riempiendo lo spazio liberato da macro/azioni.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Layout Diario above-fold + Obiettivi fullscreen (Cursor)
**Fatto:** sul tab Diario di `frontend/src/App.jsx` le card calorie / Macronutrienti / TESTO·SCAN·VOCE sono in un wrapper `minHeight: calc(100dvh - 150px)` con `flex:1` e gap/padding più ampi, così la prima viewport si chiude sulla card azioni e «Pasti di oggi» parte sotto lo scroll. Con **Obiettivi** aperto la card calorie espande a tutta altezza utile, macro/azioni si nascondono, editor con più respiro (`gap-3`, padding 16px, bottoni più grandi); scrollIntoView all’apertura; chiusura ripristina il fold a 3 card.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (fold fino a SCAN/VOCE; Obiettivi a tutto schermo; Annulla/Salva); deploy Vercel quando pronto.

## 2026-07-21 — Easing pannello Obiettivi (Cursor)
**Fatto:** apertura/chiusura del menu Obiettivi nella card calorie usa la stessa animazione collapse del pannello edit pasto (`vt-edit-collapse`: altezza 0fr→1fr + opacità, ~280 ms). Il pannello resta montato durante l’exit; unmount su `transitionend` / fallback 300 ms.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (apri/chiudi Obiettivi, Annulla, Salva); deploy Vercel quando pronto.

## 2026-07-21 — Bottone Obiettivi sulla riga kcal (Cursor)
**Fatto:** nella card calorie del Diario (`frontend/src/App.jsx`) il controllo **Obiettivi** non è più allineato alla riga «Restano / Superato … kcal»: è spostato sulla riga del totale (`N / target kcal`) e stilizzato come bottone (bordo, sfondo `surfaceRaised`, padding).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-21 — Animazione apertura/chiusura pannello edit pasto (Cursor)
**Fatto:** in `MealRow` (`frontend/src/App.jsx`) il pannello macro di modifica (tap matita / swipe→edit / Annulla / Salva / passaggio a conferma delete) non fa più mount/unmount istantaneo: wrapper CSS `grid-template-rows 0fr→1fr` + opacità (~280 ms, stessa easing del carosello tab). Snapshot locale di `editDraft` durante l’exit così i campi restano visibili mentre collassa; unmount su `transitionend` con fallback timeout 300 ms.
**Nuove superfici/config:** nessuna (classi `.vt-edit-collapse` in `EXTRA_CSS`).
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (apri/chiudi edit da matita, swipe e Annulla); deploy Vercel quando pronto.

## 2026-07-21 — Trend Diario: viste Anno / Mese / Settimana (Cursor)
**Fatto:** nella card trend del Diario (ex «Ultimi 7 giorni») aggiunti tre pulsanti **ANNO / MESE / SETTIMANA** (sx→dx). Default = settimana (invariata). Mese = 5 settimane rolling con media giornaliera; anno = 12 mesi con media giornaliera sui giorni loggati. Backend `/dashboard` esteso con `storico_mensile` e `storico_annuale` dalla stessa lettura Sheets (nessuna colonna nuova); frontend wire + demo + cache `vt-cache`. Tap su barra/etichetta naviga al Diario sulla `date` del bucket.
**Nuove superfici/config:** chiavi JSON `/dashboard` `storico_mensile` e `storico_annuale` (richiede redeploy Cloud Function).
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** deploy Cloud Function + verifica su telefono (`npm run dev`); poi deploy Vercel.

## 2026-07-21 — Carosello swipe animato tra schede PWA (Cursor)
**Fatto:** rifatto lo swipe tra Diario / Traccia / Scan in `frontend/src/App.jsx` come **carosello a piena altezza**. Le tre schede restano affiancate (`translateX`); durante il drag la scheda successiva **spunta dal lato** e segue il dito; al rilascio anima lo snap (o torna indietro). Area di gesto = tutta la viewport sotto la tab bar (`minHeight: calc(100dvh - 150px)`), quindi funziona anche sul nero vuoto sotto le card. Direzioni: sx→avanti, dx→indietro, con rubber-band ai bordi. Scroll verticale protetto (lock asse); esclusi input/bottoni, swipe riga pasto e camera in scansione. Tap sulla tab bar usa la stessa animazione (`goToTab`).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (swipe in entrambe le direzioni su tutte le tab, anche sul nero in fondo; controllare anteprima della scheda adiacente mentre si trascina); deploy Vercel quando pronto.

## 2026-07-21 — Swipe orizzontale tra schede PWA (Cursor)
**Fatto:** in `frontend/src/App.jsx` aggiunta navigazione a swipe tra i tab Diario, Traccia e Scan. Swipe verso sinistra → scheda successiva; verso destra → precedente. Gesture sul contenuto sotto la tab bar (`touchAction: pan-y` per non bloccare lo scroll verticale). Disabilitata con pannello Config/Obiettivi aperto, edit/delete pasto attivo, camera in scansione; esclusi input, bottoni e righe pasto (`data-no-tab-swipe` + `stopPropagation` sullo swipe riga).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (swipe Diario↔Traccia↔Scan; controllare che lo swipe riga pasto non cambi tab); deploy Vercel quando pronto.

## 2026-07-21 — Card azioni rapide sul Diario (Cursor)
**Fatto:** sul tab Diario di `frontend/src/App.jsx`, tra la card «Macronutrienti» e «Pasti di oggi», aggiunta una card con tre bottoni rotondi (solo se `dayOffset === 0`): sinistra **TESTO** → tab Traccia + focus sul campo digitato; centro **SCAN** → tab Scan + avvio automatico camera; destra **VOCE** → tab Traccia + avvio automatico microfono. Riuso completo dei flussi esistenti via `pendingActionRef` + `launchQuickAction` + `useEffect` post-`setView` (e `typedInputRef` sull'input di Traccia). Nessuna modifica backend.
**Nuove superfici/config:** nessuna (solo UI Diario).
**Bug aperti/chiusi:** invariati (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica su telefono con `npm run dev` (toccare i tre bottoni dal Diario e controllare focus testo / mic / camera); deploy Vercel quando pronto.

## 2026-07-21 — Editor Obiettivi: slider macro indipendenti + validazione 100% (Cursor)
**Fatto:** cambiato il comportamento degli slider di ripartizione macro nell'editor «Obiettivi giornalieri» (`frontend/src/App.jsx`) su richiesta: gli slider ora sono **indipendenti** — trascinarne uno NON tocca più gli altri due (rimossa `rebalancePct` e la ridistribuzione proporzionale). `setMacroSlider` fa un semplice set del singolo valore (clamp 0-100). La riga «Ripartizione» in fondo al pannello mostra ora il **totale reale** (es. `= 90%`) e diventa **rossa** (`C.alert`) quando ≠ 100, tornando al colore standard (`C.inkFaint`) a 100%. `saveTargets` **blocca il salvataggio** se `macroPct.p+c+g !== 100`, mostrando «Serve una ripartizione al 100% per salvare» (nuovo blocco messaggio dentro il pannello, visibile mentre l'editor è aperto). Rimosse le **percentuali accanto a ogni macro** nella card «Macronutrienti» del Diario (tolta la prop `pct` dalle tre `MacroRow`, il blocco `showPct` nel componente e la variabile ora inutile `macroTotalCal`). `macroPct` resta la fonte di verità mentre il pannello è aperto e i grammi salvati restano derivati da split + kcal (riempiono le kcal solo quando la somma è 100%). All'apertura del pannello lo split è ancora normalizzato a 100 dai grammi salvati (`pctFromGrams`).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** invariati gli altri bug aperti (ml parsing; focus camera 0.5x). NB: il tool shell non ha risposto in questa sessione → build/lint non eseguiti automaticamente, solo revisione manuale del codice.
**Prossimo passo:** verifica su telefono con `npm run dev` (aprire Obiettivi: gli slider si muovono indipendenti; il totale «Ripartizione» diventa rosso ≠100 e verde/standard a 100; Salva bloccato con messaggio se ≠100; nella card Macronutrienti niente più % accanto ai macro); deploy Vercel quando pronto.

## 2026-07-21 — Editor Obiettivi: split macro con slider che somma sempre 100% (Cursor)
**Fatto:** rivisto l'editor «Obiettivi giornalieri» in `frontend/src/App.jsx` per risolvere due problemi emersi provando la versione precedente: (a) la somma delle percentuali poteva restare diversa da 100% (es. 87%) perché le % erano derivate dai grammi salvati; (b) la percentuale era solo un numero stampato, non regolabile. Ora le **percentuali sono la fonte di verità** mentre il pannello è aperto (nuovo stato `macroPct = {p,c,g}`, sempre a somma 100) e i **grammi salvati sono derivati** da split + kcal (`gramsFromPct`: P/C ÷4, G ÷9), quindi riempiono esattamente le calorie. Ogni macro ha uno **slider** (`MacroSlider`, `input type=range` con `accentColor` nel colore del macro) che mostra % e grammi derivati; trascinandone uno gli altri due si **ridistribuiscono in proporzione** (`rebalancePct`, l'ultimo assorbe l'arrotondamento → somma esatta 100). All'apertura del pannello lo split è normalizzato a 100 dai grammi salvati (`pctFromGrams` + `normalize100` col metodo del resto più grande): un target salvato "storto" (es. 87%) appare subito come 100%. Le calorie restano un input numerico normale: cambiandole i grammi si ricalcolano live. `saveTargets` ora salva `{kcal, ...gramsFromPct(kcal, macroPct)}` (backend/schema Sheets invariati). Rimosso il vecchio meccanismo onBlur di riscalo kcal→grammi (`kcalFocusRef`, handler dedicati) e l'avviso "somma ≠ 100%" (non più necessario); `TargetInput` riportato alla firma originale (tolte le prop `pct/onFocus/onBlur`). Restano le % dei macro consumati nella card Macronutrienti del Diario (sessione precedente).
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiusi i due problemi sopra (somma ≠ 100 e % non regolabile). Invariati gli altri bug aperti (ml parsing; focus camera 0.5x). NB: il tool shell non ha risposto in questa sessione → build/lint non eseguiti automaticamente, solo revisione manuale del codice.
**Prossimo passo:** verifica su telefono con `npm run dev` (aprire Obiettivi: gli slider devono sommare 100%, trascinandone uno gli altri si adeguano, grammi/kcal coerenti, un target salvato non-100% appare a 100% all'apertura); deploy Vercel quando pronto.

## 2026-07-21 — Obiettivi con macro collegati: % di ripartizione + riscalo dei grammi sulle kcal (Cursor)
**Fatto:** implementata la parte "Config collegata" di §7.2 nell'editor **Obiettivi giornalieri** di `frontend/src/App.jsx`. (1) Ogni macro mostra ora la sua **percentuale sulle calorie target** (P/C ×4, G ×9) in un badge accanto ai grammi; sotto i campi una riga di riepilogo «Ripartizione: X% P · Y% C · Z% G». (2) Quando si **cambiano le calorie** i grammi dei tre macro si **riscalano in proporzione** mantenendo invariate le percentuali (i nutrienti "riflettono il totale"): il riscalo avviene onBlur del campo kcal (ref `kcalFocusRef` cattura le kcal a inizio modifica), così i valori intermedi digitati non azzerano i grammi. (3) Cambiando i grammi di un macro le % si aggiornano da sole (derivate nel render) e, se la somma si scosta da ~100% delle kcal target (>2 punti), compare un avviso ambra. Aggiunte inoltre le **% dei macro consumati** nella card «Macronutrienti» del Diario (badge colorato accanto a ogni macro). `TargetInput` esteso con prop opzionali `pct`/`onFocus`/`onBlur`; `MacroRow` con prop opzionale `pct` (rinominata la variabile interna della barra in `barPct` per non confondersi con la %). Nessuna modifica a backend/schema Sheets: i target restano `{kcal, proteine, carboidrati, grassi}` in grammi, le % sono solo derivate lato client.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso l'item "Config con % macro" (§7.2, §4). Invariati gli altri bug aperti (ml parsing; focus camera 0.5x). NB: il tool shell non ha risposto in questa sessione → build/lint non eseguiti automaticamente, solo revisione manuale del codice.
**Prossimo passo:** verifica visiva su telefono con `npm run dev` (editor Obiettivi: cambiare kcal e controllare che i grammi si riscalino e le % restino; cambiare un grammo e vedere l'avviso di somma); deploy Vercel quando pronto.

## 2026-07-21 — Layout riga pasto su 3 righe + trend settimanale interattivo (Cursor)
**Fatto:** in `frontend/src/App.jsx`, componente `MealRow`: la riga di ogni pasto nel Diario aveva nome+dettagli a sinistra e kcal a destra sulla stessa riga (con nomi lunghi il numero finiva "attaccato" al testo). Riscritta su 3 righe verticali: nome pasto, poi `orario · grammi g · fonte`, poi una nuova riga con `kcal · proteine/carboidrati/grassi` (macro per pasto non erano mai mostrati, solo i totali giornata). Aggiunta interattività al grafico "Ultimi 7 giorni": tap sul nome del giorno (nuovo componente `WeekAxisTick`, area di tap allargata per il touch) o sulla colonna stessa naviga il Diario a quella data, riusando il campo `date` che `/dashboard` già restituiva per ogni giorno dello storico settimanale (nessuna modifica backend). `DEMO_WEEK` ora genera date reali degli ultimi 7 giorni (prima erano un array fisso lun→dom senza data) cosi' il tap funziona anche in modalita' demo; spostato `fmtYMD` prima della sua definizione originale per riuso.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso layout riga pasto (dati "attaccati" sulla stessa riga) e aggiunta navigazione dal trend settimanale. Invariati gli altri bug aperti (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica visiva su telefono con `npm run dev` (il tool shell non ha risposto in questa sessione: build/lint non eseguiti automaticamente, solo revisione manuale del codice); deploy Vercel quando pronto.

## 2026-07-21 — Layout navigazione giorno nel Diario (Cursor)
**Fatto:** fix layout barra giorno nella hero card del tab Diario in `frontend/src/App.jsx`: le classi utility `flex`/`justify-between` non erano definite nel CSS del progetto, quindi frecce e refresh si impilavano in colonna. Sostituite con grid a 3 colonne (28px | 1fr | 28px) e flex centrato sulla colonna centrale — freccia indietro a sinistra, avanti a destra, etichetta data + refresh (o «Oggi») al centro.
**Nuove superfici/config:** nessuna.
**Bug aperti/chiusi:** chiuso layout navigazione giorno (frecce verticali + refresh disallineato a sinistra). Invariati gli altri bug aperti (ml parsing; focus camera 0.5x).
**Prossimo passo:** verifica visiva su telefono con `npm run dev`; deploy Vercel quando pronto.

## 2026-07-20 — Edit/delete pasti nella PWA (Claude Code)
**Fatto:** implementata in `frontend/src/App.jsx` la modifica e l'eliminazione di un pasto dal Diario (Sessione 2 §7.2, parte edit/delete). Tap su una riga → pannello di modifica inline (alimento + grammi/kcal/macro, riuso di `TargetInput`) → `POST /update_meal`. Eliminazione con conferma inline, raggiungibile in due modi: pulsante «Elimina» nel pannello **e** swipe-to-delete sulla riga → `POST /delete_meal`. Dopo ogni mutazione: refresh del giorno mostrato (`fetchLive` per oggi, con riscrittura di `vt-cache`; ricarico via `historyTick` per i giorni passati). Gating: azioni attive solo in modalità live e su righe con `id` reale; le righe storiche `legacy-*` e la modalità demo restano di sola lettura. Fix collaterale: il loader dei giorni passati preserva l'`id` UUID reale (prima lo sovrascriveva con un indice). Il backend (Sessione 1: colonna `id`, `/update_meal`, `/delete_meal`) era già presente nel codice — nessuna modifica backend, ma va (ri)deployato perché gli endpoint siano live.
**Nuove superfici/config:** nessuna nuova config. Verificato con build Vite + smoke test browser (demo read-only; live con backend mock: update/delete chiamati con `id` corretto, righe legacy non editabili, nessun errore runtime).
**Bug aperti/chiusi:** invariati (ml parsing da verificare; focus camera 0.5x ancora in Sessione 2).
**Prossimo passo:** deploy Cloud Function + test end-to-end su telefono reale; poi resto della Sessione 2 (Config con % macro; fix focus camera).

## 2026-07-20 — Consolidamento documentazione (Claude.ai)
**Fatto:** i 4 documenti storici (Roadmap, Piano di Consolidamento, Registro di Manutenzione, Rifiniture Deploy 5) sono stati fusi in `docs/stato-progetto.md`, deduplicando il completato e conservando i desideri di lungo periodo (§8, incl. Gemini orchestratore). Creata la struttura repo con `CLAUDE.md`, `AGENTS.md` e `.cursor/rules/voicetrack.mdc` come indici sottili sulla stessa fonte di verità.
**Nuove superfici/config:** questo repo di documentazione; nessuna modifica a backend/PWA/Tasker.
**Bug aperti/chiusi:** invariati (ml parsing da verificare; focus camera 0.5x pianificato in Sessione 2).
**Prossimo passo:** Sessione 1 del piano Rifiniture (colonna `id` + `/update_meal` + `/delete_meal`).
