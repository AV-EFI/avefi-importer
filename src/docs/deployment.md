# Betrieb und Auslieferung

Diese Datei beschreibt Installation, Initialisierung, Start, Bau, Tests und die
Umgebungsvariablen. Alle Angaben sind auf dem Testserver ausgefuehrt worden;
wo etwas nicht funktioniert, steht das dabei.

Alle Befehle laufen im Verzeichnis `src/`.

## Vor dem ersten Produktivstart

Drei Werte stehen im Auslieferungszustand auf einer Vorgabe aus der
Beispielkonfiguration. Wer sie stehen laesst, betreibt eine Installation, bei
der Fremde sich anmelden koennen.

| Was | Wo | Vorgabe | Warum es zwingend ist |
|-----|----|---------|------------------------|
| `SESSION_SECRET` / `NUXT_SESSION_SECRET` | Umgebung, siehe unten | `entwicklung-nur-lokal-aendern` (`nuxt.config.ts`) | Die Sitzungscookies sind damit verschluesselt. Wer den Wert kennt, erzeugt sich ein gueltiges Cookie fuer jedes Konto. Die Anmeldung ist dann Kulisse. |
| `DB_PASS` / `NUXT_DB_PASS` | Umgebung | `avefi` | Zugriff auf alle Importe, Profile und Konten, sobald die Datenbank erreichbar ist. |
| Passwort des ersten Kontos | Nutzerverwaltung oder `SEED_PASSWORD` | keine — `npm run seed` erzeugt eines und zeigt es genau einmal | Ein Konto mit einem Passwort aus der Dokumentation ist eine offene Tuer. |

