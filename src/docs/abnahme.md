# Wegweiser zur Abnahme

Diese Seite sagt zu jedem Punkt der Abnahme-Checkliste, wo er liegt, wie er
sich prüfen lässt und wer als Nächstes dran ist. Sie folgt der Gliederung der
Checkliste im Pad vom 01.09.2026 und enthält selbst nichts Neues.

**Stand: 30.09.2026**, `main` auf `3a10897` oder später, live auf
`https://avefiimporter.goo1.de`. Wer eine Angabe hier nicht bestätigt findet,
hat einen Fehler in dieser Seite gefunden und nicht in der Anwendung. Bitte
melden.

## Kurz gesagt

* **Leistungspaket A** ist abgenommen. Der Pull Request AV-EFI/efi-conv#34 ist
  am 28.09. gemergt.
* **Leistungspaket B**: Alle Frontend-/UX-Punkte sind aus unserer Sicht
  umgesetzt; #10 wartet auf Stefans Nachprüfung, #11 auf den menschlichen
  Nachtest. Die technische Abnahme (Elias) steht aus.
* **Eine Frage an die TIB entscheidet die technische Abnahme mit:** Welche
  Datei ist der vereinbarte Testdatensatz? Mit der Originaldatei lehnt
  `efi-conv check` ab, mit der bereinigten Kopie besteht sie. Siehe
  [Nutzertest und Testdatensatz](#nutzertest-und-testdatensatz).

## Liefergegenstände

| Liefergegenstand | Wo | Stand |
|---|---|---|
| Vollständiger Quellcode | `github.com/AV-EFI/avefi-importer`, Zweig `main` | liegt vor, am 10.09. an AV-EFI übertragen |
| Pull Request für das LIDO-Modul | [AV-EFI/efi-conv#34](https://github.com/AV-EFI/efi-conv/pull/34) | am 28.09. gemergt |
| Eigenständiges Repository für den CSV-Importer | dasselbe Repository | liegt vor |
| Abhängigkeits- und Lock-Dateien | `src/package.json`, `src/package-lock.json` | liegt vor |
| Mockup für das Importer-UI | die laufende Anwendung; der PHP-Prototyp liegt unter dem Tag `php-final` | liegt vor |
| Automatisierte Tests der zentralen Funktionen | `src/tests/`, Aufruf `npm test`; der Prüfdienst hat eigene Tests in `src/efi-conv/test_service.py` | 627 Tests grün, dazu 12 im Prüfdienst |
| Dokumentierte Installation, Initialisierung, Start, Bau und Tests | [`deployment.md`](deployment.md), Abschnitte „Installation und Start“ bis „Tests“; [Handbuch, Installation](handbuch/01-installation.md) | liegt vor |
| Beispielkonfiguration ohne Zugangsdaten | [`../.env.example`](../.env.example) | liegt vor, kein echter Wert |
| Dokumentation des Mappingprofil-Formats | [`mapping-profile.md`](mapping-profile.md) | liegt vor |
| Dokumentation der Umgebungsvariablen | [`deployment.md`](deployment.md), Abschnitt „Umgebungsvariablen“ | liegt vor, gegen `process.env` im Code abgeglichen |
| Bekannte Einschränkungen und getroffene Annahmen | [`README.md`](../../README.md), Abschnitt „Bekannte Einschraenkungen und getroffene Annahmen“; [`CHANGELOG.md`](../../CHANGELOG.md), je Runde „Offen geblieben“ | liegt vor |
| Kurze Beschreibung der Komponenten- und API-Struktur | [`architecture.md`](architecture.md) | liegt vor, mit Endpunktverzeichnis |
| Reproduzierbar deploybare Anwendung | `src/Dockerfile`, `src/docker-compose.local.yml` (eigenständig), `src/docker-compose.dev.yml` (Demo), [`deployment.md`](deployment.md) | liegt vor |

Im Pad sind fünf dieser Zeilen noch offen (Installation, Umgebungsvariablen,
Einschränkungen, Komponenten/API, Deployment). Die Unterlagen liegen vor; offen
ist die Prüfung durch Elias, siehe unten.

Vor einem Produktivstart müssen `SESSION_SECRET` und `DB_PASS` eigene Werte
bekommen. Die Anwendung prüft das beim Start selbst (#19) und nennt die Stelle
in [`deployment.md`](deployment.md), Abschnitt „Vor dem ersten Produktivstart“.

## Frontend und UX (Stefan Stretz)

| Punkt der Checkliste | Stand | Nachweis |
|---|---|---|
| Vue 3, TypeScript | erfüllt | `npm run typecheck` ohne Befund |
| Trennung von UI, Mappinglogik und API | erfüllt | #9 am 29.09. von Stefan geschlossen; der Rest (Editor-Endpunkt ohne `useApi()`) in `3007aa5` behoben, Wächter in `tests/frontend/abfragen.test.ts` |
| Konfiguration, spätere Integration | erfüllt | API-Basis über `runtimeConfig.public.apiBase`, jetzt auch im Zuordnungseditor |
| Austauschbarkeit, CSS, Theme, Doku | erfüllt | #8, #13, [`architecture.md`](architecture.md), [`frontend-pruefen.md`](frontend-pruefen.md) |
| Upload und Mapping, Feldsuche, Mappingprofil, Werk → Manifestation → Exemplar, Validität, Beanstandungen, Terminologie | erfüllt | im Pad abgehakt |
| Deutsch und Englisch im Kernablauf (B.8) | umgesetzt, **Nachprüfung durch Stefan offen** | #10: alle vier Punkte vom 29.09. in `e157c7e`; Wächter `tests/pruefung/berichtscodes.test.ts` und `tests/frontend/meldungstext.test.ts` |
| Barrierefreiheit (WCAG 2.2 AA) | automatisiert bestanden, **menschlicher Nachtest offen** | #11; Lauf vom 23.09. in beiden Farbschemata, `383fd35` |

Zu Mattis Frage im Pad unter Test 2 („schon übertragbar in Abhak-Liste?“): Ja.
Sein Punkt zum Prüfbericht, eine Beanstandung soll direkt zum Datensatz führen,
ist umgesetzt: Die Zeilenangabe ist ein Link auf den erzeugten Datensatz, die
Quellspalte ein Link in die Zuordnung. Umbenennen, Sortieren und Filtern sowie
kontextsensitive Hilfe sind nachgelagert (#1, #2, #3). „Fassung“ heißt jetzt
„Manifestation“, und statt „die Auswahl gehört einem Menschen“ steht eine
Handlungsaufforderung.

Jaspers Punkte vom 01.09. sind ebenfalls umgesetzt: „Zuordnungsprofile“ und
„Mein Nutzerprofil“ heißen so, und „Zuordnung ansehen“ zeigt die verwendete
Profilversion (#6, #17).

## Leistungspaket A (Elias Oltmanns)

Abgenommen. Alle sieben Kriterien sind im Pad abgehakt, der Pull Request ist am
28.09. gemergt. Die Düsseldorfer Kleinigkeiten, die mit den gelieferten Daten
zusammenhängen (etwa m statt cm bei der Länge), klärt Elias mit Düsseldorf.

## Leistungspaket B, technische Abnahme (Elias Oltmanns)

1. **Installieren, initialisieren, starten, bauen, testen nach Dokumentation.**
   [`deployment.md`](deployment.md). Das Datenbankschema legt die Anwendung beim
   Start selbst an und bricht ab, statt mit altem Schema hochzukommen.
2. **Den vereinbarten Testdatensatz vollständig verarbeiten.** Beide
   Paderborner Dateien laufen ohne Abbruch durch.
3. **Das erzeugte AVefi-JSON besteht `efi-conv check`.** Hängt von der Datei
   ab, siehe nächster Abschnitt.
4. **Ein exportiertes Mappingprofil lässt sich wieder einlesen.** Export über
   `GET /api/mappings/:id/export`, Einlesen über die Profilliste;
   [`mapping-profile.md`](mapping-profile.md), Abschnitt „Export und
   Wiedereinlesen“.
5. **Derselbe Testdatensatz mit demselben Profil ergibt semantisch identisches
   JSON.** Nachgewiesen am 30.09., siehe nächster Abschnitt. Was dafür
   festgehalten wird, steht je Import in `run_config`: Profilversion,
   Profilformat- und Schemaversion, Normdateneinstellungen und das einmal
   erkannte Trennzeichen.

### Was die Prüfung in der Anwendung prüft

Seit `d697ae3` prüft der Dienst in der Anwendung dasselbe wie `efi-conv check`,
und zwar in der Fassung nach dem Merge von #34. Bis dahin liefen die
Zusatzregeln von efi-conv (Datum, Zeitraum, Feldlängen, leere Namen,
Titeltyp, aufgegebenes Exemplar ohne PID) im Dienst nie, und die Schemaprüfung
fand nichts, weil die Wurzel des JSON-Schemas für einen Satz nichts festlegt.
efi-conv prüft in Wahrheit beim Laden als Pydantic-Modell; genau das macht der
Dienst jetzt auch. Den leeren Schemaschritt in efi-conv selbst habe ich in
AV-EFI/efi-conv#39 beschrieben.

## Nutzertest und Testdatensatz

Der Vertrag verlangt zwei Testpersonen. Beide sind im Pad abgehakt: Luca Wollny
(SDK) und Matti Stöhr (TIB). Sabrina Klewitz (Filmmuseum Potsdam) hat
zusätzlich mit einem eigenen Datensatz getestet; ihre Rückmeldungen sind
umgesetzt oder als Issue festgehalten (#24, #25).

Offen ist die letzte Zeile: „Beide erzeugten JSON-Dateien sind semantisch
identisch und bestehen `efi-conv check`.“ Im Pad steht sie unter Testperson 3,
laut Vertrag gehört sie zu Testperson 1 und 2.

**Nachweis vom 30.09.2026**, mit Profil 8 („Test Matti auf Basis - Test Luca
31.08.“, Version 72), jede Datei zweimal umgewandelt und mit `efi-conv check`
(efi-conv `5de9501`) geprüft:

| Datei | Zeilen | Knoten | zwei Läufe identisch | `efi-conv check` |
|---|---|---|---|---|
| `UPB_Archivliste_Lehrfilme_Auswahl_AVefi_2026-08-04.csv` (Original) | 77 | 231 | ja | **abgelehnt:** `Identifier is not unique: avefi:LocalResource.3000040K` |
| `neu_UPB_Archiv_Test_Kopie.csv` (bereinigt) | 75 | 225 | ja | bestanden, 225 Datensätze |

Die Ablehnung liegt an den Daten: Die Zeilen 61/62 und 65/66 der
Originaldatei tragen dieselbe Signatur, und die Signatur ist auf die
Exemplarkennung gemappt. Die Anwendung meldet das als Beanstandung mit
Zeilennummern, statt die Kennung still eindeutig zu machen. Wie mit Elias am
03.09. besprochen, ist das Aufgabe des liefernden Hauses. Die Prüfung in der
Anwendung kommt zum selben Ergebnis wie die Kommandozeile: vier Befunde
„Kennung nicht eindeutig“ im Original, keiner in der Kopie.

Die beiden Läufe liefen ohne Normdatenabfrage, damit das Ergebnis nicht von
einem externen Dienst abhängt. Mit Normdaten kommen die GND-Kennungen aus dem
Zwischenspeicher dazu.

**Frage an die TIB:** Welche der beiden Dateien ist der vereinbarte
Testdatensatz? Mit der bereinigten Kopie sind Schritt 3 und 5 erfüllt. Mit dem
Original bräuchte es eine Entscheidung zu den doppelten Signaturen, entweder in
der Datei oder in der Zuordnung.

### Profil 8 war vom 23.09. bis 30.09. beschädigt

Beim Nachtest zu #5 wurde am 23.09. eine Kopie der Paderborner Datei mit
geklammerten Titeln hochgeladen. Die Kopfzeile war dieselbe, also griff Profil 8,
und der Vorschlag „als Archivtitel übernehmen“ wurde angenommen (Version 71).
Auf die Originaldatei angewandt wurde damit jeder Haupttitel leer, und efi-conv
ließ kein Werk mehr zu.

Die Ursache im Code ist behoben (`3a10897`): Der Schritt schneidet die Klammern
jetzt ab, statt den Inhalt herauszulösen, und lässt Titel ohne Klammern stehen.
Profil 8 ist auf den Inhalt von Version 70 zurückgesetzt, als neue Version 72.
Version 71 bleibt im Verlauf. Wer zwischen dem 23.09. und dem 30.09. mit
Profil 8 umgewandelt hat, sollte das wiederholen.

Lehre daraus für weitere Tests: Eine Variante einer Datei mit gleicher
Kopfzeile landet immer beim selben Profil. Wer eine Variante ausprobieren will,
ohne das Abnahmeprofil zu ändern, legt vorher ein eigenes Profil an oder
ändert die Kopfzeile.

## Wer ist dran

| Wer | Was |
|---|---|
| Elias | technische Abnahme LP B (Schritte 1–5); menschlicher Nachtest Barrierefreiheit (#11); #20 (Werkart als Warnung); #24 (`described_by`); AV-EFI/efi-conv#39 |
| Stefan | Nachprüfung #10 |
| TIB | welche Datei der vereinbarte Testdatensatz ist |
| Testende | zwei Importe stehen noch in der Formatprüfung, also ohne Zuordnung: `UPB_Test_Archivtitel_NeuesProfil2…` vom 24.09. und `MDW_Export_Avefi_Test_1.xlsx` vom 28.09. (beide über das gemeinsame Admin-Konto). Falls dort jemand hängen geblieben ist, bitte melden |
| nachgelagert | #22 (erstes Passwort wechseln), #25 (Ordnungsform des Titels) |
| wir | nichts Blockierendes |
