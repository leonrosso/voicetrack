"""
VoiceTrack — LLM Client
Gestisce la chiamata a Claude API (o GPT) per estrarre dati nutrizionali dal testo.
Architettura astratta per switch facile tra provider.
"""

import json
import os
import anthropic

# --- Configurazione ---
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "claude")  # "claude" o "openai"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")  # Per switch futuro
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")

# --- System Prompt ---
SYSTEM_PROMPT = """Sei un nutrizionista esperto e preciso. Il tuo compito è analizzare la descrizione di un pasto in italiano ed estrarre i dati nutrizionali.

REGOLE:
1. Estrai ogni singolo alimento menzionato, inclusi condimenti e bevande.
2. Per ogni alimento, stima: grammi, kcal, proteine (g), carboidrati (g), grassi (g).
3. Se l'utente specifica una quantità (es. "500g di tacchino"), usala. 
4. Se la quantità è VAGA (es. "un piatto di pasta", "un po' di riso", "della carne"), NON inventare una quantità. Rispondi con status "needs_clarification" e chiedi di specificare i grammi. Suggerisci una porzione standard come riferimento.
5. Eccezioni alla regola 4: per condimenti comuni (olio, sale, pepe, aceto) puoi stimare una dose standard senza chiedere (es. olio = 10ml/un cucchiaio). Per alimenti con unità naturale (es. "una mela", "un uovo", "una banana") puoi stimare il peso standard.
6. I valori nutrizionali devono essere per la quantità specificata, NON per 100g.
7. Considera il metodo di cottura se menzionato (alla griglia, fritto, bollito, ecc.) per aggiustare i grassi.
8. Rispondi SOLO con JSON valido, nessun testo prima o dopo.
9. BEVANDE E LIQUIDI in millilitri (es. "500 ml di birra", "200 ml di latte"): tratta i ml come grammi (per le bevande 1 ml ≈ 1 g) e metti il numero nel campo "grammi". NON aggiungere note, commenti, campi extra o testo sulla conversione: la risposta resta SOLO il JSON nel formato indicato. I valori nutrizionali vanno calcolati per la quantità dichiarata.

FORMATO RISPOSTA (pasto registrato con successo):
{
  "status": "ok",
  "items": [
    {
      "alimento": "nome alimento",
      "grammi": 000,
      "kcal": 000,
      "proteine": 00.0,
      "carboidrati": 00.0,
      "grassi": 00.0
    }
  ],
  "totale": {
    "kcal": 000,
    "proteine": 00.0,
    "carboidrati": 00.0,
    "grassi": 00.0
  },
  "riepilogo_vocale": "Breve frase in italiano che riassume il pasto e i totali per essere letta ad alta voce. Max 2 frasi."
}

FORMATO RISPOSTA (quantità vaga, serve chiarimento):
{
  "status": "needs_clarification",
  "message": "Domanda specifica in italiano per chiarire la quantità",
  "riepilogo_vocale": "Stessa domanda in forma naturale per TTS"
}

ESEMPI DI STIME ACCURATE:
- Petto di pollo/tacchino: ~110 kcal, ~23g proteine, ~0g carbo, ~1.5g grassi per 100g
- Pasta secca (cruda): ~350 kcal, ~12g proteine, ~72g carbo, ~1.5g grassi per 100g  
- Riso bianco (crudo): ~360 kcal, ~7g proteine, ~80g carbo, ~0.5g grassi per 100g
- Olio EVO: ~900 kcal, ~0g proteine, ~0g carbo, ~100g grassi per 100ml
- Uovo intero: ~70 kcal, ~6g proteine, ~0.5g carbo, ~5g grassi (1 uovo ~60g)
- Pane bianco: ~265 kcal, ~9g proteine, ~49g carbo, ~3g grassi per 100g
- Mozzarella: ~250 kcal, ~18g proteine, ~1g carbo, ~19g grassi per 100g
- Tonno in scatola sgocciolato: ~130 kcal, ~26g proteine, ~0g carbo, ~2g grassi per 100g
- Banana: ~90 kcal, ~1g proteine, ~23g carbo, ~0.3g grassi (1 banana ~120g)
- Birra chiara: ~43 kcal, ~0.5g proteine, ~3.6g carbo, ~0g grassi per 100ml
- Latte intero: ~64 kcal, ~3.3g proteine, ~4.9g carbo, ~3.6g grassi per 100ml
- Succo d'arancia: ~45 kcal, ~0.7g proteine, ~10g carbo, ~0g grassi per 100ml

Rispondi SOLO con il JSON, niente altro."""