Eigene Werte erzeugen:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 24   # DB_PASS
```

**Die Anwendung prueft das beim Start selbst.** `server/plugins/vorgabewerte.ts`
haelt Umgebung und aktive Administratorkonten gegen die bekannten Vorgabewerte:

* `SESSION_SECRET` auf einer Vorgabe **und** `NODE_ENV=production` — der Start
  bricht ab. Ein Server, der so hochkommt, sieht gesund aus und faellt erst
  auf, wenn ihn jemand benutzt hat.
* Alles andere — eine Warnung im Protokoll, und fuer angemeldete
  Administratoren ein Streifen ueber der Kopfzeile.

Im Entwicklungsbetrieb bleibt es in allen Faellen bei der Warnung.

Nachsehen, was die laufende Installation meldet:

```bash
docker compose -f docker-compose.dev.yml logs web | grep vorgabewerte
```

Diese Anleitung sagte das Richtige schon, bevor es die Pruefung gab. Am
09.09.2026 lief die oeffentlich erreichbare Testinstanz trotzdem mit allen drei
Vorgabewerten. Deshalb steht es jetzt zusaetzlich im Programm.

## Voraussetzungen

* Docker mit Compose-Plugin. Ohne Docker: Node ab 22.19.0 (`package.json`,
  Feld `engines`; die Images benutzen Node 24) und PostgreSQL 16.
* Ausgehende HTTPS-Verbindungen beim **Bauen** des efi-conv-Sidecars: das
  echte `efi-conv` wird per pip aus dem Git-Repository geholt und das
  AVefi-Schema einmalig ins Image geschrieben. Im laufenden Betrieb braucht der
  Dienst kein Netz mehr.
* Ausgehende HTTPS-Verbindungen zur Laufzeit nur, wenn `AUTHORITY_ENABLED`
  eingeschaltet wird. Standard ist aus.

## Container

`docker-compose.dev.yml` beschreibt fuenf Dienste.

| Dienst | Image | Aufgabe |
|---|---|---|
| `web` | aus `Dockerfile`, Stufe `base` | Nuxt/Nitro, Oberflaeche und `/api`. Hoert auf Port 3000. |
| `worker` | aus `Dockerfile`, Stufe `base` | Hintergrundprozess, arbeitet die Tabelle `worker_jobs` ab. |
| `efi-conv` | aus `efi-conv/Dockerfile` | Validierungsdienst mit dem echten `efi-conv`. Hoert auf Port 8000, nur im internen Netz. |
| `db` | `postgres:16` | Datenbank. Laedt beim ersten Start `db/schema.sql`. |
| `adminer` | `adminer` | Datenbankoberflaeche, nur auf `127.0.0.1:8081` gebunden. |

Die Datei liegt im Repository und enthaelt keine Zugangsdaten; was geheim ist
oder nur auf einem bestimmten Server gilt, kommt aus `.env`. Wer mehr aendern
muss als diese Variablen, kopiert sie nach `docker-compose.local.yml` (steht in
`.gitignore`).

`web` und `worker` haengen den Code ein (`./:/app`), damit Aenderungen ohne
neuen Aufbau wirken. Zwei anonyme Volumes, `/app/node_modules` und `/app/.nuxt`,
halten dabei die Abhaengigkeiten und erzeugten Typen aus dem Abbild sichtbar.
Ohne sie verdeckt der eingehaengte Code das `node_modules` des Abbilds, und in
einem frischen Klon startet nichts (`sh: nuxt: not found`). Bis zum 28.10.2026
fehlten sie; auf dem Testserver fiel das nicht auf, weil dort ein aelteres
`node_modules` im Arbeitsverzeichnis lag.

Folge: Abhaengigkeiten kommen nur ueber einen Neubau ins laufende System. Nach
einer Aenderung an `package-lock.json`:

```bash
docker compose -f docker-compose.dev.yml up -d --build -V
```

`-V` erneuert die anonymen Volumes; ohne die Angabe behielten die Container ihr
altes `node_modules`.

Fuer den Produktivbetrieb ist diese Datei nicht gedacht, siehe
„Auslieferungsbau".

### Warum der Worker ein eigener Container ist

Der Worker teilt mit der Oberflaeche nur die Datenbank und das Dateiverzeichnis,
sonst nichts. Das hat drei Gruende.

Erstens die Laufzeit: Eine Lieferung mit einigen hunderttausend Zeilen laeuft
Minuten. Liefe die Konvertierung im Webprozess, blockierte sie Anfragen oder
liefe in einen Zeitablauf des vorgelagerten Servers.

Zweitens der Speicher: Der Worker liest im Datenstrom und schreibt
`avefi.v1.json` mitwachsend. Sein Speicherbedarf haengt nicht an der
Dateigroesse, aber er ist ein anderer als der eines Webprozesses. Getrennte
Container lassen sich getrennt begrenzen und getrennt neu starten.

Drittens der Code-Stand: Der Worker beendet sich nach `WORKER_MAX_UPTIME`
(Vorgabe 600 Sekunden) von selbst, `restart: always` zieht ihn neu hoch. Ein
Dauerprozess haelt geladenen Code im Speicher; ohne Selbstbeendigung arbeitet er
mit altem Code weiter, waehrend die Oberflaeche schon neuen zeigt. Der Worker
benutzt deshalb `npm run worker` und nicht `tsx watch` — der
Ueberwachungsprozess von `watch` ueberlebt das Prozessende, der Container bliebe
stehen und `restart: always` griffe nicht.

Im Produktivbetrieb ist der Selbstneustart unerwuenscht, unter Kubernetes etwa
fuehrt er in `CrashLoopBackOff`. `WORKER_MAX_UPTIME=0` heisst deshalb „keine
Hoechstlaufzeit", und das Abbild `worker` setzt diesen Wert. Bis zum 28.10.2026
beendete `0` den Worker sofort.

Eine Warteschlange in der Datenbank statt Redis oder eines Nachrichtendienstes:
`SELECT … FOR UPDATE SKIP LOCKED` reicht fuer diese Last und spart einen
weiteren Dienst, der betrieben und gesichert werden muss.

### efi-conv als Sidecar

Der Vertrag verlangt Pruefung „mit `efi-conv check` oder unter direkter Nutzung
derselben Validierungslogik". Genau das passiert hier: `efi-conv/Dockerfile`
installiert das echte Paket per pip aus dem Git-Repository, `efi-conv/service.py`
laedt mit `get_schema_validator()` denselben Validator, den `efi-conv check`
benutzt. Nichts davon ist nachgebaut.

Zwei Bauargumente steuern, welcher Stand installiert wird:

```bash
docker compose -f docker-compose.dev.yml build \
  --build-arg EFI_CONV_REPO=github.com/AV-EFI/efi-conv.git \
  --build-arg EFI_CONV_REF=main \
  efi-conv
