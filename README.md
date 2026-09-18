# AVefi Importer

Filmmetadaten aus CSV- und XLSX-Dateien ins [AVefi](https://www.av-efi.net)-Schema
uebersetzen: Spalten zuordnen, Ergebnis ansehen, gegen das Schema pruefen,
`avefi.v1.json` ausliefern.

Die Zuordnung entsteht in einem Editor und wird als **Mappingprofil**
gespeichert. Beim naechsten Mal erkennt der Importer dieselbe Kopfzeile wieder
und schlaegt das Profil vor. Geprueft wird mit dem echten `efi-conv` in einem
eigenen Container, nicht mit einer nachgebauten Pruefung.

Diese Version loest die PHP-Version ab; deren letzter Stand liegt im Tag
`php-final`. Stack: Nuxt 4.5, Vue 3.5, TypeScript, Nitro,
PostgreSQL 16, Docker.

**Die Anwendung liegt in [`src/`](src/). Alle Befehle laufen dort.**

## Dokumentation

| Datei | Inhalt |
|---|---|
| [`src/docs/deployment.md`](src/docs/deployment.md) | Installation, Initialisierung, Start, Bau, Tests, Umgebungsvariablen, Container |
| [`src/docs/mapping-profile.md`](src/docs/mapping-profile.md) | Profilformat, jede Konverteroperation mit Beispiel |
| [`src/docs/architecture.md`](src/docs/architecture.md) | Verzeichnisaufbau, Ablauf, alle API-Endpunkte |
| [`src/docs/frontend-pruefen.md`](src/docs/frontend-pruefen.md) | Durchgang zur Pruefung der Oberflaeche von Hand |
| [`src/.env.example`](src/.env.example) | Beispielkonfiguration ohne Zugangsdaten |
| [`src/docs/abnahme.md`](src/docs/abnahme.md) | Wegweiser zur Abnahme: welcher Liefergegenstand wo liegt |
| [`CHANGELOG.md`](CHANGELOG.md) | Was gemeldet wurde, von wem, und was daraus wurde |

## Schnellstart

Voraussetzung: Docker mit Compose-Plugin. Ohne Docker: Node ab 22.19.0
(`package.json`, Feld `engines`) und PostgreSQL 16.

```bash
cd src
cp .env.example .env                     # mindestens DB_PASS und SESSION_SECRET setzen
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps
```

Fuenf Container: `web` (Nuxt, Port 3000), `worker` (Hintergrundprozess),
`efi-conv` (Validierungsdienst), `db` (PostgreSQL 16), `adminer`
(`127.0.0.1:8081`). Der erste Aufbau dauert einige Minuten, im Wesentlichen
wegen des efi-conv-Images.

`db/schema.sql` wird beim ersten Start automatisch geladen. **Ein Anmeldekonto
legt es nicht an**, und ein Skript dafuer gibt es derzeit nicht; das erste Konto
wird von Hand angelegt — der genaue, ausgefuehrte Weg steht in
[`src/docs/deployment.md`](src/docs/deployment.md) unter „Initialisierung".

### Tests

```bash
cd src
docker run --rm -v "$PWD":/app -w /app node:24-alpine npx vitest run
```

Stand: **332 Tests in 24 Dateien, alle erfolgreich.** Keine Datenbank noetig.

### Auslieferungsbau

```bash
cd src
docker build --target production -t avefi-importer:prod .
```

Laeuft durch; das Image startet mit `node .output/server/index.mjs` und
beantwortet `/login` mit HTTP 200. **Achtung:** Im Auslieferungsbetrieb muessen
Datenbank und Sitzungsgeheimnis mit dem Praefix `NUXT_` gesetzt werden
(`NUXT_DB_HOST`, `NUXT_SESSION_SECRET`, …). Nitro uebernimmt zur Laufzeit nur
`NUXT_`-praefigierte Variablen in die `runtimeConfig`; die unpraefigierten
Namen werden beim Bauen gelesen und eingebacken. Einzelheiten und die
vollstaendige Tabelle der Variablen in
[`src/docs/deployment.md`](src/docs/deployment.md).

## Ablauf

```
Upload / URL ──▶ Erkennung ──┬─▶ Kopfzeile bekannt   ──▶ Konvertierung ──▶ Pruefung ──▶ avefi.v1.json
                             ├─▶ mehrere Blaetter    ──▶ Blattwahl
                             └─▶ Kopfzeile unbekannt ──▶ Zuordnung im Editor
```

Die hochgeladene Datei bleibt unveraendert in `<FILES_PATH>/<uuid>/org/` liegen,
damit sich hinterher belegen laesst, was geliefert wurde. Abgeleitetes steht in
`work/`, das Ergebnis in `avefi.v1.json`.

## Pruefung mit efi-conv

Der Vertrag verlangt Pruefung „mit `efi-conv check` oder unter direkter Nutzung
derselben Validierungslogik". Der Container `efi-conv` installiert das echte
Paket per pip aus dem Git-Repository und laedt denselben Schema-Validator, den
`efi-conv check` benutzt. Ueber die Bauargumente `EFI_CONV_REPO` und
`EFI_CONV_REF` laesst sich auf den Stand aus Leistungspaket A oder auf einen
festen Commit zeigen.

Das Schema wird beim Bauen einmal geholt und im Image eingefroren. Sonst laedt
efi-conv es zur Laufzeit vom main-Branch, und keine Konvertierung waere
reproduzierbar.

Zwei Endpunkte:

* `POST /check` sammelt **alle** Befunde. `efi-conv check` bricht beim ersten
  Schemafehler ab; ein Importer muss alle Fehler auf einmal zeigen koennen,
  deshalb laeuft die Pruefung ueber `iter_errors`. Die satzuebergreifenden
  Regeln — Eindeutigkeit der Kennungen, aufloesbare Verweise, Knoten ohne
  Exemplar — sind dieselben wie in der Kommandozeile.
* `POST /check-cli` fuehrt `efi-conv check` unveraendert aus. Fuer den
  Abnahmenachweis.

Ist der Dienst nicht erreichbar, wird die Datei erzeugt, der Bericht sagt aber
ausdruecklich, dass nicht geprueft wurde. Ein „validiert", das niemand geprueft
hat, waere schlimmer als ein offener Befund.

## Bekannte Einschraenkungen und getroffene Annahmen

### `.xls` und `.ods` werden nicht gelesen

Gelesen wird `.xlsx` (und CSV/TSV). Fuer `.xls` (BIFF8, bis Excel 2003) und
`.ods` gibt es in Node keine Bibliothek, die zugleich gepflegt, im
npm-Hauptregistry vorhanden und frei von offenen Sicherheitsmeldungen ist:
`exceljs` (MIT, npm) kann beides nicht, und das einzige Paket, das beides kann
(SheetJS), liegt seit 2023 nicht mehr im npm-Hauptregistry; die dort verbliebene
Version stammt von 2022 und hat zwei ungepatchte Schwachstellen hoher Schwere.

Der Vertrag verlangt CSV und XLSX; beide funktionieren. `.xls` und `.ods` waren
Zugabe. Statt still zu scheitern, sagt der Importer beim Hochladen im Klartext,
was zu tun ist: in Excel oder LibreOffice als `.xlsx` speichern oder das
gewuenschte Blatt als CSV ablegen.

### Doppelte Signaturen in der Paderborner Testdatei

Die Testdatei aus Paderborn (77 Datenzeilen) enthaelt zwei Signaturen doppelt:
`3000040K` in den Dateizeilen 61 und 62, `3000043K` in den Dateizeilen 65 und 66.
Weil die Signatur auf `item.identifier.local` gemappt ist, entstehen zwei
Exemplare mit derselben Kennung, und `efi-conv check` lehnt die Datei ab.

Die Zeilennummern gehen auseinander, je nachdem, womit man zaehlt: Ein
Texteditor zeigt die Zeilen 61/62 und 65/66, die Meldungen von efi-conv sprechen
von den Datensaetzen 54 und 57. Beides stimmt. Ein frueherer Datensatz enthaelt
eine Inhaltsangabe mit Zeilenumbruechen in einem Feld in Anfuehrungszeichen und
belegt dadurch mehrere Dateizeilen. Wer die Datei korrigiert, sucht besser nach
der Signatur als nach der Zeilennummer.

Nachgestellt am erzeugten `avefi.v1.json` (231 Knoten: 77 Werke, 77 Manifestationen,
77 Exemplare):

```
POST /check      2 doppelte Kennungen, gemeldet an 4 Datensaetzen
POST /check-cli  Rueckgabewert 1
                 ERROR Identifier is not unique: avefi:LocalResource.3000040K
                 ERROR Identifier is not unique: avefi:LocalResource.3000043K
                 ERROR No items associated with avefi:Manifestation r54_manifestation
                 ERROR No items associated with avefi:WorkVariant r54_work
                 ERROR No items associated with avefi:Manifestation r57_manifestation
                 ERROR No items associated with avefi:WorkVariant r57_work
                 ERROR Found 6 invalid records (no action taken)
```

Die vier `No items associated`-Meldungen sind Folgefehler: Werden die beiden
Signaturen eindeutig gemacht, meldet dieselbe Kommandozeile
`All 231 records passed the checks successfully` mit Rueckgabewert 0.
`POST /check` nennt also die Ursache, `POST /check-cli` zusaetzlich deren
Auswirkung.

Das war in der PHP-Version genauso. Neu ist, dass der Importer es **meldet**,
statt „validiert" zu behaupten. Zwei Auswege:

* die Signatur in der Quelldatei eindeutig machen (etwa `3000040K-1`,
  `3000040K-2`), wenn es tatsaechlich zwei Exemplare sind; oder
* die Spalte anders mappen — auf `item.note` oder `work.identifier.local` —,
  wenn die beiden Zeilen dasselbe Exemplar beschreiben. Alternativ die
  Zusammenfassung (`grouping`) so einstellen, dass die beiden Zeilen zu einem
  Werk zusammenfallen.

Hinweis zum Stand auf dem Testserver: Die satzuebergreifenden Regeln sind erst
nach den dortigen Konvertierungslaeufen in den Dienst gekommen. Die gespeicherten
Berichte dieser Importe zeigen deshalb noch „0 mit Befund". Ein
`POST /api/imports/:id/reconvert` bringt sie auf den aktuellen Stand.

### Der Testserver laeuft im Entwicklungsmodus

`docker-compose.dev.yml` startet `web` und `worker` mit `npm run dev` und
gemountetem Code, damit Aenderungen ohne neuen Aufbau wirken. Der Auslieferungsweg
(`npm run build`, `npm start`) ist als eigene Stufe im `Dockerfile` enthalten und
ausgefuehrt worden: Der Bau laeuft durch, das Image startet und antwortet. Die
einzige Besonderheit ist die `NUXT_`-Schreibweise der Umgebungsvariablen, siehe
oben und `src/docs/deployment.md`.

### Normdatenanreicherung ist ausgeschaltet

`AUTHORITY_ENABLED` ist standardmaessig aus. Anreicherung ueber GND, Wikidata
und VIAF ist vertraglich nicht geschuldet; sie ist vorhanden, weil sie beim
Mappen hilft, aber sie braucht ausgehende HTTP-Verbindungen und kostet Zeit.
Angereichert wird nie von selbst: Der Importer liefert Kandidaten, ein Mensch
bestaetigt. Bestaetigte Zuordnungen stehen im Profil und schlagen die Automatik.

Wenn angereichert wird, aendert das den Wert nicht — der Name bleibt der Name,
die gefundene ID haengt als `same_as` an der Entitaet. In einer frueheren Version
wurde der Name mit der ID ueberschrieben, sodass bei einem Regie-Feld die
GND-Nummer im Namen stand.

### Nichts wird zwischengespeichert

Die Anwendung setzt fuer alle Seiten `cache-control: no-store, private,
max-age=0, must-revalidate`, dazu `cdn-cache-control`,
`cloudflare-cdn-cache-control` und `vary: cookie`.

Der Grund ist ein aufgetretener Fall: Ein vorgelagerter Zwischenspeicher hat eine
angemeldete Importliste abgelegt und an Aufrufer ohne Sitzung ausgeliefert,
nachweisbar an `cf-cache-status: HIT` auf der Importliste ohne Sitzungscookie.
Jede Seite zeigt Daten einer angemeldeten Institution. Ausgenommen sind nur
Dateien ohne Personenbezug: `/_nuxt/**`, Symbole und `robots.txt`.

Wer einen anderen vorgelagerten Server einsetzt, prueft das nach.

### Weitere Annahmen

* **Eine Zeile ist ein Exemplar.** Das ist die Vorgabe (`row.represents: "item"`)
  und der haeufige Fall bei Archivlisten. Aus einer Zeile entstehen trotzdem
  drei Knoten, weil das AVefi-Schema die Kette Werk → Manifestation → Exemplar
  verlangt; die Verbindung laeuft ueber lokale Kennungen `r<n>_work` und
  `r<n>_manifestation`.
* **Keine Zusammenfassung von Zeilen**, solange `grouping.work.by` leer ist.
  Jede Zeile wird ein eigenes Werk. Wer Manifestationen eines Werks in mehreren Zeilen
  hat, stellt die Zusammenfassung ein.
* **Passwoerter** werden mit argon2id gehasht, mit denselben Vorgaben wie PHPs
  `PASSWORD_ARGON2ID`, damit Bestandskonten sich weiter anmelden koennen. bcrypt
  wird nur noch gelesen, nie geschrieben.
* **Automatische Korrektur von Validierungsfehlern findet nicht statt.** Der
  Importer darf einen Vorschlag anbieten („Konverter `duration` einfuegen?"),
  anwenden muss ihn ein Mensch. Das ist vertraglich so festgelegt.
* **Zusammenfassungsschluessel gelten nur innerhalb eines Imports.** Zwei
  Lieferungen desselben Werks werden nicht zusammengefuehrt.
* **Tausendertrennzeichen** erkennt der `number`-Konverter nicht; das
  Dezimalzeichen wird angegeben.
* **`npm run typecheck` meldet 35 offene Befunde.** Das Skript war bis zum
  01.09.2026 gar nicht lauffaehig, weil `vue-tsc` fehlte; es ist jetzt als
  Entwicklungsabhaengigkeit dabei. Die Befunde stammen aus der Zeit davor und
  liegen samtlich ausserhalb des vertraglichen Kernablaufs — im Editor fuer
  einzelne Datensaetze, in der Nutzerverwaltung, im Format-Review und in drei
  Auslieferungsendpunkten. Es sind fehlende Nullpruefungen auf Werten, die
  `useFetch` als moeglicherweise undefiniert fuehrt. Tests und Build laufen
  davon unberuehrt durch.

## Was ueber den Auftragsumfang hinausgeht

Vertraglich geschuldet sind Upload von CSV und XLSX, Zuordnung der Spalten auf
das AVefi-Schema, Konvertierung, Pruefung mit efi-conv und Ausgabe. Folgendes
ist zusaetzlich vorhanden und **nicht** Teil des Liefergegenstands. Es ist hier
aufgefuehrt, damit bei der Abnahme kein Missverstaendnis entsteht — weder darf
es als geschuldete Leistung geprueft werden, noch soll sein Fehlen anderswo
ueberraschen:

* **Einzelsatzbearbeitung** (`/imports/:id/records/:recordId`) — einzelne
  AVefi-Datensaetze im Editor aendern, mit Live-Pruefung.
* **Nutzerverwaltung** (`/users`) — Konten anlegen, bearbeiten, sperren,
  loeschen, Passwort neu setzen. Vertraglich reicht eine einfache
  Demo-Authentifizierung ohne Benutzerverwaltung.
* **Normdatenanreicherung** ueber GND, Wikidata und VIAF, mit Zwischenspeicher
  in der Datenbank. Standardmaessig ausgeschaltet.
* **MARC-XML- und EAD-Konverter** sowie ein generischer JSON-Konverter und das
  Durchreichen nativer AVefi-Dateien.
* **Formatpruefungs-Warteschlange** (`/reviews`) — unbekannte Kopfzeilen warten
  auf eine Entscheidung, die dann fuer alle Dateien mit derselben Kopfzeile gilt.
* **Zweisprachige Oberflaeche** (Deutsch, Englisch).

Nicht vorhanden und nicht geschuldet ist die **Registrierung von AVefi-PIDs**.
Die Spalte `records.avefi_pid` und die Zielschluessel `work.identifier.avefi` und
`item.identifier.avefi` existieren, damit sich bereits vergebene PIDs abbilden
lassen; einen Dienst, der neue vergibt, gibt es nicht.

## Repository

```
README.md · LICENSE
handbuch/                Handreichung fuer Anwenderinnen (Stand PHP-Version, s. u.)
samples/                 Beispieldateien (CSV, JSON, MARC-XML, EAD, AVefi nativ)
src/                     die Anwendung  (siehe src/docs/architecture.md)
```

`handbuch/` beschreibt noch die PHP-Version: Es nennt drei Container statt
fuenf, kennt weder den Worker noch den efi-conv-Dienst, nennt XLSX nicht unter
den Formaten und fuehrt eine PID-Registrierung auf, die es nicht gibt. Kapitel 1
(Installation) ist durchgehend ueberholt — es ruft `php app/bot.php` auf und
nennt Port 8080. Fuer Betrieb und Technik gelten die Dateien unter `src/docs/`;
die Kapitel 2 bis 5 und 7 beschreiben Ablaeufe, die sich in der Bedienung nicht
geaendert haben.

Die PHP-Version ist im Tag `php-final` erhalten und wird nicht mehr
weiterentwickelt. Ein `git switch -c php php-final` holt sie zurueck; die
Startkonfiguration fehlt dabei, weil `docker-compose.dev.yml` damals nicht im
Repository lag. Seit dem 18.09.2026 liegt sie dort (#23), aber eben erst ab
diesem Stand.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
