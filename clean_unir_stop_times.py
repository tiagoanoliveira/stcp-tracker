#!/usr/bin/env python3
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # raiz do repo
STOP_TIMES_DIR = ROOT / "resources" / "unir-gtfs" / "stop_times"

def clean_file(path: Path):
    print(f"Limpar {path.name}...")
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    seen = set()
    cleaned = []

    for entry in data:
        # Ajusta estes campos conforme o teu schema
        trip_id = entry.get("trip_id")
        stop_id = entry.get("stop_id")
        arrival = entry.get("arrival_time")  # ou "arrival" / "time"

        key = (trip_id, stop_id, arrival)

        if key in seen:
            # entrada duplicada — ignora
            continue

        seen.add(key)
        cleaned.append(entry)

    if len(cleaned) != len(data):
        print(f"  Removidas {len(data) - len(cleaned)} entradas duplicadas.")
        with path.open("w", encoding="utf-8") as f:
          json.dump(cleaned, f, ensure_ascii=False, indent=2)
    else:
        print("  Nenhum duplicado encontrado.")

def main():
    for file in sorted(STOP_TIMES_DIR.glob("*.json")):
        clean_file(file)

if __name__ == "__main__":
    main()