"""
Validierungsdienst auf Basis von efi-conv.

Der Vertrag verlangt Pruefung „mit efi-conv check oder unter direkter Nutzung
derselben Validierungslogik". Dieser Dienst nutzt denselben Schema-Validator
(get_schema_validator) und dieselben Zusatzregeln wie efi-conv check.

Ein Unterschied ist beabsichtigt: efi-conv check bricht beim ersten Schemafehler
ab (pass_checks ruft `raise error`). Ein Importer muss alle Fehler auf einmal
zeigen koennen, deshalb wird hier ueber iter_errors gesammelt statt geworfen.
Fuer den Abnahmenachweis gibt es zusaetzlich /check-cli, das die echte
Kommandozeile unveraendert ausfuehrt.

Was efi-conv check wirklich prueft (Stand 30.09.2026): Die Wurzel des
AVefi-JSON-Schemas legt fuer einen einzelnen Satz nichts fest, iter_errors
findet dort also nichts — hier wie upstream. Die eigentliche Pruefung ist, dass
efi-conv die Datei als Pydantic-Modell laedt (`avefi.load`), und danach
`has_invalid_value`. Beides spiegelt `_zusatzregeln`.
"""
from __future__ import annotations

import json
import logging
import pathlib
import subprocess
import tempfile
from collections import defaultdict
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, ValidationError

from efi_conv.core import check as efi_check

log = logging.getLogger("efi-conv-service")
app = FastAPI(title="efi-conv validation service", version="1.0")

_validator = None


def validator():
    global _validator
    if _validator is None:
        _validator = efi_check.get_schema_validator()
    return _validator


def schema_info() -> dict[str, Any]:
    """Welches Schema wurde geladen — fuer Reproduzierbarkeit im Pruefbericht."""
    info: dict[str, Any] = {
        "source": getattr(efi_check, "SCHEMA_SOURCE", None),
        "file": str(getattr(efi_check, "SCHEMA_FILE", "")),
        "version": None,
        "sha256": None,
    }
    try:
        p = pathlib.Path(str(efi_check.SCHEMA_FILE))
        if p.exists():
            import hashlib

            raw = p.read_bytes()
            info["sha256"] = hashlib.sha256(raw).hexdigest()[:16]
            doc = json.loads(raw)
            info["version"] = doc.get("version") or doc.get("$id")
    except Exception as e:  # pragma: no cover
        log.warning("Schemainfo nicht lesbar: %s", e)
    return info


class CheckRequest(BaseModel):
    """records ist eine Liste von AVefi-Datensaetzen als einfache Objekte."""

    records: list[dict[str, Any]]
    # Laufende Nummer -> Quellzeile, damit Fehler auf die Tabellenzeile zeigen
    row_map: dict[str, int] | None = None


class CrossRequest(BaseModel):
    """
    Die satzuebergreifende Pruefung, fuer den GESAMTEN Bestand auf einmal.

    Kennungen und Verweise gelten ueber die ganze Lieferung. Solange sie je
    Buendel geprueft wurden, meldete der Dienst Verweise als "zeigt ins Leere",
    deren Ziel nur im vorigen Buendel lag, und uebersah doppelte Kennungen, die
    weit auseinander standen.

    Geschickt wird deshalb eine reduzierte Sicht: category, has_identifier und
    die Verweisfelder. Das passt auch bei zehntausend Saetzen in eine Anfrage,
    waehrend die vollstaendigen Saetze zweistellige Megabyte waeren.
    """

    records: list[dict[str, Any]]
    row_map: dict[str, int] | None = None


class Issue(BaseModel):
    severity: str
    message: str
    record: int | None = None
    row: int | None = None
    targetField: str | None = None
    value: str | None = None
    code: str | None = None
    # Bausteine fuer den Satz in der Sprache der Oberflaeche
    params: dict[str, Any] | None = None
    # Wortlaut des Pruefwerkzeugs (jsonschema, efi-conv), unuebersetzt
    detail: str | None = None


