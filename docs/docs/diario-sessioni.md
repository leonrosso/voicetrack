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
