"""
Tests fuer den Pruefdienst, im Container mit dem installierten efi-conv:

    docker exec avefi_efi_conv python -m unittest -v test_service

Bewusst mit unittest aus der Standardbibliothek: Das Abbild soll fuer die
Tests nichts nachinstallieren muessen.

Anlass: Bis zum 30.09.2026 liefen die Zusatzregeln von efi-conv hier nie (siehe
_zusatzregeln). Der erste Test ist genau der Fall, der damals durchrutschte.
"""
from __future__ import annotations

import unittest

from service import CheckRequest, CrossRequest, check, crossref


def werk(**extra):
    rec = {
        "category": "avefi:WorkVariant",
        "type": "Monographic",
        "has_primary_title": {"has_name": "Der blaue Engel", "type": "PreferredTitle"},
        "has_identifier": [{"category": "avefi:LocalResource", "id": "w1"}],
    }
    rec.update(extra)
    return rec


def pruefe(*records):
    return check(CheckRequest(records=list(records), row_map={"1": 7}))


class Zusatzregeln(unittest.TestCase):
    def test_umgekehrter_zeitraum_wird_beanstandet(self):
        rec = werk(has_event=[{"category": "avefi:ProductionEvent", "has_date": "1990/1980"}])
        res = pruefe(rec)
        codes = [i["code"] for i in res["issues"]]
        self.assertIn("rule_period", codes)
        issue = next(i for i in res["issues"] if i["code"] == "rule_period")
        self.assertEqual(issue["severity"], "error")
        self.assertIn("1990/1980", issue["detail"])
        self.assertEqual(issue["row"], 7)
        self.assertFalse(res["ok"])

    def test_gueltiger_satz_ohne_befund(self):
        res = pruefe(werk(has_event=[{"category": "avefi:ProductionEvent", "has_date": "1930"}]))
        self.assertEqual(res["issues"], [])
        self.assertTrue(res["ok"])

    def test_aufgegebenes_exemplar_ohne_pid(self):
        item = {
            "category": "avefi:Item",
            "has_access_status": "Removed",
            "has_identifier": [{"category": "avefi:LocalResource", "id": "i1"}],
            "is_item_of": {"category": "avefi:LocalResource", "id": "m1"},
        }
        codes = [i["code"] for i in pruefe(item)["issues"]]
        self.assertIn("rule_removed_without_pid", codes)


class Schemafehler(unittest.TestCase):
    """
    Die Bausteine eines jsonschema-Fehlers.

    Ueber /check laesst sich das nicht ausloesen: Die Wurzel des AVefi-Schemas
    legt fuer einen Satz nichts fest (siehe _modellfehler). Geprueft wird
    deshalb gegen den Teil des Schemas, der zur Kategorie gehoert.
    """

    def fehler(self, rec):
        from service import validator
        v = validator()
        teil = dict(v.schema)
        teil["$ref"] = "#/$defs/WorkVariant"
        return list(type(v)(teil).iter_errors(rec))

    def test_wurzel_des_schemas_legt_nichts_fest(self):
        # Wird das je anders, soll dieser Test es sagen: Dann prueft /check
        # wieder etwas, und die Uebersetzung der Schemafehler wird sichtbar.
        from service import validator
        self.assertEqual(list(validator().iter_errors({"foo": 1})), [])

    def test_bausteine_eines_wertefehlers(self):
        from service import _schema_params
        errs = self.fehler(werk(has_primary_title={"has_name": "X", "type": "Gibtsnicht"}))
        p = next(_schema_params(e) for e in errs if e.validator == "enum")
        self.assertEqual(p["value"], "Gibtsnicht")
        self.assertIn("PreferredTitle", p["allowed"])

    def test_bausteine_einer_pflichtangabe(self):
        from service import _schema_params
        rec = werk()
        del rec["type"]
        p = next(_schema_params(e) for e in self.fehler(rec) if e.validator == "required")
        self.assertEqual(p["missing"], "type")


class Modell(unittest.TestCase):
    """Was efi-conv check beim Laden ablehnt."""

    def modellfehler(self, rec):
        return [i for i in pruefe(rec)["issues"] if i["code"] == "model_invalid"]

    def test_werk_ohne_werkart_ist_ein_fehler(self):
        rec = werk()
        del rec["type"]
        res = pruefe(rec)
        issue = next(i for i in res["issues"] if i["code"] == "model_invalid")
        self.assertEqual(issue["severity"], "error")
        self.assertEqual(issue["params"]["kind"], "missing")
        self.assertEqual(issue["params"]["field"], "type")
        self.assertFalse(res["ok"])

    def test_unzulaessiger_wert_nennt_wert_und_erlaubtes(self):
        (issue,) = self.modellfehler(werk(type="Gibtsnicht"))
        self.assertEqual(issue["params"]["kind"], "enum")
        self.assertEqual(issue["params"]["value"], "Gibtsnicht")
        self.assertIn("Monographic", issue["params"]["expected"])
        self.assertIn("Input should be", issue["detail"])

    def test_feld_das_die_kategorie_nicht_kennt(self):
        (issue,) = self.modellfehler(werk(has_note=["x"]))
        self.assertEqual(issue["params"]["kind"], "extra_forbidden")
        self.assertEqual(issue["params"]["field"], "has_note")

    def test_zweige_der_kennungsarten_erscheinen_nicht(self):
        issues = self.modellfehler(werk(has_identifier=[{"category": "avefi:LocalResource"}]))
        self.assertEqual([(i["params"]["kind"], i["params"]["field"]) for i in issues],
                         [("missing", "has_identifier.0.id")])

    def test_ungueltiger_satz_bekommt_keine_regelwarnung(self):
        codes = [i["code"] for i in pruefe(werk(type="Gibtsnicht"))["issues"]]
        self.assertNotIn("rules_unavailable", codes)


class Querlauf(unittest.TestCase):
    def test_doppelte_kennung_nennt_zeilen_als_bausteine(self):
        a, b = werk(), werk()
        res = crossref(CrossRequest(records=[a, b], row_map={"1": 3, "2": 5}))
        issue = next(i for i in res["issues"] if i["code"] == "identifier_not_unique")
        self.assertEqual(issue["params"]["kind"], "rows")
        self.assertEqual(issue["params"]["n"], 1)
        self.assertEqual(issue["params"]["stellen"], "5")
        # und der eigene Satz nennt seine eigene Zeile, nicht die davor
        self.assertEqual(issue["row"], 3)
        zweite = [i for i in res["issues"] if i["code"] == "identifier_not_unique"][1]
        self.assertEqual(zweite["row"], 5)
        self.assertEqual(zweite["params"]["stellen"], "3")


if __name__ == "__main__":
    unittest.main()