def _id_key(ident: Any) -> str | None:
    """Der Schluessel, unter dem efi-conv eine Kennung fuehrt: Kategorie plus Wert."""
    if not isinstance(ident, dict):
        return None
    cat = str(ident.get("category") or "").strip()
    val = str(ident.get("id") or ident.get("has_identifier_value") or "").strip()
    if not val:
        return None
    return f"{cat}.{val}" if cat else val


def _refs(rec: dict[str, Any]) -> list[str]:
    """Verweise eines Satzes auf andere Saetze derselben Lieferung."""
    out: list[str] = []
    for field in ("is_manifestation_of", "is_item_of", "is_variant_of", "is_derived_from"):
        v = rec.get(field)
        for item in v if isinstance(v, list) else [v] if v else []:
            k = _id_key(item) if isinstance(item, dict) else (str(item) if item else None)
            if k:
                out.append(k)
    return out


def _short(v: Any, limit: int = 120) -> str | None:
    if v is None:
        return None
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _path(err) -> str | None:
    parts = [str(p) for p in getattr(err, "absolute_path", [])]
    return ".".join(parts) if parts else None


def _liste(values: Any, limit: int = 8) -> str:
    """Eine Werteliste fuer den Satz, bei langen Listen gekuerzt."""
    if not isinstance(values, (list, tuple)):
        return _short(values, 60) or ""
    shown = [str(v) for v in values[:limit]]
    rest = len(values) - len(shown)
    return ", ".join(shown) + (f" … (+{rest})" if rest > 0 else "")


def _schema_params(err) -> dict[str, Any]:
    """
    Bausteine eines Schemafehlers, damit die Oberflaeche ihn in ihrer Sprache
    sagen kann.

    Der Wortlaut von jsonschema ist englisch („'x' is not one of [...]"). Bis
    zum 30.09.2026 stand er unveraendert in der deutschen Oberflaeche — das
    Spiegelbild von #10. Die Art der Verletzung (`kind`) waehlt den Satz, die
    uebrigen Bausteine fuellen ihn. Den Originaltext traegt `detail`.
    """
    kind = str(getattr(err, "validator", "") or "")
    vv = getattr(err, "validator_value", None)
    inst = getattr(err, "instance", None)
    p: dict[str, Any] = {"kind": kind, "field": _path(err) or ""}
    if kind == "required":
        fehlt = [x for x in (vv or []) if isinstance(inst, dict) and x not in inst]
        p["missing"] = ", ".join(str(x) for x in fehlt)
    elif kind == "enum":
        p["value"] = _short(inst, 60) or ""
        p["allowed"] = _liste(vv)
    elif kind == "const":
        p["value"] = _short(inst, 60) or ""
        p["expected"] = _short(vv, 60) or ""
    elif kind == "type":
        p["value"] = _short(inst, 60) or ""
        p["expected"] = vv if isinstance(vv, str) else _liste(vv)
    elif kind in ("pattern", "format"):
        p["value"] = _short(inst, 60) or ""
        p["expected"] = str(vv)
    elif kind == "additionalProperties":
        bekannt = set((getattr(err, "schema", None) or {}).get("properties", {}) or {})
        extra = sorted(k for k in (inst or {}) if k not in bekannt) if isinstance(inst, dict) else []
        p["extra"] = ", ".join(extra)
    elif kind in ("minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"):
        p["value"] = _short(inst, 60) or ""
        p["limit"] = vv
    else:
        p["value"] = _short(inst, 60) or ""
    return p