```

Damit laesst sich auf den Stand aus Leistungspaket A oder auf einen festen
Commit zeigen, sodass Konverter und Importer dieselbe Pruefung benutzen.

Das AVefi-Schema wird beim Bauen einmal geholt und im Image eingefroren
(`/root/.cache/efi_conv/`). Ohne das laedt efi-conv es zur Laufzeit vom
main-Branch, und keine Konvertierung waere reproduzierbar, weil sich das Schema
unter der laufenden Anwendung aendern kann. Welches Schema geladen wurde, sagt
`GET /health`; die Angabe wandert in den Pruefbericht jedes Imports.

Der Dienst hat zwei Endpunkte:

* `POST /check` sammelt alle Befunde. `efi-conv check` bricht beim ersten
  Schemafehler ab (`pass_checks` wirft); ein Importer muss alle Fehler auf
  einmal zeigen koennen, deshalb laeuft die Pruefung hier ueber `iter_errors`.
  Zusaetzlich zu den Schemafehlern pruefen dieselben satzuebergreifenden Regeln
  wie die Kommandozeile: Eindeutigkeit der Kennungen, aufloesbare Verweise,
  Knoten ohne zugehoeriges Exemplar. Der Kopfkommentar in `service.py` haelt
  diesen Unterschied fest.
* `POST /check-cli` fuehrt `efi-conv check` unveraendert auf einer temporaeren
  Datei aus und gibt Rueckgabewert, Standardausgabe und Fehlerausgabe zurueck.
  Der Endpunkt ist fuer den Abnahmenachweis da: Er belegt, dass die
  Kommandozeile zum selben Ergebnis kommt.

**Was die Pruefung tatsaechlich traegt** (Stand 30.09.2026). Die Wurzel des
AVefi-JSON-Schemas ist `{type: object, $defs: …}` und legt fuer einen einzelnen
Satz nichts fest; `iter_errors` findet dort nichts — hier wie in `efi-conv
check`. Geprueft wird in efi-conv in Wahrheit beim Laden: `avefi.load` liest die
Datei als Pydantic-Modell und bricht an einem ungueltigen Satz ab, danach laeuft
`has_invalid_value` (Datum, Zeitraum, Feldlaengen, leere Namen, Titeltyp,
aufgegebenes Exemplar ohne PID). `/check` spiegelt genau das: Jeder Satz wird
geladen, jeder Ladefehler ist ein Fehler `model_invalid`, und an ladbaren
Saetzen laufen die Regeln (`rule_*`). Den Wortlaut von Pydantic bzw. efi-conv
traegt jede Meldung als `detail`, der Satz in der Oberflaeche kommt aus `code`
und `params`.

Bis zu diesem Stand liefen die Regeln nie: Sie bekamen ein `dict` statt eines
Modells, warfen bei jedem Satz, und das wurde stillschweigend uebergangen.

Tests des Dienstes laufen im Container, ohne etwas nachzuinstallieren:

```bash
docker compose -f docker-compose.dev.yml exec efi-conv python -m unittest -v test_service
```

## Installation und Start

```bash
git clone <repository>
cd avefi-importer/src

cp .env.example .env          # Werte anpassen, mindestens DB_PASS und SESSION_SECRET
cp docker-compose.dev.yml docker-compose.local.yml   # falls eigene Marken noetig

docker compose -f docker-compose.dev.yml up -d --build
```

Der erste Aufbau dauert einige Minuten, im Wesentlichen wegen des
efi-conv-Images. Danach:

```bash
docker compose -f docker-compose.dev.yml ps
```

Alle fuenf Dienste stehen auf `Up`, `db` und `efi-conv` zusaetzlich auf
`healthy`. Die Oberflaeche liegt hinter dem vorgelagerten Server auf Port 3000
des `web`-Containers; Adminer auf `http://127.0.0.1:8081`.