def parse_meal_with_llm(text: str) -> dict:
    """
    Invia il testo del pasto all'LLM e ritorna il JSON strutturato.
    
    Args:
        text: Testo trascritto dall'utente (in italiano)
    
    Returns:
        dict con status "ok" o "needs_clarification"
    """
    if LLM_PROVIDER == "claude":
        return _call_claude(text)
    elif LLM_PROVIDER == "openai":
        return _call_openai(text)
    else:
        return {
            "status": "error",
            "message": f"Provider LLM non supportato: {LLM_PROVIDER}",
            "riepilogo_vocale": "Errore di configurazione del sistema."
        }


def _call_claude(text: str) -> dict:
    """Chiama Claude API via SDK ufficiale."""
    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": text}
            ]
        )

        # Estrai il testo dalla risposta. NON assumere che content[0] sia
        # testo: i modelli recenti (Sonnet 5+) possono premettere un blocco
        # di "thinking" — va saltato e concatenati solo i blocchi "text".
        response_text = "".join(
            block.text for block in message.content
            if getattr(block, "type", "") == "text"
        ).strip()

        if not response_text:
            return {
                "status": "error",
                "message": "La risposta del modello non contiene testo.",
                "riepilogo_vocale": "Non ho ricevuto una risposta valida. Riprova."
            }

        # Rimuovi eventuali backtick markdown
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[-1]
        if response_text.endswith("```"):
            response_text = response_text.rsplit("```", 1)[0]
        response_text = response_text.strip()

        result = json.loads(response_text)

        # Arrotonda i valori numerici
        if result.get("items"):
            for item in result["items"]:
                for key in ["grammi", "kcal", "proteine", "carboidrati", "grassi"]:
                    if key in item:
                        item[key] = round(item[key], 1)
            if result.get("totale"):
                for key in ["kcal", "proteine", "carboidrati", "grassi"]:
                    if key in result["totale"]:
                        result["totale"][key] = round(result["totale"][key], 1)

        return result

    except json.JSONDecodeError as e:
        return {
            "status": "error",
            "message": f"Risposta LLM non è JSON valido: {str(e)}",
            "riepilogo_vocale": "Non sono riuscito a interpretare la risposta. Riprova."
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Errore chiamata Claude: {str(e)}",
            "riepilogo_vocale": "Errore nella comunicazione col server. Riprova."
        }


def _call_openai(text: str) -> dict:
    """
    Placeholder per switch futuro a GPT-4o-mini.
    Stessa interfaccia di _call_claude.
    """
    # TODO: Implementare quando necessario
    # import openai
    # client = openai.OpenAI(api_key=OPENAI_API_KEY)
    # response = client.chat.completions.create(
    #     model="gpt-4o-mini",
    #     messages=[
    #         {"role": "system", "content": SYSTEM_PROMPT},
    #         {"role": "user", "content": text}
    #     ],
    #     max_tokens=1024,
    #     response_format={"type": "json_object"}
    # )
    # return json.loads(response.choices[0].message.content)
    return {
        "status": "error",
        "message": "Provider OpenAI non ancora implementato.",
        "riepilogo_vocale": "Il provider OpenAI non è ancora configurato."
    }
