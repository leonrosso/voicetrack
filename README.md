# VoiceTrack (Diethropic)

App di tracciamento calorie via input vocale/testo, con backend su Google Cloud Function e Google Sheets come storage.

## Struttura

- `frontend/` — PWA (Vite + React), dashboard di consultazione e inserimento pasti
- `backend/` — Cloud Function Python (main.py, llm_client.py per il parsing via Claude, sheets_client.py per Google Sheets)
- `docs/` — note di progetto, stato avanzamento, config per agenti (AGENTS.md, CLAUDE.md)

## Setup locale

1. `cd frontend && npm install && npm run dev`
2. `cd backend && pip install -r requirements.txt`
3. Copia `backend/.env.yaml.example` in `backend/.env.yaml` e inserisci le credenziali reali (mai committarle)

## Note

Le credenziali reali e il materiale non di codice (pianificazione, bozze superate) sono conservati fuori da questo repo, in `voicetrack-archivio/`.