class _Mitschrift(logging.Handler):
    """Faengt die Saetze auf, mit denen efi-conv eine Regelverletzung begruendet."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(record.getMessage())


# Welche Regel aus has_invalid_value gegriffen hat, sagt nur ihr Logsatz.
# Die Reihenfolge zaehlt: Der erste Treffer bestimmt den Code.
_REGELARTEN: tuple[tuple[str, str], ...] = (
    ("invalid period", "rule_period"),
    ("has_date", "rule_date"),
    ("characters on", "rule_field_limit"),
    ("Empty has_name", "rule_empty_name"),
    ("Primary title type", "rule_title_type"),
    ("has_access_status=Removed", "rule_removed_without_pid"),
)


def _ohne_zweige(loc: tuple[Any, ...]) -> tuple[str, list[str]]:
    """
    Pfad eines Modellfehlers ohne die Zweige der Vereinigungstypen.

    Pydantic nennt im Pfad auch, welchen Zweig es gerade versucht hat:
    `('avefi:WorkVariant', 'has_identifier', 0, 'AVefiResource', 'id')`.
    Feldnamen sind klein geschrieben, Zweige (Klassen und Kategorien) nicht.
    """
    zweige = [str(x) for x in loc if isinstance(x, str) and (x.startswith("avefi:") or x[:1].isupper())]
    feld = ".".join(str(x) for x in loc if str(x) not in zweige)
    return feld, zweige


def _modellfehler(e: ValidationError) -> list[dict[str, Any]]:
    """
    Der Satz besteht das JSON-Schema, laesst sich aber nicht als Modell laden.

    Die Schemapruefung oben findet nichts: Die Wurzel des AVefi-JSON-Schemas
    ist `{type: object, $defs: …}` und legt fuer einen einzelnen Satz nichts
    fest. In efi-conv check ist es genauso; dort prueft in Wahrheit
    `avefi.load`, das die Datei als Pydantic-Modell laedt und an einem
    ungueltigen Satz abbricht, bevor irgendeine Regel laeuft. Das wird hier
    gespiegelt: Jeder Ladefehler ist ein Fehler, denn an ihm scheitert die
    Abnahmepruefung.

    Bei Vereinigungstypen (etwa den Kennungsarten) meldet Pydantic jeden
    Zweig, der nicht passt. Solche Zweigmeldungen (`literal_error` in einem
    Zweig) fallen weg, wenn es fuer denselben Satz eine echte Meldung gibt;
    gleiche Meldungen am selben Feld stehen nur einmal da.
    """
    roh = e.errors()
    echte = [
        err for err in roh
        if not (err.get("type") == "literal_error" and _ohne_zweige(err.get("loc", ()))[1][1:])
    ] or roh
    out: list[dict[str, Any]] = []
    gesehen: set[tuple[str, str]] = set()
    for err in echte:
        feld, _ = _ohne_zweige(err.get("loc", ()))
        art = str(err.get("type", ""))
        if (art, feld) in gesehen:
            continue
        gesehen.add((art, feld))
        ctx = err.get("ctx") or {}
        erwartet = str(ctx.get("expected") or ctx.get("expected_tags") or "")
        out.append({
            "severity": "error",
            "code": "model_invalid",
            "message": f"efi-conv kann den Datensatz nicht laden: {feld or 'Datensatz'} ({art}).",
            "detail": str(err.get("msg", ""))[:300],
            "targetField": feld or None,
            "params": {
                "kind": art,
                "field": feld,
                "value": "" if art == "missing" else (_short(err.get("input"), 60) or ""),
                "expected": erwartet if len(erwartet) <= 200 else erwartet[:199] + "…",
            },
        })
        if len(out) >= 10:
            break
    return out


def _zusatzregeln(rec: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Die Regeln, die efi-conv check ueber das Schema hinaus anwendet.

    efi-conv ruft dafuer `has_invalid_value` am geladenen Modell auf; darin
    stecken auch Datums- und Laengenpruefung. Bis zum 30.09.2026 bekamen die
    Regeln hier ein `dict`, warfen bei JEDEM Satz `AttributeError`, und ein
    `except Exception: pass` mit dem Kommentar „kein Fehler des Datensatzes"
    verschluckte das. Die Regeln liefen also nie, und ein umgekehrter Zeitraum
    wie `1990/1980` galt hier als gueltig, waehrend efi-conv check ihn ablehnt.

    Jetzt wird der Satz geladen wie in efi-conv (`avefi.loads`). Geht das nicht
    oder wirft die Regel, wird das gemeldet — als Warnung, weil es eine Luecke
    der Pruefung ist und nicht ein Befund am Datensatz. Stillschweigen gibt es
    nicht mehr.
    """
    from efi_conv.core import avefi  # erst hier: braucht das installierte Schema

    try:
        model = avefi.loads(json.dumps(rec))[0]
    except ValidationError as e:
        return _modellfehler(e)
    except Exception as e:
        return [{
            "severity": "warning",
            "code": "rules_unavailable",
            "message": "Die Zusatzregeln von efi-conv liessen sich auf diesen Datensatz nicht anwenden.",
            "detail": f"{type(e).__name__}: {e}"[:300],
        }]

    mitschrift = _Mitschrift()
    efi_logger = logging.getLogger("efi_conv")
    efi_logger.addHandler(mitschrift)
    try:
        verletzt = efi_check.has_invalid_value(model)
    except Exception as e:
        return [{
            "severity": "warning",
            "code": "rules_unavailable",
            "message": "Die Zusatzregeln von efi-conv liessen sich auf diesen Datensatz nicht anwenden.",
            "detail": f"{type(e).__name__}: {e}"[:300],
        }]
    finally:
        efi_logger.removeHandler(mitschrift)

    if not verletzt:
        return []
    detail = " ".join(mitschrift.lines).strip()
    code = next((c for needle, c in _REGELARTEN if needle in detail), "rule_invalid_value")
    return [{
        "severity": "error",
        "code": code,
        "message": "Der Datensatz verletzt eine Regel von efi-conv check.",
        "detail": detail[:500] or None,
    }]