### Initialisierung

`db/schema.sql` wird von PostgreSQL beim **ersten** Start automatisch
ausgefuehrt (`docker-entrypoint-initdb.d`) und legt zehn Tabellen sowie eine
Start-Institution an. Nachgereichte Spalten stehen als
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` in derselben Datei, sie ist also auch
auf einer bestehenden Datenbank wiederholbar:

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U avefi -d avefi < db/schema.sql
```

**Ein Anmeldekonto legt das Schema nicht an.** Das erste Konto samt
Institution legt `npm run seed` an:

```bash
docker compose -f docker-compose.dev.yml exec web npm run seed
```

Anmeldename und Institution kommen aus `SEED_EMAIL` und `SEED_INSTITUTION`, das
Passwort aus `SEED_PASSWORD`. Fehlt es, wird eines erzeugt und **genau einmal**
ausgegeben. Ein vorhandenes Konto wird nur mit `SEED_FORCE=1` ueberschrieben.
Mit den Abbildern aus dem Auslieferungsbau laeuft derselbe Schritt im
`worker`-Abbild:

```bash
docker run --rm --network <netz> -e DB_HOST=db -e DB_PASS=... \
  -e SEED_EMAIL=admin@example.org avefi-importer:worker npm run seed
```

Weitere Konten legt die Nutzerverwaltung in der Oberflaeche an; sie erzeugt
Einmalpasswoerter, die genau einmal in der Antwort erscheinen.

Durchgespielt am 28.10.2026 in einem frischen Klon: Seed auf leerer Datenbank,
danach antwortet `POST /api/auth/login` mit 200 und dem Konto.

### Tests

Die Tests brauchen keine Datenbank und keinen laufenden Dienst:

```bash
docker build --target base -t avefi-importer:dev .
docker run --rm avefi-importer:dev npm test
```

Ohne Docker dieselbe Reihenfolge wie in der CI (`.github/workflows/test.yml`):

```bash
npm ci --ignore-scripts && npm rebuild esbuild && npx nuxt prepare && npm test
```

`nuxt prepare` ist dabei kein Beiwerk. Es erzeugt `.nuxt/tsconfig.json`, von der
`tsconfig.json` erbt; ohne die Datei scheitert jede Testdatei mit
`Failed to load tsconfig '.nuxt/tsconfig.json'`. Bis zum 28.10.2026 stand hier
ein Befehl, der den Klon ohne Installation einhaengte. Er funktionierte nur dort,
wo zufaellig schon ein `node_modules` lag.

Stand der Pruefung: **718 Tests in 62 Dateien, alle erfolgreich**, Laufzeit unter zehn
Sekunden.
`npm run typecheck` laeuft ohne Befund durch (geprueft am 28.10.2026).

Abgedeckt sind Konverterkette und Typpruefung, Mappingprofile samt Aus- und
Wiedereinlesen, Kopfzeilen-Aufloesung, Vorschau, Zielkatalog, Schemamodell,
Vollstaendigkeitsberechnung, Excel-Datumsbehandlung, Trennzeichenerkennung,
Parse-Diagnose, Warteschlange und die Normdatenanbindung mit ihrem
Zwischenspeicher. Nicht abgedeckt sind die Vue-Komponenten; die Oberflaeche wird
von Hand geprueft, siehe `frontend-pruefen.md`.

## Auslieferungsbau

Das `Dockerfile` hat vier Stufen:

| Stufe | Inhalt | Startbefehl |
|---|---|---|
| `base` | Entwicklungsstand, alle Abhaengigkeiten, `nuxt prepare`. Grundlage fuer `docker-compose.dev.yml` und die Tests. | `npm run dev` |
| `build` | fuehrt `npm run build` aus | — |
| `production` | Weboberflaeche: nur das erzeugte `.output` und die Oberflaechenbeschreibungen | `node .output/server/index.mjs` |
| `worker` | Hintergrundprozess: Laufzeitabhaengigkeiten (`npm ci --omit=dev`), `server/`, `shared/`, `db/`, `WORKER_MAX_UPTIME=0` | `npm run worker` |

