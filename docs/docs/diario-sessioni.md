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