@app.get("/health")
def health():
    return {"ok": True, "schema": schema_info()}


def _stelle(row_map: dict[str, int], i: int) -> int | None:
    """
    Quellzeile zum Satz mit dem Index `i` (0-basiert).

    Die Zuordnung zaehlt ab 1 (`convert.ts`: `pendingNodes.length + 1`). Bis zum
    30.09.2026 stand hier `row_map.get(str(i)) or row_map.get(str(i + 1))`,
    „0- wie 1-basiert nachgeschlagen". Bei einer 1-basierten Zuordnung trifft
    aber schon der erste Versuch — den Eintrag des VORIGEN Satzes. Weil Werk,
    Manifestation und Exemplar einer Zeile hintereinander stehen, fiel das nur
    beim ersten Knoten einer Zeile auf, meist dem Werk: Dessen Befunde nannten
    die Zeile davor.
    """
    return row_map.get(str(i + 1))


def _zeilenwort(row_map: dict[str, int], nummern: list[int]) -> str:
    """
    Andere Fundstellen benennen — nach Moeglichkeit als Zeile der Quelldatei.

    Die laufende Nummer des Pruefsatzes ist nicht die Datensatznummer der
    Oberflaeche: Je Zeile entstehen ein Werk, eine Manifestation und ein
    Exemplar. "Datensatz 162" war deshalb eine Angabe, die im Importer auf
    nichts zeigte. Wo die Zeile bekannt ist, wird sie genannt.
    """
    zeilen = [_stelle(row_map, n - 1) for n in nummern]
    if zeilen and all(z is not None for z in zeilen):
        eindeutig = sorted({int(z) for z in zeilen if z is not None})
        wort = "Zeile" if len(eindeutig) == 1 else "den Zeilen"
        return f"{wort} {', '.join(str(z) for z in eindeutig)}"
    wort = "Pruefsatz" if len(nummern) == 1 else "den Pruefsaetzen"
    return f"{wort} {', '.join(str(n) for n in nummern)}"


