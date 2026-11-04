# AVefi Importer — Handbuch

Anleitungen für die Nutzung des AVefi Importers.

> **Stand:** Diese Handreichung stammt aus der PHP-Version. Die Bedienung hat
> sich mit der Neufassung nicht geändert, die technischen Angaben schon.
> **Kapitel 1 (Installation) ist überholt** — für Installation, Start, Bau,
> Tests und Umgebungsvariablen gilt [`src/docs/deployment.md`](../src/docs/deployment.md).
> Kapitel 6 beschreibt eine PID-Registrierung, die es nicht gibt und die nicht
> zum Auftragsumfang gehört.

## Inhalt

1. [Installation & Start](01-installation.md) — Umgebung hochfahren, erster Login
2. [Metadaten importieren](02-importieren.md) — Upload, Upload via URL, Formate, Worker
3. [Datensätze bearbeiten & validieren](03-bearbeiten-und-validieren.md) — Liste, Editor, Schema-Prüfung, Export
4. [Format-Review (Admin)](04-format-review.md) — unbekannte Formate auflösen
5. [Benutzerverwaltung (Admin)](05-benutzerverwaltung.md) — Konten und Institutionen anlegen, sperren, Passwörter
6. [PID-Registrierung](06-pid-registrierung.md) — Konzept & geplanter Ablauf *(noch nicht implementiert)*
7. [Zuordnungen (Mapping-Profile)](07-zuordnungen.md) — CSV/TSV-Spalten dem AVefi-Schema zuordnen

## Kurzüberblick

Der AVefi Importer nimmt Metadaten-Dateien entgegen (**CSV, TSV, XLSX**, dazu XML,
EAD, MARC-XML, JSON), erkennt das Format, konvertiert die Datensätze ins
AVefi-Schema (Werk → Manifestation → Exemplar) und prüft sie mit dem echten
`efi-conv` in einem eigenen Dienst — nicht mit einer nachgebauten Prüfung.
Tabellen laufen dabei über ein **Mappingprofil**, das im Editor entsteht und
beim nächsten Mal anhand der Kopfzeile wiedererkannt wird.

Vertraglich geschuldet sind CSV und XLSX; die übrigen Formate sind Zugabe.
`.xls` und `.ods` werden nicht gelesen.

> Technische Architektur (Pipeline, Converter, Speicherung): siehe
> [`src/docs/architecture.md`](../src/docs/architecture.md).