```bash
docker build --target production -t avefi-importer:web .
docker build --target worker     -t avefi-importer:worker .
```

Jedes Abbild startet von selbst das Richtige; eine Pipeline muss keinen
Startbefehl setzen. Bis zum 28.10.2026 gab es keine Stufe `worker`. Der Worker
liess sich im Produktivbetrieb nur aus `base` starten, und das ging ohne
eingehaengten Code nicht (`#shared/*` war ohne `.nuxt` nicht aufloesbar).

Der Worker laeuft nicht aus `.output`, sondern als eigenes Programm, das `tsx`
zur Laufzeit uebersetzt. Deshalb steht `tsx` unter `dependencies`. Er liest
beim Start `db/schema.sql` von der Platte; die Weboberflaeche hat das Schema im
Bundle. Dasselbe Abbild fuehrt auch `npm run seed` und `npm run migrate` aus.

Start beider Abbilder, hier mit Docker; mit Podman genauso:

```bash
docker run -d --name avefi-web \
  -e DB_HOST=db -e DB_PASS=... -e SESSION_SECRET=... \
  -e FILES_PATH=/mnt/files -e EFI_CONV_URL=http://efi-conv:8000 \
  -v avefi_files:/mnt/files \
  avefi-importer:web

docker run -d --name avefi-worker \
  -e DB_HOST=db -e DB_PASS=... \
  -e FILES_PATH=/mnt/files -e EFI_CONV_URL=http://efi-conv:8000 \
  -v avefi_files:/mnt/files \
  avefi-importer:worker
```

Beide brauchen **dasselbe Dateiverzeichnis** (`FILES_PATH`): Die Oberflaeche legt
Uploads ab, der Worker liest sie und schreibt `avefi.v1.json` daneben. Der
Validierungsdienst (`efi-conv/Dockerfile`) und PostgreSQL 16 laufen wie im
Entwicklungsaufbau.

**Geprueft am 28.10.2026** in einem frischen Klon gegen eine leere Datenbank:
Beide Abbilder bauen. `web` meldet `Listening on http://[::]:3000`, legt das
Schema an und beantwortet die Anmeldung mit 200. `worker` legt das Schema an
und arbeitet hochgeladene Dateien ab: CSV-Erkennung, XLSX-Blattwahl,
Konvertierung nativer AVefi-Dateien.

Der Testserver laeuft absichtlich im Entwicklungsmodus (`docker-compose.dev.yml`,
Code eingehaengt), damit Aenderungen ohne neuen Aufbau wirken.

## Umgebungsvariablen

### Schreibweise

Alle Variablen gelten mit dem Namen aus der Tabelle unten, im
Entwicklungsaufbau wie in den Abbildern `production` und `worker`. Fuer
Datenbank und Sitzungsgeheimnis wird zusaetzlich die Form mit Praefix `NUXT_`
angenommen (`NUXT_DB_HOST`, `NUXT_SESSION_SECRET`, …). Noetig ist sie nicht.
Sind beide gesetzt, gilt der Name ohne Praefix.

Bis zum 28.10.2026 stand hier das Gegenteil: Im Auslieferungsbetrieb muesse die
`NUXT_`-Form gesetzt werden. Das stimmte schon nicht mehr, weil die Oberflaeche
`process.env` vor der eingebackenen `runtimeConfig` liest. Und es fuehrte in eine
Falle: Der Worker las damals nur die Namen ohne Praefix und fiel bei reiner
`NUXT_`-Form still auf `avefi`/`avefi` zurueck. Heute liest auch er beide.

### Verzeichnis