def _stellen(row_map: dict[str, int], nummern: list[int]) -> dict[str, Any]:
    """
    Dieselbe Auskunft wie _zeilenwort, aber als Bausteine fuer die Oberflaeche:
    `kind` sagt, ob Zeilen oder Pruefsaetze gemeint sind, `n` ihre Zahl (fuer
    Einzahl und Mehrzahl), `stellen` die Liste.
    """
    zeilen = [_stelle(row_map, n - 1) for n in nummern]
    if zeilen and all(z is not None for z in zeilen):
        eindeutig = sorted({int(z) for z in zeilen if z is not None})
        return {"kind": "rows", "n": len(eindeutig), "stellen": ", ".join(str(z) for z in eindeutig)}
    return {"kind": "records", "n": len(nummern), "stellen": ", ".join(str(n) for n in nummern)}


def _satzuebergreifend(records: list[dict[str, Any]], row_map: dict[str, int]) -> list[dict[str, Any]]:
    """
    Die drei Regeln, die den ganzen Bestand brauchen.

    efi-conv check prueft in pass_checks nicht nur jeden Satz fuer sich, sondern
    auch Eindeutigkeit der Kennungen, aufloesbare Verweise und ob zu jeder
    Manifestation ein Exemplar gehoert. Ohne sie meldet der Dienst "in Ordnung",
    waehrend die Kommandozeile denselben Bestand ablehnt.

    Aufgerufen wird das ueber /crossref mit ALLEN Saetzen, nie je Buendel: Die
    Regeln sind nur ueber die vollstaendige Lieferung richtig. Solange sie in
    /check steckten und /check gebuendelt aufgerufen wurde, meldete der Dienst
    Verweise als "zeigt ins Leere", deren Ziel im vorigen Buendel lag.
    """
    issues: list[dict[str, Any]] = []
    id_owners: dict[str, list[int]] = defaultdict(list)
    referenced: dict[str, list[int]] = defaultdict(list)
    own_ids: dict[int, list[str]] = {}

    for i, rec in enumerate(records):
        n = i + 1
        ids = [_id_key(x) for x in (rec.get("has_identifier") or [])]
        own_ids[n] = [x for x in ids if x]
        for key in own_ids[n]:
            id_owners[key].append(n)
        for ref in _refs(rec):
            referenced[ref].append(n)

    known_ids = set(id_owners)

    for i, rec in enumerate(records):
        n = i + 1
        row = _stelle(row_map, i)

        # Kennung doppelt vergeben — efi-conv: "Identifier is not unique"
        for key in own_ids.get(n, []):
            others = [o for o in id_owners[key] if o != n]
            if others:
                issues.append({
                    "severity": "error",
                    "message": (
                        f"Kennung {key} ist nicht eindeutig, sie kommt auch in "
                        f"{_zeilenwort(row_map, others)} vor."
                    ),
                    "params": _stellen(row_map, others) | {"key": key},
                    "record": n, "row": row,
                    "targetField": "has_identifier", "value": key,
                    "code": "identifier_not_unique",
                })

        # Verweis zeigt ins Leere — efi-conv: "dangling record"
        for ref in _refs(rec):
            if ref not in known_ids:
                issues.append({
                    "severity": "error",
                    "message": f"Der Verweis {ref} zeigt auf keinen Datensatz dieser Lieferung.",
                    "params": {"ref": ref},
                    "record": n, "row": row,
                    "targetField": "is_manifestation_of/is_item_of",
                    "value": ref, "code": "dangling_reference",
                })

        # Knoten ohne zugehoeriges Exemplar — efi-conv: "No items associated with"
        cat = str(rec.get("category") or "")
        if cat.endswith(("Manifestation", "WorkVariant")):
            keys = own_ids.get(n, [])
            if keys and not any(referenced.get(k) for k in keys):
                issues.append({
                    "severity": "error",
                    "message": f"Zu {cat} {keys[0]} gehoert kein Exemplar.",
                    "params": {"category": cat, "key": keys[0]},
                    "record": n, "row": row,
                    "targetField": "has_identifier",
                    "value": keys[0],
                    "code": "no_items_associated",
                })

    return issues


