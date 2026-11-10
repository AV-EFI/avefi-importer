"""
Holt das AVefi-JSON-Schema eines bestimmten Stands ins Abbild.

Aufgerufen einmal beim Bauen (siehe Dockerfile). Der Stand kommt aus dem
Bauargument AVEFI_SCHEMA_REF: ein Zweig, ein Tag oder ein Commit von
github.com/AV-EFI/av-efi-schema. Voreinstellung ist `main`.

Warum nicht einfach `get_schema_validator()` wie bis zum 10.11.2026: Das holt
immer `main`, und welcher Stand das gerade war, stand nirgends. Am 26.10.2026
aenderte sich mit LinkML 1.12 die Wurzel des Schemas; ein am 04.11. gebautes
Abbild lehnte daraufhin jeden Datensatz ab (#45), ein fuenf Wochen aelteres
nicht — und beide meldeten dieselbe Schemaversion, weil sie nur eine Adresse
war. Jetzt wird der Zweig beim Bauen auf einen Commit aufgeloest, das Schema
von genau diesem Commit geholt und die Herkunft neben dem Schema abgelegt.

Die Aufloesung ueber die GitHub-API darf scheitern (etwa am Abfragelimit ohne
Anmeldung). Dann wird ueber den Namen geholt und der Commit bleibt unbekannt;
der Bau bricht deshalb nicht ab. Scheitert dagegen das Holen des Schemas
selbst, bricht er ab: Ein Abbild ohne Schema prueft nichts.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.request

from efi_conv.core import check

REPO = "AV-EFI/av-efi-schema"
PFAD = "project/jsonschema/avefi_schema/model.schema.json"
AGENT = "avefi-importer-build (+https://github.com/AV-EFI/avefi-importer)"

#: Neben dem Schema: von welchem Stand es stammt. Liest service.schema_info().
HERKUNFT = pathlib.Path(str(check.SCHEMA_FILE)).with_name("avefi_schema.herkunft.json")


def _holen(url: str, accept: str) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": AGENT})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def commit_zu(ref: str) -> str | None:
    """Zweig, Tag oder Commit auf den vollen Commit aufloesen; None, wenn es nicht geht."""
    try:
        sha = _holen(
            f"https://api.github.com/repos/{REPO}/commits/{ref}",
            "application/vnd.github.sha",
        ).decode("ascii").strip()
    except Exception as e:  # pragma: no cover - Netz beim Bauen
        print(f"Hinweis: {ref} liess sich nicht auf einen Commit aufloesen ({e}).", file=sys.stderr)
        return None
    return sha if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha) else None


def main() -> None:
    ref = (os.environ.get("AVEFI_SCHEMA_REF") or "main").strip()
    commit = commit_zu(ref)
    quelle = f"https://raw.githubusercontent.com/{REPO}/{commit or ref}/{PFAD}"
    schema = json.loads(_holen(quelle, "application/json"))

    pathlib.Path(str(check.SCHEMA_FILE)).parent.mkdir(parents=True, exist_ok=True)
    schreiben = getattr(check, "write_schema_cache", None)
    if schreiben is not None:
        schreiben(schema)
    else:  # aeltere efi-conv-Staende (EFI_CONV_REF) kennen die Funktion nicht
        pathlib.Path(str(check.SCHEMA_FILE)).write_text(json.dumps(schema), encoding="utf-8")
    HERKUNFT.write_text(
        json.dumps({"ref": ref, "commit": commit, "quelle": quelle}, ensure_ascii=False),
        encoding="utf-8",
    )
    # Laesst sich das Schema ueberhaupt als Validator laden? Sonst lieber hier
    # scheitern als beim ersten Import.
    check.get_schema_validator()
    print(f"AVefi-Schema {ref} -> {commit or 'Commit unbekannt'}")


if __name__ == "__main__":
    main()
