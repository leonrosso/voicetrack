"""
run_local.py — avvia la Cloud Function `voicetrack` in locale con functions-framework,
caricando le variabili d'ambiente da .env.yaml.

Uso (identico su bash, PowerShell, cmd):
    cd backend
    python run_local.py

Requisiti (una volta sola):
    pip install functions-framework pyyaml
"""

import os
import sys
import subprocess
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(HERE, ".env.yaml")

if not os.path.isfile(ENV_FILE):
    print(f"ERRORE: non trovo {ENV_FILE}")
    print("Copia il .env.yaml reale (da voicetrack-archivio/credenziali/) in questa cartella prima di lanciare lo script.")
    sys.exit(1)

with open(ENV_FILE, encoding="utf-8") as f:
    env_vars = yaml.safe_load(f) or {}

full_env = os.environ.copy()
for key, value in env_vars.items():
    full_env[str(key)] = str(value)

print(f"Variabili caricate da .env.yaml: {list(env_vars.keys())}")
print("Avvio functions-framework su http://localhost:8080 (target: voicetrack)")
print("Ctrl+C per fermare.\n")

subprocess.run(
    [
        sys.executable, "-m", "functions_framework",
        "--target=voicetrack",
        "--debug",
        "--port=8080",
    ],
    env=full_env,
    cwd=HERE,
)