| Variable | Pflicht | Vorgabe | Zweck |
|---|---|---|---|
| `DB_HOST` / `NUXT_DB_HOST` | ja | `db` | Rechnername der Datenbank. |
| `DB_PORT` / `NUXT_DB_PORT` | nein | `5432` | Port der Datenbank. |
| `DB_NAME` / `NUXT_DB_NAME` | ja | `avefi` | Name der Datenbank. |
| `DB_USER` / `NUXT_DB_USER` | ja | `avefi` | Benutzer der Datenbank. |
| `DB_PASS` / `NUXT_DB_PASS` | ja | `avefi` | Passwort. Die Vorgabe ist ein Entwicklungswert und gehoert ersetzt. |
| `SESSION_SECRET` / `NUXT_SESSION_SECRET` | ja | `entwicklung-nur-lokal-aendern` | Schluessel der verschluesselten Sitzungscookies. Mindestens 32 Zeichen; kuerzere Werte werden aufgefuellt, ohne dadurch sicherer zu werden. Wechselt der Wert, sind alle Sitzungen ungueltig. |
| `FILES_PATH` | nein | `/mnt/files` | Ablage der Uploads und Ergebnisdateien. Muss beschreibbar sein. |
| `EFI_CONV_URL` | nein | `http://efi-conv:8000` | Adresse des Validierungsdienstes. Ist er nicht erreichbar, wird die Datei erzeugt, der Bericht vermerkt aber ausdruecklich, dass nicht geprueft wurde. |
| `WORKER_MAX_UPTIME` | nein | `600`, im Abbild `worker` `0` | Sekunden bis zur Selbstbeendigung des Workers; `0` heisst keine Hoechstlaufzeit. Unbrauchbare Angaben fallen mit Warnung auf 600 zurueck. Nur im `worker`-Container sinnvoll. |
| `AUTHORITY_ENABLED` | nein | aus | Normdatenanreicherung. Wahr bei `1`, `true`, `ja`, `on`. Vertraglich nicht geschuldet. **In `web` UND `worker` gleich setzen** — siehe unten. |
| `AUTHORITY_LIMIT` | nein | `500` | Obergrenze der frischen Nachschlagevorgaenge je Konvertierung. Unbrauchbare Angaben fallen auf 500 zurueck. Ebenfalls in beiden Containern gleich setzen. |
| `EFI_CONV_REPO` | nein (Bauzeit) | `github.com/AV-EFI/efi-conv.git` | Herkunft von efi-conv beim Bauen des Sidecars. |
| `EFI_CONV_REF` | nein (Bauzeit) | `main` | Zweig oder Commit von efi-conv. Fuer reproduzierbare Ergebnisse einen Commit eintragen. |
| `APP_DOMAIN` | nein | `localhost` | Nur fuer die Traefik-Regel in `docker-compose.dev.yml`. Die Anwendung selbst kennt keine feste Domain. |
| `DB_SCHEMA_AUTO` | nein | an | Beim Start wird `db/schema.sql` angewandt. Mit `0` unterbleibt das; dann ist `npm run migrate` der Weg. Fuer eine fremdverwaltete Datenbank gedacht, in der die Anwendung nichts anlegen darf. |
| `SEED_EMAIL` | nein (nur `npm run seed`) | `admin@av-efi.net` | Anmeldename des ersten Kontos. |
| `SEED_PASSWORD` | nein (nur `npm run seed`) | zufaellig | Passwort des ersten Kontos. Fehlt die Angabe, wird eines erzeugt und auf der Konsole ausgegeben — genau einmal. |
| `SEED_INSTITUTION` | nein (nur `npm run seed`) | `AVefi Testinstitution` | Name der ersten Institution. |
| `SEED_FORCE` | nein (nur `npm run seed`) | aus | Mit `1` wird ein vorhandenes Konto ueberschrieben. Ohne die Angabe bricht der Lauf ab, statt ein bestehendes Passwort stillschweigend zu ersetzen. |

| Variable | Stand |
|---|---|
| `DEMO_PASSWORD` | Wirksam. Ist die Variable gesetzt, liegt eine Basis-Authentifizierung vor der ganzen Anwendung (`server/middleware/00.demo-gate.ts`) — der einfache Zugriffsschutz ohne Nutzerverwaltung, den die Leistungsbeschreibung fuer Entwicklung und Vorfuehrung verlangt. Ist sie leer, entfaellt die Huerde und der Zugang laeuft allein ueber die Nutzerverwaltung. |
| `NUXT_PUBLIC_API_BASE` | Wirksam. Alle Aufrufe der Oberflaeche gehen ueber `useApi()` und stellen diese Basis voran; ohne Angabe gilt `/api`. Damit laesst sich der Importer hinter einem fremden Frontend oder unter eigener Subdomain betreiben, ohne den Code anzufassen. |