@app.post("/crossref")
def crossref(req: CrossRequest):
    """Die satzuebergreifenden Regeln, in einem Durchgang ueber alles."""
    issues = _satzuebergreifend(req.records, req.row_map or {})
    return {"checked": len(req.records), "issues": issues}


@app.post("/check")
def check(req: CheckRequest):
    """
    Jeden Satz fuer sich pruefen.

    Satzuebergreifendes steht bewusst nicht hier: Diese Aufrufe kommen
    gebuendelt, und eine Regel ueber die ganze Lieferung waere dann nur ueber
    einen Ausschnitt geprueft. Dafuer gibt es /crossref.
    """
    v = validator()
    issues: list[dict[str, Any]] = []
    row_map = req.row_map or {}
    valid_count = 0

    for i, rec in enumerate(req.records):
        n = i + 1
        row = _stelle(row_map, i)
        had_error = False

        # 1. Schemapruefung — derselbe Validator, den efi-conv check benutzt
        for err in v.iter_errors(rec):
            had_error = True
            params = _schema_params(err)
            issues.append(
                {
                    "severity": "error",
                    # Der deutsche Satz ist der Rueckfall, wenn die Oberflaeche
                    # die Art nicht kennt; den Wortlaut des Validators traegt
                    # `detail`, damit das Abnahmewerkzeug erkennbar bleibt.
                    "message": f"Das AVefi-Schema beanstandet {_path(err) or 'den Datensatz'}.",
                    "detail": err.message,
                    "params": params,
                    "record": n,
                    "row": row,
                    "targetField": _path(err),
                    "value": _short(getattr(err, "instance", None)),
                    "code": "schema",
                }
            )

        # 2. Zusatzregeln von efi-conv
        if not rec.get("has_identifier"):
            had_error = True
            issues.append(
                {
                    "severity": "error",
                    "message": "has_identifier fehlt im Datensatz.",
                    "record": n,
                    "row": row,
                    "targetField": "has_identifier",
                    "code": "missing_identifier",
                }
            )
        elif not had_error:
            # Nur an schemagueltigen Saetzen: efi-conv check laedt den Satz als
            # Modell, bevor es die Regeln anwendet, und ein schemaungueltiger
            # Satz laesst sich nicht laden. Sein Schemafehler steht schon da.
            for issue in _zusatzregeln(rec):
                issue.update({"record": n, "row": row})
                issues.append(issue)
                if issue["severity"] == "error":
                    had_error = True

        if not had_error:
            valid_count += 1

    # „valid" zaehlt nur, was DIESER Durchgang beurteilen kann. Die
    # satzuebergreifenden Regeln laufen in /crossref; wer beide Ergebnisse
    # zusammenfuehrt, muss die Zahl dort neu bilden — sonst gilt ein Satz als
    # gueltig, dessen Kennung doppelt vergeben ist.
    return {
        "ok": valid_count == len(req.records),
        "checked": len(req.records),
        "valid": valid_count,
        "issues": issues,
        "schema": schema_info(),
    }


@app.post("/check-cli")
def check_cli(req: CheckRequest):
    """Die echte Kommandozeile auf einer Datei — fuer den Abnahmenachweis."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(req.records, fh, ensure_ascii=False)
        path = fh.name
    try:
        p = subprocess.run(
            ["efi-conv", "check", path], capture_output=True, text=True, timeout=300
        )
        return {
            "ok": p.returncode == 0,
            "exitCode": p.returncode,
            "stdout": p.stdout[-8000:],
            "stderr": p.stderr[-8000:],
            "schema": schema_info(),
        }
    finally:
        pathlib.Path(path).unlink(missing_ok=True)
