# VoiceTrack — Guida al Deploy

## Struttura file

```
voicetrack/
├── main.py              # Entry point HTTP (handler principale)
├── llm_client.py        # Logica LLM (Claude API + placeholder OpenAI)
├── sheets_client.py     # Logica Google Sheets (lettura/scrittura)
├── requirements.txt     # Dipendenze Python
├── .env.yaml.example    # Template variabili d'ambiente
└── DEPLOY.md            # Questa guida
```

## Step 1: Prepara il Google Sheet

1. Apri il tuo Google Sheet
2. Rinomina il primo foglio (tab in basso) in **"Pasti"**
3. Nella riga 1, inserisci le intestazioni:

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| timestamp | alimento | grammi | kcal | proteine | carboidrati | grassi | fonte | note |

4. Assicurati che il foglio sia condiviso con l'email del Service Account (quella che finisce con `@...iam.gserviceaccount.com`)

## Step 2: Prepara le variabili d'ambiente

1. Copia `.env.yaml.example` in `.env.yaml`
2. Compila tutti i valori:
   - **VOICETRACK_API_KEY**: inventane una (es. genera con `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`)
   - **ANTHROPIC_API_KEY**: la tua chiave da console.anthropic.com
   - **SPREADSHEET_ID**: l'ID dal URL del foglio Google (la stringa lunga tra `/d/` e `/edit`)
   - **GOOGLE_CREDENTIALS_JSON**: il contenuto INTERO del file JSON del Service Account, tutto su una riga

## Step 3: Deploy su Google Cloud

Apri il terminale e naviga nella cartella `voicetrack/`:

```bash
cd voicetrack

# Deploy della Cloud Function (gen2)
gcloud functions deploy voicetrack \
  --gen2 \
  --runtime python312 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point voicetrack \
  --region europe-west1 \
  --memory 256MB \
  --timeout 60s \
  --env-vars-file .env.yaml
```

> **Nota:** `--allow-unauthenticated` permette a Tasker di chiamare la funzione senza autenticazione Google.
> La sicurezza è gestita dalla VOICETRACK_API_KEY nell'header `X-API-Key`.
> Abbiamo scelto `europe-west1` (Belgio) per bassa latenza dall'Italia.

Al termine del deploy, il terminale ti mostrerà l'URL della funzione, tipo:
```
https://voicetrack-XXXXX-ew.a.run.app
```
Conserva questo URL — ti servirà per configurare Tasker.

## Step 4: Test rapido

Testa con curl che tutto funzioni:

```bash
# Sostituisci URL e API_KEY con i tuoi valori

# Test log_meal
curl -X POST https://TUO-URL/log_meal \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TUA-API-KEY" \
  -d '{"text": "ho mangiato 500 grammi di petto di tacchino alla griglia e insalata mista con un cucchiaio di olio"}'

# Test daily_summary
curl -X GET "https://TUO-URL/daily_summary" \
  -H "X-API-Key: TUA-API-KEY"
```

## Endpoint disponibili

### POST /log_meal
Registra un pasto. Invia il testo trascritto da Tasker.

**Request:**
```json
{
  "text": "ho mangiato 500 grammi di tacchino alla griglia e insalata con olio"
}
```

**Headers:**
```
Content-Type: application/json
X-API-Key: tua-api-key
```

**Response (successo):**
```json
{
  "status": "ok",
  "items": [...],
  "totale": {"kcal": 665, "proteine": 112, ...},
  "riepilogo_vocale": "Registrato: tacchino alla griglia e insalata. Totale 665 calorie, 112 grammi di proteine."
}
```

**Response (serve chiarimento):**
```json
{
  "status": "needs_clarification",
  "message": "Quanti grammi di pasta intendi?",
  "riepilogo_vocale": "Non ho capito la quantità di pasta. Quanti grammi circa?"
}
```

### GET /daily_summary
Riepilogo della giornata. Parametro opzionale `?date=2026-04-04`.

**Response:**
```json
{
  "status": "ok",
  "data": "2026-04-04",
  "pasti_registrati": 3,
  "totale": {"kcal": 1850, "proteine": 165, ...},
  "target": {"kcal": 3000, "proteine": 300, ...},
  "rimanenti": {"kcal": 1150, "proteine": 135, ...},
  "riepilogo_vocale": "Oggi hai mangiato 1850 calorie..."
}
```
