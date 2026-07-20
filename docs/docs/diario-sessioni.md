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

## 2026-07-20 — Consolidamento documentazione (Claude.ai)
**Fatto:** i 4 documenti storici (Roadmap, Piano di Consolidamento, Registro di Manutenzione, Rifiniture Deploy 5) sono stati fusi in `docs/stato-progetto.md`, deduplicando il completato e conservando i desideri di lungo periodo (§8, incl. Gemini orchestratore). Creata la struttura repo con `CLAUDE.md`, `AGENTS.md` e `.cursor/rules/voicetrack.mdc` come indici sottili sulla stessa fonte di verità.
**Nuove superfici/config:** questo repo di documentazione; nessuna modifica a backend/PWA/Tasker.
**Bug aperti/chiusi:** invariati (ml parsing da verificare; focus camera 0.5x pianificato in Sessione 2).
**Prossimo passo:** Sessione 1 del piano Rifiniture (colonna `id` + `/update_meal` + `/delete_meal`).