Ohne Wirkung im Code sind `APP_HOST` aus `docker-compose.dev.yml` und
`NODE_ENV` ausserhalb dessen, was Nuxt und Nitro selbst daraus machen.

### Normdaten in beiden Containern

`AUTHORITY_ENABLED` und `AUTHORITY_LIMIT` werden an zwei Stellen gelesen:

* im `worker`, wenn ein Import konvertiert wird,
* im `web`, wenn der Editor seine Vorschau rechnet.

Beide gehen denselben Weg (`resolveForMapping()` in
`server/lib/authority/pipeline.ts`), benutzen denselben Zwischenspeicher
(Tabelle `authority_cache`) und rechnen mit denselben Nachschlagediensten. Steht
der Schalter nur in einem der beiden Container, zeigt der Editor etwas anderes
als der Export — im ausgelieferten Stand war das der Fall, und der Anwender hat
es gemeldet: Der Editor loeste Laendernamen auf, die erzeugte Datei nicht.

Ein Unterschied bleibt und ist gewollt: Die Vorschau holt hoechstens
`PREVIEW_AUTHORITY_LIMIT` (25) Werte frisch aus dem Netz, weil sie nach jeder
Aenderung im Editor neu rechnet. Was sie deshalb liegen laesst, steht als
Hinweis in der Pruefleiste; beim naechsten Durchlauf ist es aus dem
Zwischenspeicher da, denn auch Nicht-Treffer werden dort abgelegt.

Ist die Anreicherung aus, laeuft alles unveraendert durch — nur ohne
Normdaten-IDs. Laender- und Sprachtabellen liegen im Programm und brauchen kein
Netz; sie wirken immer.

## Zwischenspeicherung

Nitro setzt fuer `/**` die Kopfzeilen `cache-control: no-store, private,
max-age=0, must-revalidate`, dazu `cdn-cache-control`,
`cloudflare-cdn-cache-control` und `vary: cookie`.

Der Grund ist ein aufgetretener Fall, kein Vorsichtsprinzip: Ein vorgelagerter
Zwischenspeicher (Cloudflare) hat eine angemeldete Importliste abgelegt und an
Aufrufer ohne Sitzung weitergegeben, nachweisbar an `cf-cache-status: HIT` auf
der Importliste ohne Sitzungscookie. Jede Seite dieser Anwendung zeigt Daten
einer angemeldeten Institution; keine davon darf zwischengespeichert werden.

Ausgenommen sind Dateien ohne Personenbezug: `/_nuxt/**` (ein Jahr, `immutable`,
die Namen tragen einen Hash), `favicon.ico`, `favicon.svg`, `av-efi-logo.svg`
und `robots.txt` (je ein Tag).

Wer einen anderen vorgelagerten Server einsetzt, prueft das nach:

```bash
curl -sI https://<host>/ | grep -i cache
```

## Sicherung

Zu sichern sind zwei Dinge:

* die Datenbank (`pg_dump`) — Importe, Datensaetze, Mappingprofile samt
  Versionsverlauf, Konten;
* das Verzeichnis aus `FILES_PATH` — Originaldateien und erzeugte
  `avefi.v1.json`.

Eines ohne das andere nuetzt wenig: Die Datenbank verweist mit
`imports.storage_path` auf Dateien, und ein Import ohne seine Originaldatei
laesst sich nicht erneut konvertieren.

## Offene Punkte

* **Die laufende Testdatenbank enthaelt eine Tabelle `jobs`**, die in
  `db/schema.sql` nicht vorkommt. Sie stammt aus der PHP-Version, wird von
  dieser Anwendung nicht benutzt und fehlt einer frisch aufgesetzten Datenbank
  zu Recht.
