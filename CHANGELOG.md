# Änderungsprotokoll

AVefi Importer, Leistungspaket B des Werkvertrags mit der TIB Hannover.

## Wozu dieses Protokoll da ist

Nicht als Liste von Änderungen, sondern als **Nachweis, dass jede Rückmeldung
angekommen ist**. Die Leistungsbeschreibung verlangt eine „Dokumentation
bekannter Einschränkungen und getroffener Annahmen" und dass Abweichungen
gegenüber den Vorgaben benannt werden. Beides steht hier.

Deshalb ist nach **Rückmelderunden** gegliedert und nicht nach Commits, und
deshalb nennt jeder Eintrag, **wer** etwas gemeldet hat. Wer wissen will, was
aus seinem Hinweis geworden ist, findet ihn unter seinem Namen.

Aufbau eines Eintrags:

> **Was gemeldet wurde** — von wem, wann.
> Was die Ursache war, was daraus wurde, welcher Commit, und — wo einschlägig —
> welches Abnahmekriterium betroffen ist.

Einträge, die nicht auf eine Meldung zurückgehen, stehen unter „Aus eigenem
Antrieb". Was offen blieb, steht unter „Offen geblieben" — auch dann, wenn es
unangenehm ist.

Zeitzone durchgängig Europe/Berlin. Commits verweisen auf
`github.com/AV-EFI/avefi-importer`. Das Repository lag bis zum 10.09.2026 unter
`github.com/andreaskasper/avefi-importer`; Verweise auf den alten Pfad leitet
GitHub weiter.

---

## 2026-10-29, mittags — npm audit: Nuxt 4.6, vue-i18n, zod, undici

Anlass: Beim XLSX-Umbau zeigte `npm audit` 19 betroffene Pakete (10 hoch,
5 mittel, 4 niedrig), Dependabot dazu Hinweise zu Nuxt, Vite, launch-editor,
node-forge und braces. Gewährleistung, auf dem Branch `fix/npm-audit`
(baut auf `fix/eigener-xlsx-leser` auf).

### Was aktualisiert wurde

Alles innerhalb der bestehenden Versionsbereiche, kein Major-Sprung:

* **Nuxt 4.5.2 → 4.6.3** (Server-Routenregeln, Nitro-Server, Vite-Builder).
* **vue-i18n und `@intlify/*` 11.4.9 → 11.4.16** (`escapeParameter` ließ
  HTML in Platzhaltern durch).
* **zod 4.4.3 → 4.6.7** (Speicherverbrauch bei übergroßen Eingaben).
* **undici 8.12.3**, **seroval 1.7.3**, **node-forge 1.4.2**,
  **serialize-javascript 7.1.4**, **vitest 4.1.12** samt `@vitest/mocker`,
  Vue 3.5.44 und Folgepakete.
* **`@intlify/unplugin-vue-i18n` 11.2.8**: zieht die neue Fassung der
  i18n-Bauerweiterung, die das Haupt-`vue-i18n` mitbenutzt. Damit fällt die
  zweite, veraltete Kopie `vue-i18n@10` weg, mit ihr eine Meldung und eine
  npm-Warnung beim Bauen.
* Die Override-Regel für `simple-git` entfällt; Nuxt bringt das Paket nicht
  mehr mit. `package.json` hat damit keine Overrides mehr.

Danach meldet `npm audit` nur noch **deepmerge 4.3.1** (niedrig): Es wird
ausschließlich beim Bauen von Rollup über Nitro benutzt, nicht zur Laufzeit,
und eine reparierte Fassung gibt es nicht. Beim Installieren warnt npm nur noch
über `glob@10` (über Nuxt).

### Eine Anpassung im Code: `apiFetch()`

Nuxt 4.6 leitet bei `$fetch(adresse, { method })` den Antworttyp aus allen
Serverrouten her, sobald die Adresse ein beliebiger `string` ist. Adressen aus
`useApi()` sind das immer, weil die API-Basis konfigurierbar ist. Der Typecheck
brach daran mit TS2321 („Excessive stack depth") ab, Aufruf für Aufruf.

Neu ist `apiFetch()` neben `useApi()` in `app/composables/useApi.ts`: derselbe
`$fetch`-Aufruf, nur ohne die Routentypen. Die Services nannten ihre
Antwortformen ohnehin selbst. Umgestellt sind alle 30 Aufrufe in
`app/services` und `useAuth`. `tests/frontend/abfragen.test.ts` bewacht
`apiFetch` wie `$fetch`: In Pages, Layouts und Komponenten darf keins von
beiden stehen.

### Geprüft

* 719 Tests in 62 Dateien grün, `npm run typecheck` ohne Befund,
  Produktiv-Build und beide Abbilder.
* Demo auf dem Branch (Nuxt 4.6.3, Vue 3.5.44), danach der
  Barrierefreiheitslauf `tests/a11y/axe.mjs` über alle Kernseiten und
  Zustände, hell und dunkel, breit und schmal: 107 Stände, kein Befund
  der Schwere „serious“ oder „critical“. Deutsch und Englisch geprüft.

### Offen geblieben

* deepmerge 4.3.1 (siehe oben).
* Dependabot zeigt für `main` noch Hinweise zu Vite und launch-editor. Beide
  sind seit dem 22.10. auf reparierten Fassungen (Vite 8.3.5, launch-editor
  2.14.2); die Hinweise schließen sich, sobald GitHub den Stand neu einliest.
* Dependabot meldet außerdem `braces` 3.0.3. Es kommt über Nitro (`globby`,
  `fast-glob`, `micromatch`) und dient dort der Dateisuche beim Bauen. Eine
  reparierte Fassung gibt es nicht, `npm audit` führt die Meldung nicht.

---

## 2026-10-29 — Eigener XLSX-Leser statt exceljs

Anlass: Elias Oltmanns (Mail vom 28.10.) fragte nach den npm-Meldungen zu
veralteten Paketen beim Bauen. Fünf davon kamen über `exceljs` herein
(`fstream`, `rimraf@2`, `glob@7`, `inflight`, `lodash.isequal`). `exceljs`
wird nicht mehr gepflegt; die letzte Version ist 4.4.0, und deren Bereiche
lassen sich mit `npm upgrade` nicht anheben. Als Erweiterung im Rahmen der
Gewährleistung, auf dem Branch `fix/eigener-xlsx-leser`.

### Was sich ändert

`exceljs` ist ganz aus dem Projekt. Gelesen wird mit
`server/lib/converters/xlsx.ts`, rund 550 Zeilen samt Kommentaren, auf zwei gepflegten Paketen:
`yauzl` (ZIP, MIT) und `sax` (XML im Datenstrom, BlueOak-1.0.0; lag schon im
Abhängigkeitsbaum). Der Leser gibt je Zelle dieselbe Form heraus wie zuvor
`exceljs` (`{ value, numFmt }`). Die Formatierung in `excelValue.ts` ist
unverändert, deshalb bleibt die Ausgabe gleich.

Nach außen gibt es dieselben zwei Funktionen wie bisher (`listSheets`,
`extractSheet` in `spreadsheet.ts`). Aufrufer, Datenbank und Oberfläche sind
nicht berührt.

* 82 Pakete weniger im Baum; von den npm-Meldungen bleiben die zwei, die über
  Nuxt und `@nuxtjs/i18n` kommen. Das Abbild `worker` ist 31 MB kleiner.
* Die Override-Regel für `uuid` entfällt; `uuid` kam nur über `exceljs`.
* `excelDates.test.ts` baut seine Mappe jetzt selbst (`tests/converters/xlsxBau.ts`,
  ZIP mit `node:zlib`), neu sind 21 Tests in `tests/converters/xlsx.test.ts`.

### Wie geprüft wurde

Vergleichslauf alter gegen neuen Leser über alle 76 XLSX-Uploads auf dem
Testserver (9 verschiedene Dateien), die Beispieldatei, 10 fremde Mappen aus
anderen Projekten (LibreOffice, Excel für Windows und Mac) und drei eigens
erzeugte Mappen mit Sonderfällen (openpyxl, PhpSpreadsheet, 1904-Datumssystem):
Blattliste und CSV je Blatt, Zelle für Zelle. Zusätzlich gegen openpyxl als
unabhängige Gegenprobe: 54.881 Zellen, Blattnamen, Reihenfolge und
Zahlenformate; abweichend nur zwei Zellen, an denen die Gegenprobe selbst
anders zählt (1904-Seriennummer, Uhrzeit als Text).

In den AVefi-Lieferungen (62 Blätter, 35.749 gefüllte Zellen) weichen 35 Zellen
ab, alle in der Mappe mit den Erschließungsdaten der Expo. In allen 35 lag
`exceljs` falsch:

* **Ein zerbrochener Umlaut.** Aus „Brasilianische Tänzerinnen" wurde
  „Brasilianische T��nzerinnen". `exceljs` wandelte jeden Block des
  Datenstroms einzeln in Text um und zerschnitt so Zeichen, die über eine
  Blockgrenze reichen. In einer erzeugten Mappe mit 70.000 Zeilen traf es 7
  Zellen. Behoben mit einem `StringDecoder`; der Test baut eine Mappe, in der
  sicher ein Zeichen auf einer Grenze liegt.
* **22 Formeln mit dem Ergebnis 0** kamen als leere Zelle an.
* **12 Formeln mit Fehler** (`#REF!`) kamen als leere Zelle an. Jetzt steht dort,
  was auch Excel zeigt; eine Fehlerzelle ohne Formel lieferte schon bisher
  ihren Code.

In den übrigen Mappen fand der Vergleich weitere Fehler von `exceljs`, die in
den AVefi-Lieferungen bisher nicht vorkamen:

* In vier Mappen aus LibreOffice und in Mappen aus openpyxl fehlten die
  Blattnamen („Sheet1" statt „Novice"), und das Herauslösen einzelner
  Blätter scheiterte mit „nicht enthalten". openpyxl verweist mit absoluten
  Pfaden auf die Blätter (`/xl/worksheets/sheet1.xml`), die `exceljs` nicht
  zuordnete. Eine Mappe aus openpyxl ließ sich gar nicht öffnen.
* Formeln mit Datumsformat lieferten die Seriennummer („22382" statt
  „11.04.1961"), Wahrheitswerte aus Formeln „1" statt „true".
* Eingebetteter Text mit mehreren Formatläufen: nur der letzte Lauf.
  Lautschrift (`<rPh>`) ersetzte den Wert.
* `_xHHHH_`-Folgen (Excels Kodierung für Steuerzeichen) blieben stehen.
* Die Blätter kamen nach `sheetId` statt in der Reihenfolge der Registerkarten.

### Geschwindigkeit und Speicher

Gemessen mit einer Mappe aus 74.000 Zeilen in drei Blättern: Blattliste und
Herauslösen des großen Blatts so schnell wie mit `exceljs` (gut 3 Sekunden),
Speicher 129 statt 168 MB. Beim Herauslösen wird nur noch das gewählte Blatt
gelesen; `exceljs` musste die Mappe bis zum Ende durchlaufen.

### Nebenbei

* `deployment.md`, „Initialisierung": Wer den Seed mit den Abbildern aus dem
  Auslieferungsbau gegen eine leere Datenbank laufen lässt, braucht vorher
  `npm run migrate`. Beim Durchspielen aufgefallen; die Anleitung vom 28.10.
  sagte das nicht.

### Offen geblieben

* Die npm-Meldungen zu `glob@10` (über Nuxt) und `vue-i18n@10` (über
  `@nuxtjs/i18n`) bleiben, bis dort neue Versionen kommen.
* `.xls` und `.ods` werden weiterhin nicht gelesen.

Stand: 718 Tests in 62 Dateien grün, `npm run typecheck` ohne Befund,
Produktiv-Build und beide Abbilder geprüft.

---

## 2026-10-28 — Sven Bingert: frischer Klon startet nicht, Worker ohne Produktivabbild

Meldung von Sven Bingert (GWDG, Mail vom 27.10.), der von Elias Oltmanns das
Deployment übernimmt. Umgesetzt im Pull Request vom 28.10. auf dem Branch
`fix/deployment-frischer-klon`.

### Testbefehl und Compose-Aufbau scheitern in einem frischen Klon

**Gemeldet von Sven Bingert (27.10.).** Zwei Befehle aus der Anleitung schlugen
fehl: der Testbefehl mit `Could not resolve 'vitest/config'`, und `web` und
`worker` aus `docker-compose.dev.yml` mit `sh: nuxt: not found` bzw.
`sh: tsx: not found`. Beides ließ sich in jedem frischen Klon nachstellen.

Die Ursache war für beide dieselbe: Die Anleitung setzte ein installiertes
`node_modules` im Arbeitsverzeichnis voraus. Auf dem Testserver lag eines von
früher und verdeckte den fehlenden Schritt, deshalb fiel es dort nie auf.

* Der Testbefehl hängte den Klon ein, ohne zu installieren; `npx` holte sich
  ein fremdes vitest 5. Selbst mit Abhängigkeiten scheiterten ohne
  `nuxt prepare` alle Testdateien an der fehlenden `.nuxt/tsconfig.json`.
  Jetzt führt die Stufe `base` `nuxt prepare` aus, und getestet wird im Abbild:
  `docker build --target base -t avefi-importer:dev . && docker run --rm
  avefi-importer:dev npm test`. Ohne Docker gilt die Reihenfolge der CI.
* In `docker-compose.dev.yml` verdeckte der eingehängte Code das
  `node_modules` aus dem Abbild. Zwei anonyme Volumes (`/app/node_modules`,
  `/app/.nuxt`) halten es sichtbar. Folge: Nach einer Änderung an
  `package-lock.json` braucht es `up -d --build -V`.

Abnahmekriterium: Leistungsbeschreibung B.8, „Die Anwendung kann anhand der
bereitgestellten Dokumentation installiert, initialisiert, gestartet, gebaut und
getestet werden". Gewährleistung.

### Der Worker hatte kein Produktivabbild

Beim Durchgehen der Anleitung gefunden. Die Doku sagte, der Worker laufe im
Produktivbetrieb aus der Stufe `base`; ohne eingehängten Code startete er dort
nicht, weil `#shared/*` ohne `.nuxt` nicht aufzulösen war. Neu ist die Stufe
`worker`: nur Laufzeitabhängigkeiten (`npm ci --omit=dev`), Serverquellen,
Schema, Start mit `npm run worker`, ohne dass eine Pipeline den Befehl setzen
muss. Die Weboberfläche (`production`) bleibt unverändert. Wie am 22.10.
gegenüber Elias angeboten, als Erweiterung.

Geprüft in einem frischen Klon gegen eine leere Datenbank: Beide Abbilder
bauen, die Anmeldung antwortet mit 200, der Worker arbeitet CSV-, XLSX- und
AVefi-Dateien ab.

### Höchstlaufzeit des Workers

`WORKER_MAX_UPTIME=0` beendete den Worker sofort, eine unbrauchbare Angabe
ergab still `NaN` und hob die Grenze auf. Jetzt heißt `0` „keine
Höchstlaufzeit", unbrauchbare Angaben fallen mit Warnung auf 600 zurück
(`server/worker/laufzeit.ts`, getestet). Das Abbild `worker` setzt `0`: Der
Selbstneustart ist eine Vorkehrung für eingehängten Code und würde unter
Kubernetes in `CrashLoopBackOff` laufen. Ohne Angabe bleibt es bei 600.

### Nebenbefunde

* **`.dockerignore` fehlte.** `COPY . .` nahm die `.env` mit Zugangsdaten und
  ein `node_modules` vom Rechner des Bauenden ins Abbild auf.
* **Die `NUXT_`-Warnung war veraltet und führte in eine Falle.** Die
  Oberfläche liest `process.env` zuerst, die Namen ohne Präfix funktionieren
  auch im gebauten Abbild. Wer nur die `NUXT_`-Form setzte, bekam dagegen einen
  Worker auf `avefi`/`avefi`, weil er nur `DB_*` las. Jetzt liest er beide
  (`server/db/config.ts`, getestet), und die Anleitung nennt die Namen ohne
  Präfix.
* **Widersprüche in der Doku:** `docker-compose.dev.yml` sei „nicht im Git"
  (liegt dort seit #23); es gebe kein Skript für das erste Konto
  (`npm run seed` gibt es); `abnahme.md` nannte eine `docker-compose.local.yml`
  als Liefergegenstand, die nicht im Repository liegt; Testzahlen (332, 627);
  `typecheck` mit 35 Befunden (läuft sauber); kaputter Link im Handbuch;
  `APP_DOMAIN`-Vorgabe; fester Containername `avefi_efi_conv`; Kopf von
  `db/schema.sql` mit dem PHP-Bot.
* **`AUTHORITY_ENABLED`:** Code, `.env.example` und Doku sagten aus, die
  Compose-Datei hatte `1` als Vorgabe. Jetzt überall aus. Die Demo behält die
  Normdaten über ihre `.env`.
* **Kaniko:** `test -x /sbin/tini` direkt nach `apk add` in allen Stufen. Fehlt
  `tini`, scheitert der Bau und nicht erst der Containerstart.
* Neuer Wächter `tests/betrieb/auslieferung.test.ts`: `.dockerignore`, die
  Stufen im Dockerfile, die Volumes in der Compose-Datei und der alte
  Testbefehl in der Anleitung.

Stand: 697 Tests in 61 Dateien, `npm run typecheck` ohne Befund, Produktiv-Build und beide
Abbilder geprüft.

### Offen geblieben

* Worauf die GWDG ausrollt (Podman Compose, Kubernetes, CD-Pipeline mit
  Kaniko): Frage an Sven und Elias. Danach lässt sich die Anleitung für den
  Produktivbetrieb weiter zuschneiden.
* Ein Testlauf meldete einmal einen Fehler, während parallel ein Produktivbau
  lief. Zwölf Läufe danach, vier davon parallel, waren grün; nicht nachstellbar.

---

## 2026-10-22 — Luca Wollny und Jasper Stratil: abgeschnittene Klappmenüs, Firefox, Format im Datensatzeditor

Live auf `https://avefiimporter.goo1.de`. Meldungen von Luca Wollny (#30, #31,
21.10.) und Jasper Stratil (#28, 13.10.). Umgesetzt in `e7f3014`,
Abhängigkeiten in `79bc117`.

### Zwei Fehler, eine Ursache: Regeln für Elemente, die es nicht mehr gab

`app.css` hatte Regeln für `#importsTable` und `#mappingApp`. Beide IDs gab es
seit der Neufassung auf Nuxt am 25.08. nicht mehr. Die Regeln griffen also fast
zwei Monate lang nicht — mit Kommentaren darüber, die genau die beiden Fehler
beschrieben, die sie verhindern sollten. Jetzt hängen sie als Klassen
(`.imports-table`, `.mapping-table`) an den Elementen selbst. Neu:
`tests/frontend/css-selektoren.test.ts` meldet jeden ID-Selektor in `app.css`,
für den es kein Element gibt; auf dem alten Stand schlägt er mit genau diesen
beiden IDs an.

### Konverterauswahl am unteren Rand abgeschnitten (#30)

**Gemeldet von Luca Wollny (21.10.).** Die Hülle der Zuordnungstabelle schnitt
unten ab (`overflow-y:hidden`), und die Konverterauswahl öffnete immer nach
unten. Gemessen in der letzten Spalte von Profil 8: Auswahl bis 764 px, Hülle
bis 740 px, auch durch Scrollen nicht erreichbar.

Jetzt schneidet die Hülle nicht mehr ab, und die Auswahl klappt nach oben auf,
wenn unten der Platz fehlt; reicht er auf keiner Seite, wird sie in der Höhe
begrenzt und rollt innen. Dieselbe Rechnung (`app/utils/klappplatz.ts`) nutzen
die Zielauswahl der Zuordnung und das Zeilenmenü der Importliste, das in der
letzten Zeile bisher unten aus dem Fenster lief. Nachgetestet in Firefox und
Chromium, deutsch, 1280×800: alle drei vollständig sichtbar.

### Importtabelle in Firefox zu breit (#31)

**Gemeldet von Luca Wollny (21.10.).** Ohne die feste Tabellenbreite richtete
sich die Tabelle nach ihrem Inhalt. Gemessen, deutsch: in Firefox bei jeder
Fensterbreite 1131 px Tabelle in 1084 px Hülle, die Aktionsspalte ragte 36 bis
132 px hinaus; in Chromium ab 1024 px abwärts ebenso. Dazu kam, dass sechs
Prozentspalten (88 %) plus 200 px für die Aktionen erst ab rund 1670 px
Tabellenbreite aufgingen. Jetzt feste Breite, der Dateiname nimmt den Rest,
unter 760 px rollt die Hülle. Nachgetestet von 820 bis 1920 px in Firefox und
Chromium: Die Tabelle passt, die Aktionsspalte hat ihre 200 px.

### Format im Datensatzeditor (#28)

**Gemeldet von Jasper Stratil (13.10.).** Auf der Exemplar-Ebene tauchte
`has_format` im Editor nicht auf; der Editor reichte es unsichtbar durch. Jetzt
gibt es eine Liste „Format" mit derselben nach Trägerklasse gruppierten Auswahl
wie am Ziel „Format (alle Trägerklassen)". Ein Wert, den keine Liste kennt,
bleibt stehen und wird gekennzeichnet; was sich nicht auflösen lässt, wird beim
Speichern nicht umgeschrieben. Tests: `tests/frontend/datensatz-format.test.ts`.

Der Abgleich des Zielkatalogs gegen den Editor fand sieben weitere Feldgruppen
auf Manifestations- und Exemplar-Ebene, die nur durchgereicht werden (weitere
Titel, Länge, Weblinks, Ereignisdaten). Die Bearbeitung einzelner Datensätze ist
laut Werkvertrag nicht geschuldet; festgehalten als nachgelagert in #32.

### Aus eigenem Antrieb

* **Abhängigkeiten:** vite 8.3.5 und launch-editor 2.14.2 (Dependabot-Hinweise
  vom 21.10.), innerhalb der bestehenden Versionsbereiche. Produktiv-Build
  geprüft. Offen bleiben braces und node-forge, für die es keine reparierte
  Fassung gibt.
* **CI von Elias:** Seit dem 16.10. testet und baut GitHub Actions jeden Push
  auf `main` und spiegelt danach nach GitLab. Auf der Demo nachgezogen.
* **Barrierefreiheit:** axe-Lauf im hellen Schema nach den Änderungen,
  58 Zustände, bestanden (kein Befund der Schwere „serious“ oder „critical“).

### Geschlossen

#24 (Elias: der Importer braucht kein `described_by`), #26, #27, #29
(nachgetestet von Jasper und Luca).

### Offen geblieben

* Nachtest #28, #30, #31.
* #28: ein Exemplar mit mehreren Formaten oder mehrere Exemplare (Elias).
* Weiterhin: technische Abnahme LP B, #10, #11, #20 (Werkart).

---

## 2026-10-12 — Luca Wollny und Jasper Stratil: Werteliste, Klammern, Formate

Live auf `https://avefiimporter.goo1.de`. Testrunde von Luca Wollny (Mail vom
01.10., Kommentare in #5 und #20) und Meldung von Jasper Stratil (Mail vom
12.10.). Umgesetzt in `3feece2`, Abhängigkeiten in `e4eef0c`.

### Die Werteliste bot Rohwerte an, die an ihrem Schritt nie ankommen (#26)

**Gemeldet von Luca Wollny (01.10.).** Stand vor „Werteliste zuordnen" ein
anderer Schritt, etwa „Aufteilen", zeigte die Tabelle trotzdem die Rohwerte der
Spalte. Wer „VHS + DVD" zuordnete, traf zur Laufzeit nie, weil dort „VHS" und
„DVD" einzeln ankamen; der Wert fiel in die Notiz und verschwand aus der
Vorschau.

Ursache: Dieselbe Frage — welche Werte kommen an diesem Schritt an? — hatte zwei
Antworten. Die Normdatenliste rechnete seit dem 26.08. die Kette bis vor den
Schritt, die Werteliste nahm die Stichprobe der Spalte. Jetzt beantwortet eine
Funktion (`stepInputs` in `runner.ts`) die Frage für beide, und ein Test hält
beide Listen auf derselben Kette gegeneinander. Zuordnungen auf Rohzeilen
erscheinen als verwaist; gelöscht wird nichts automatisch.

Dazu aus derselben Mail: Die Tabelle stand in einer schmalen Rasterspalte neben
den übrigen Parametern und lief in die Nachbarspalte. Sie nimmt jetzt die ganze
Breite; lange Werte werden gekürzt (die Ellipse griff auf einem Inline-Element
nie). Verwaiste Zeilen sind über die Fläche markiert statt über Deckkraft, die
den Kontrast unter 4,5:1 drückte. Abnahmekriterium: Leistungsbeschreibung B.3,
„Kontrollierte Vokabulare".

### „Unerwarteter Fehler" beim Konvertieren ohne Pflichtangabe (#29)

**Gemeldet von Luca Wollny (01.10., in #20).** Der Server antwortete mit
`start_blocked`, dafür gab es keinen Text. Und er brach ab, bevor er speicherte,
obwohl Zwischenstände genau in diesem Fall gespeichert werden sollen. Jetzt wird
gespeichert und nicht gestartet; die Meldung nennt Version und Grund. Schon vor
dem Klick steht unter dem Knopf, was fehlt. Der Knopf bleibt bedienbar.

Der Wächter `meldungscodes.test.ts` prüfte nur Prüfcodes, nicht die Codes, mit
denen die API Fehler meldet. Neu: `fehlercodes.test.ts` verlangt für jedes
`fail(status, 'code')` einen Text in beiden Sprachen. Er fand zwei Lücken:
`start_blocked` und `label_too_long`.

### Klammerzusätze ohne regulären Ausdruck (#27)

**Wunsch von Luca Wollny (01.10.).** Neuer Konverter „Klammerzusätze entfernen"
(`strip_brackets`), runde, eckige oder beide. Verschachtelte Klammern
verschwinden ganz; der Ausdruck aus der Mail ließ sie halb stehen. Ein vollständig
eingeklammerter Wert bleibt unverändert, damit der Konverter die
Archivtitel-Regel aus #5 nicht unterläuft. Nicht vertraglich geschuldet,
Kulanz.

### Format über alle Trägerklassen (#28)

**Gemeldet von Jasper Stratil (12.10.).** In `MDW_Export_Avefi_Test_1.xlsx`
stehen Video, DVD und Datei gemischt in einer Spalte; zuordnen ließ sich nur je
Klasse. Neues Ziel „Format (alle Trägerklassen)": Die Werteliste zeigt alle
sechs Klassen gruppiert, im Profil steht `Klasse:Wert`. `DV` steht im Schema bei
Video und bei Datei und wird ohne Klasse beanstandet, nicht geraten. Die sechs
Einzelziele bleiben. Rezept für die MDW-Spalte im Handbuch, Kapitel 7.

Offen ist die fachliche Frage an Elias, ob mehrere Träger ein Exemplar mit
mehreren Formaten sind (so schreibt es das Ziel) oder mehrere Exemplare.

### Aus eigenem Antrieb

* **Die sechs Format-Ziele hatten nie eine Übersetzung.** Die englische
  Oberfläche zeigte sie deutsch. Gefunden beim Bau von #28; neu prüft
  `zielbeschriftungen.test.ts` jedes Ziel des Katalogs in beiden Sprachen.
* **Abhängigkeiten:** 19 Dependabot-Hinweise, alle transitiv. undici 8.11.2,
  devalue 5.9.4, js-yaml 4.3.2, brace-expansion 1.1.21 / 2.1.7 / 5.0.12; nur
  innerhalb der bestehenden Versionsbereiche. Am Abend kamen zehn neue Hinweise
  dazu; nachgezogen sind shell-quote 1.12.0, source-map-js 1.2.2,
  postcss-selector-parser 7.1.6 und Vue 3.5.43. simple-git verlangt
  `@nuxt/devtools` in `^3`; es ist per `overrides` auf 4.0.2 gesetzt (samt
  `@simple-git/argv-parser` 2.0.1). Unbedenklich, weil die Devtools in
  `nuxt.config.ts` abgeschaltet sind. Offen bleiben braces und node-forge (über
  das i18n-Plugin und die Nuxt-CLI): Beide stehen auf der neuesten
  veröffentlichten Version, einen Fix gibt es noch nicht.
* **Testdatensatz geklärt:** Matti Stöhr hat am 01.10. bestätigt, dass die
  bereinigte Paderborner Kopie maßgeblich ist. `src/docs/abnahme.md` ist
  angepasst.

### Offen geblieben

* Nachtest #26 bis #29 (Luca Wollny, Jasper Stratil).
* #28: ein Exemplar oder mehrere (Elias Oltmanns).
* Weiterhin: technische Abnahme LP B, #10, #11, #20 (Werkart), #24.

---

## 2026-09-30 — Stefan Stretz, Jasper Stratil, Sabrina Klewitz, und was die Prüfung wirklich prüft

Live auf `https://avefiimporter.goo1.de`.

### Der Prüfbericht spricht die Sprache der Oberfläche (#10)

**Gemeldet von Stefan Stretz (29.09.).** Vier Punkte: Der Wächtertest erfasste
nur Codes mit Punkt; `IssueList.vue` zeigte `issue.message`, also den deutschen
Serversatz; `DiagnosticsList.vue` ebenso, und die Parser-Meldungen hatten gar
keinen Code; im Zuordnungseditor drei weitere Stellen. Alle vier stimmten. Die
Zweigansicht (`check.message`) und der Datensatzeditor hatten denselben Fehler,
ohne dass er gemeldet war.

Jetzt baut `useMeldungstext` jeden Satz aus Code und Bausteinen, mit der
Variante nach der Art der Verletzung und dem deutschen Satz als Rückfall. Die
Codes ohne Punkt haben Sätze in beiden Sprachen, die Diagnose hat Codes mit Satz
und Hinweis. Was ein fremdes Werkzeug gesagt hat (Pydantic, jsonschema,
efi-conv, Parser), steht eingeklappt als „Wortlaut des Prüfwerkzeugs“ daneben.
Der neue Wächter `berichtscodes.test.ts` liest die Codes aus dem Quelltext und
aus `service.py`. Berichte von vor diesem Stand tragen keine Bausteine; dort
bleibt es beim deutschen Satz, statt Lücken zu zeigen. Commit `e157c7e`.

B.8 der Leistungsbeschreibung.

### Die Zusatzregeln von efi-conv liefen nie (aus eigenem Antrieb)

`service.py` rief `has_invalid_date`, `has_invalid_value` und
`exceeds_field_limit` mit einem `dict` auf. Die Regeln erwarten ein Modell und
warfen bei jedem Satz, und `except Exception: pass` verschluckte das. Ein
umgekehrter Zeitraum wie `1990/1980` galt deshalb als gültig, während
`efi-conv check` ihn ablehnt.

Beim Reparieren zeigte sich, dass auch die Schemaprüfung nichts prüft: Die
Wurzel des AVefi-JSON-Schemas legt für einen einzelnen Satz nichts fest. So ist
es auch in efi-conv; dort prüft in Wahrheit das Laden als Pydantic-Modell.
`/check` macht es jetzt genauso: Jeder Satz wird geladen, Ladefehler sind
Fehler (`model_invalid`), danach laufen die Regeln (`rule_*`). Gemeldet an
Elias in AV-EFI/efi-conv#39. Commit `d697ae3`.

Nebenbei gefunden: Befunde am ersten Knoten einer Zeile, meist am Werk, nannten
die Zeile davor. Die Zuordnung Prüfsatz → Zeile schlug zuerst 0-basiert nach
und traf bei der 1-basierten Tabelle den vorigen Satz.

Der Sidecar läuft jetzt mit efi-conv nach dem Merge von PR #34 (`5de9501`).

### Archivtitel von Hand gewählt, Klammern blieben stehen (#5)

**Gemeldet von Jasper Stratil (24.09.), nach dem Schließen.** Wer „Archivtitel“
von Hand wählte, bekam kein Angebot, die Klammern abzuschneiden, und der
Erstvorschlag unter einer eingeklammerten Spalte war „Haupttitel“. Jetzt bietet
der Editor am Archivtitel „Klammern abschneiden“ an, und bei durchgehend
eingeklammerten Spalten nennt schon der Erstvorschlag den Archivtitel.
Ausgeführt wird beides erst auf Klick. Commit `3007aa5`.

Dabei fiel auf, dass der Umwidmungsvorschlag mit `capture` herauslöste. Ein
Profil hängt an der Kopfzeile, nicht an der Datei: Am 23.09. wurde der
Vorschlag mit einer Kopie der Paderborner Datei in **Profil 8** angenommen,
dem Abnahmeprofil der Nutzertests. Auf die Originaldatei angewandt, wurde
damit jeder Haupttitel leer. Der Schritt ersetzt jetzt, statt herauszulösen
(`3a10897`). Profil 8 ist auf den Inhalt von Version 70 zurückgesetzt (neue
Version 72); Version 71 bleibt im Verlauf.

### Test 3 im Pad (Sabrina Klewitz, Filmmuseum Potsdam)

**Gemeldet über Jonas Pitz (28.09.).**

* **„/“ in der Signatur wurde als Trennzeichen vorgeschlagen.** An Kennungen
  schlägt der Editor kein Aufteilen mehr vor. Bei AVefi-PIDs (`21.11155/…`) hätte
  es sonst jede Zeile getroffen.
* **Das ✕ am Konverter.** Es entfernte den Konverter, sah aber aus wie
  „Schließen“. Jetzt steht „Entfernen“ da, und danach bis zur nächsten Änderung
  „Rückgängig“.
* **Titel und Artikel in zwei Spalten.** „Spalten verbinden“ steht wieder im
  Konverterkatalog; Rezept im Handbuch. Die Ordnungsform (`has_ordering_name`)
  ist als nachgelagert in #25 festgehalten.
* **Die datenhaltende Institution ließ sich nicht zuordnen.** Sie wird im
  CSV-Weg überhaupt nicht ins JSON geschrieben. Frage an Elias in #24.

Commit `3007aa5`.

### Rest aus #9

**Gemeldet von Stefan Stretz (29.09.).** `editorAktion` nutzte den
Editor-Endpunkt ohne `useApi()`, weil der Server ihn mit festem `/api/`
schickte. Der Endpunkt ist jetzt relativ zur API-Basis. Commit `3007aa5`.

### a11y-Lauf vom 30.09. (aus eigenem Antrieb)

Nach den Änderungen am Editor im hellen Schema neu gelaufen, 58 Zustände,
bestanden. Auf dem Weg dahin drei Befunde:

* **Die Auswahlliste der Ziele** (`TargetSelect.vue`) meldete
  `aria-required-parent` für jede Option. Die innere `<ul>` jeder Ebene hatte
  die implizite Rolle „list“, damit standen die Optionen in einer Liste statt in
  ihrer Gruppe. Jetzt `role="none"`. Aufgefallen ist es erst jetzt, weil der
  Lauf die Zuordnungsseite des neuesten Imports öffnet, und der hatte diesmal
  noch keine Zuordnung.
* **Ein falscher Kontrastbefund** (1,36:1) an einem Knopf, dessen oberen Rand
  das geöffnete Zeilenmenü verdeckte. Die Prüfung sah nur auf die Mittellinie.
  Sie prüft jetzt auch oben und unten und misst teilweise verdeckte Stellen
  nicht mehr.
* **Selbst verursacht:** Zwei neue Diagnosehinweise enthielten „& < >“.
  `unplugin-vue-i18n` hält das für HTML und bricht ab. Im Entwicklungsbetrieb
  lag deshalb von etwa 14 bis 16:45 Uhr die Fehlerseite von Vite über der
  Demo. Behoben in `99641d5`. `tests/frontend/uebersetzungen.test.ts`
  übersetzt seitdem jede Nachricht so, wie der Bau es tut.

### Offen geblieben

* **Welche Datei ist der vereinbarte Testdatensatz?** Mit der Originaldatei
  `UPB_Archivliste_Lehrfilme_Auswahl_AVefi_2026-08-04.csv` (77 Zeilen) lehnt
  `efi-conv check` ab: Die Signatur 3000040K kommt doppelt vor (Zeilen 61/62,
  65/66). Die bereinigte Kopie (75 Zeilen) besteht, und zwei Läufe mit Profil 8
  ergeben dasselbe JSON. Das ist eine Frage an die TIB, kein Fehler der
  Anwendung. Einzelheiten in `src/docs/abnahme.md`.
* #11: der menschliche Nachtest mit Tastatur und Screenreader (Elias).
* #24: `described_by`, wartet auf Elias.

---

## 2026-09-23 — Stefan Stretz, Jasper Stratil und ein a11y-Lauf, der etwas fand

Live auf `https://avefiimporter.goo1.de`.

### API-Zugriffe liegen jetzt vollständig in Services und Composables (#9)

**Gemeldet von Stefan Stretz (15.09.).** Die fünf ursprünglich beanstandeten
Dateien waren umgestellt, das Muster aber nur gewandert: 27 Aufrufe von
`useFetch` in 24 Pages und Layouts.

Unsere Rückfrage vom 18.09. hatte zwei Wege zur Wahl gestellt: `useFetch` in der
Seite mit Adressen aus dem Service, oder `$fetch` im Service ohne
Serverrendern. Das war eine falsche Wahl, denn es gibt einen dritten Weg.
Fachliche Composables in `app/composables/` (`useImporte`, `useDatensaetze`,
`useZuordnungen`, `useReviews`, `useKonten`, `useDoku`, `useSystem`) rufen
`useFetch` selbst auf. Sie laufen ebenso im Setup, das Serverrendern bleibt,
und in Pages, Layouts und Komponenten steht kein `useFetch`, kein `$fetch` und
keine feste `/api/`-Adresse mehr. Die Services bleiben die Stelle für
Adressen, Antwortformen und schreibende Aufrufe.

Jede Abfrage trägt einen ausdrücklichen Schlüssel aus Bereich und Adresse
(`importe:/api/imports/…`). Nachgeprüft im Serverrendern der Demo: Die Daten
kommen mit der Seite, auch bei Suche und Blättern in den Datensätzen.

`tests/frontend/abfragen.test.ts` liest den Quelltext von Pages, Layouts,
Komponenten und Middleware und schlägt fehl, sobald dort wieder ein Aufruf
auftaucht.

Dabei gefunden:

* **Das Layout rief `/api/system/vorgabewerte` mit fester Adresse auf**, an
  `useApi()` und damit an der konfigurierbaren API-Basis vorbei. Jetzt über
  `services/system.ts`.
* **Die Begründung in `services/doku.ts` stimmte nicht.** Dort stand, ein
  `useFetch` in einem Helfer teile sich zwischen zwei Seiten den
  Zwischenspeicher. In Nuxt 4 wird der Schlüssel aber aus Aufrufstelle,
  Adresse und Abfrage gebildet. Genau diese Annahme hatte zur falschen Wahl in
  der Rückfrage geführt.
* `recordsService().konfiguration()` war eine ungenutzte Kopie von
  `konfigurationPfad()`. Entfernt.
* Das README nannte als bekannte Einschränkung 35 offene Befunde von
  `npm run typecheck`. Der Typecheck läuft inzwischen ohne Befund, der Hinweis
  ist entfernt.

### Titel in eckigen Klammern (#5)

**Bestätigt von Jasper Stratil (23.09.)** mit einer neuen Datei: Zuordnung zum
Archivtitel und Abschneiden der Klammern funktionieren. Geschlossen.

### Der erweiterte a11y-Lauf, einmal komplett gegen die Demo (#11)

Mit `aa0f0d1` gebaut, am 23.09. zum ersten Mal ganz durchgefahren: 107
Zustände, breit und schmal (390 × 844), helles und dunkles Schema. Die
Prüfungen am Aufklappknopf der schmalen Navigation (`aria-expanded`,
erreichbares Ziel) sind bestanden.

**Gefunden: 57 Kontrastbefunde, alle im hellen Schema und alle an derselben
Stelle.** Es ist der Nebentext im Hinweisstreifen der Startprüfung aus #19. Der
Streifen erscheint nur für Administratoren, solange die Startprüfung etwas
findet, also auf der Demo auf jeder Seite. `.dim` lag auf dem getönten Grund bei
4,44:1 statt der verlangten 4,5:1. Der Nebentext in Hinweiskästen nimmt jetzt
die Grundschrift und setzt sich über das Gewicht ab.
Danach lief das helle Schema noch einmal komplett durch: 58 Zustände, kein
Befund ab „serious“.

Warum das bis jetzt niemand gesehen hat: Den Streifen gibt es seit dem 09.09.,
und seitdem ist der Lauf nicht mehr mit einem Verwaltungskonto gefahren.

Für den Lauf gab es vorübergehend ein eigenes Konto (`a11y-lauf@goo1.de`, mit
Verwaltungsrechten, weil „Konten" zum Prüfumfang gehört). Es wurde direkt
danach gelöscht. Weiterhin offen ist der Tastatur- und Screenreader-Nachtest
durch einen Menschen.

---

## 2026-09-14 und 15 — Elias Oltmanns und Stefan Stretz, umgesetzt am 18.09.

Commits `966c782`, `7712d8f`, `b8105fb`, `aa0f0d1`. Nachgetragen am 23.09.;
die Einzelheiten stehen in den Commits und Issues.

* **Pflichtfelder aus dem Schema (#20, #21, Elias Oltmanns).** `has_primary_title`
  und `type` sind am `WorkVariant` Pflicht. Die TypeScript-Abbildung des
  Schemas verliert das, das JSON-Schema führt es korrekt. Drei Stellen im Code
  zählten Pflichtfelder von Hand, die Funktion, die sie aus dem Schema gelesen
  hätte, wurde nie aufgerufen. Jetzt gibt es eine Liste (`pflichtfelder.ts`),
  die ein Test gegen das Schemadokument hält. Eine fehlende Werkart wird in der
  Zuordnung angemahnt.
* **Zwölf Meldungscodes ohne Übersetzung (#10, Stefan Stretz).** Gemeldet waren
  drei, nachgezählt neun, dazu zwei neue. Ein Test liest die Codes aus dem
  Quelltext und verlangt für jeden einen Text in beiden Sprachen.
* **`docker-compose.dev.yml` fehlte im Repository (#23, Elias Oltmanns).** Die
  allgemeine Fassung liegt jetzt im Repo, alles Geheime kommt aus `.env`.
  Ohne `DB_PASS` und `SESSION_SECRET` startet Compose nicht.
* **Der a11y-Lauf prüft auch die schmale Darstellung (#11, Stefan Stretz).**

---

## 2026-09-10, nachmittags — Luca Wollny, ein Titel, den niemand vermisste

Commits `9fc75ef` (Titel), `8176d6b` (Umzug und Zugangsdaten).
Live auf `https://avefiimporter.goo1.de`.

An diesem Tag ist das Repository an die Organisation **AV-EFI** übergegangen und
öffentlich geworden. Es liegt jetzt unter
[`AV-EFI/avefi-importer`](https://github.com/AV-EFI/avefi-importer).

### Eine Konvertierung ohne jede Titelangabe galt als beanstandungsfrei

**Gemeldet von Luca Wollny (10.09., 13:21),** Pad unter „Test 1.1".

Der zweite Teil seiner Beobachtung führte in die Irre, und das war der
eigentliche Fund. Er schrieb, im Gegenfall — Zeilen mit Werks- oder
Manifestfeldern, aber ohne Exemplarinhalt — greife die Validierung korrekt. Die
Meldung dort ist aber `no_items_associated` aus dem satzübergreifenden
Durchgang, also das **fehlende Exemplar**. Der fehlende Titel wurde in keinem
der beiden Fälle beanstandet.

Nachgeprüft gegen den laufenden Prüfdienst: **Das AVefi-Schema verlangt
`has_primary_title` am `WorkVariant` nicht.** Ein Werk ohne jeden Titel kommt
mit `ok=true` zurück, allein und im Verbund mit Manifestation und Exemplar.

Die Anwendung wusste es besser und sagte es an der falschen Stelle.
`completenessIssues` stuft den Fall als Fehler ein und färbt seit #15 die
Kernfeld-Plakette rot — nur speiste das den Datensatz-Editor und die Liste, nicht
den Prüfbericht. Auf derselben Seite stand die Belegungsstatistik „Haupttitel
0 von N" neben der Plakette „keine Beanstandungen".

Behoben an beiden Enden. Der Zuordnungseditor zählt jetzt je Ebene, ob ein Ziel
gemappt ist, das den Haupttitel füllt: am Werk ist gut, nur an Manifestation
oder Exemplar bleibt die bisherige Warnung, nirgends ist ein Fehler und sperrt
„Speichern und konvertieren" — Speichern bleibt erlaubt, weil ein Zwischenstand
ohne Titel eine normale Etappe beim Aufbau einer Zuordnung ist. Und nach der
Konvertierung wandern die Vollständigkeitsfehler mit Zeilennummer in den
Bericht; der Import ist dann nicht mehr „validiert". Issue #20.

Dabei fiel ein zweiter, älterer Fehler weg: Die Prüfung zählte nur
`work.title.primary`, obwohl `work.title.supplied` („Archivtitel") dasselbe Feld
füllt. Wer nur den Archivtitel mappte, bekam die Meldung, es fehle ein
Haupttitel.

**Abnahmekriterium:** betrifft die Validierung der gemappten Daten.

### Jede Beanstandung sagt jetzt, welche Regel sie erhebt

**Aus eigenem Antrieb, als Folge desselben Befunds.** Der Prüfbericht mischt
vier Quellen: das AVefi-Schema, den satzübergreifenden Durchgang, die
Vollständigkeit und die Konvertierung. Die ersten beiden prüft der Dienst
`efi-conv` gegen das Schema des Verbunds, die letzten beiden sind Regeln dieser
Anwendung.

Der Unterschied ist keine Förmlichkeit. Ein Werk ohne Haupttitel ist
schemakonform; dass wir es trotzdem beanstanden, ist unsere Entscheidung. Stünde
sie ohne Kennzeichnung im Bericht, sähe sie aus wie eine Vorgabe des Verbunds,
und eine Diskussion darüber liefe mit dem falschen Argument.

Ob `has_primary_title` im Schema verpflichtend werden sollte, steht als Frage an
Elias Oltmanns in Issue #21.

### Das Beispielpasswort in der Anleitung war der echte Zugang

**Folge des Übertrags.** `docs/barrierefreiheit.md` nannte an vier Stellen ein
Verwaltungskonto samt Passwort als Beispiel für die Barrierefreiheitsläufe,
mitsamt der Adresse der laufenden Instanz. Mit dem Übergang an die AV-EFI wurde
das Repository öffentlich.

Beide Werkzeuge lesen die Anmeldung jetzt aus der Umgebung, und die Anleitung
zeigt `read -s` statt einer Zuweisung — so landet das Passwort weder auf dem
Bildschirm noch in der Verlaufsdatei der Shell. Der Test dazu hat sich umgedreht:
Er verlangte bisher, dass die Beispielwerte in der Prüfliste stehen, und
verlangt jetzt, dass in der Anleitung überhaupt keiner mehr steht.

Das Passwort auf der Instanz selbst zu ändern liegt bei der Organisation, die
sie übernimmt.

### Aus eigenem Antrieb

**Die Adresse des Repositorys** in `handbuch/01-installation.md`, `abnahme.md`
und in diesem Protokoll auf den neuen Pfad gezogen. Die zweite Stelle war die
unangenehme: Ein Abnahmedokument, das den Liefergegenstand „Vollständiger
Quellcode" mit einer Adresse benennt, unter der er nicht mehr liegt, ist an
genau der Stelle unbrauchbar, an der es gebraucht wird.

**Issue #12 geschlossen.** Elias Oltmanns hat die Kleinschreibung in `UnitEnum`
upstream übernommen; damit sind Anwendung und Message-Katalog des Verbunds
deckungsgleich und unsere letzte Ausnahme entfällt.

### Offen geblieben

**`docs/oberflaeche/` kennt die Herkunftsangabe im Prüfbericht noch nicht.** Die
Beschreibungen sind vom Vormittag, Stand `cfb363b`. Beim nächsten Durchlauf
mitziehen.

**Die Berichte der bestehenden Importe werden nicht nachgerechnet.** `report_json`
hält den Stand des Laufs, und das soll so bleiben — ein Bericht sagt, was beim
Lauf herauskam. Lucas beide Importe vom Vormittag zeigen ihr altes Ergebnis, bis
jemand „Neu konvertieren" anstößt.

**Das Wiki des Repositorys ist leer und eingeschaltet.** Die Dokumentation liegt
vollständig in `src/docs/`, weil sie zum Werk gehört, mit dem Code versioniert
ist und von `tests/doku` geprüft wird. Ein leeres Wiki im Menü ist eine
Einladung, sie ein zweites Mal anzulegen. Abschalten braucht Rechte an der
Organisation.

**Die Runden vom 02.09. und 07.09.** fehlen weiterhin in diesem Protokoll.

---

## 2026-09-10 — Jasper Stratil und Elias Oltmanns, ein fehlender Menüpunkt und ein echtes Passwort

Commits `2312b5c` (Menüpunkt), `8dbbb10` (Herkunft), `e6b2ca6` (Vorgabewerte).
Live auf `https://avefiimporter.goo1.de`.

### „Zuordnung ansehen" wurde nicht angezeigt

**Gemeldet von Jasper Stratil (09.09., 18:52), im Anschluss an Issue #6.** Die
Aktion fehlte im Menü der Importe-Seite. Der Import war konvertiert, die Seite
existierte, der Menüpunkt war verborgen.

Die Bedingung fragte `hasMapping`, und das war nichts anderes als
`mapping_profile_id !== null`. Diese Spalte beantwortet die Frage nicht. Sie ist
leer, wenn über ein Formatprofil konvertiert wurde — MARC-XML, AVefi-nativ, aber
auch CSV auf diesem Weg —, und sie ist gefüllt, wenn im Zuordnungseditor
gespeichert wurde, ohne zu konvertieren. Neun fertig konvertierte Importe waren
betroffen, darunter beide SLUB-Lieferungen und zwei CSV-Dateien.

Entschieden wird jetzt über `tabular`, so wie `ImportTable.vue` es beim
„Zuordnen"-Knopf schon tat. Der Menüpunkt heißt im Zustand „Zuordnung nötig"
jetzt „Zuordnen" und sonst „Zuordnung ansehen"; #6 hatte die Benennung als
mitverantwortlich benannt. `hasMapping` ist aus der Nutzlast entfernt, damit die
Verwechslung nicht wiederkommt. Issue #17.

**Abnahmekriterium:** berührt die Nachvollziehbarkeit des Ergebnisses aus #6.

### Für MARC-XML und AVefi-nativ gab es die Antwort weiterhin nicht

**Aus eigenem Antrieb, im Anschluss an dieselbe Meldung.** Der Menüpunkt bleibt
bei nicht-tabellarischen Formaten zu Recht verborgen — dort gibt es keine
Spaltenzuordnung. Jaspers eigentliche Frage aus #6, wie ein Ergebnis zustande
kam, blieb für diese Formate damit unbeantwortet. Genau diese Formate hatte er
zuletzt getestet.

`convert.ts` schreibt seit Längerem nach jedem Lauf ein `run_config` in die
Importzeile: Profilversion, AVefi-Schemaversion, Trennzeichen,
Normdateneinstellungen, Zeitpunkt. **Gelesen wurde die Spalte nirgends.** Kein
Endpunkt gab sie aus, keine Seite zeigte sie.

Neu ist ein Abschnitt „Herkunft des Ergebnisses" auf der Detailseite jedes
Imports, mit Formatprofil, Zuordnungsprofil samt verwendeter und heutiger
Version, Schemaversion, Trennzeichen, Normdaten und Zeitpunkt. Für
nicht-tabellarische Importe führt ein eigener Menüpunkt „Herkunft ansehen"
dorthin. Von dreiundzwanzig konvertierten Importen haben zehn ein `run_config`;
bei den übrigen steht „nicht aufgezeichnet", denn dass nichts mitgeschrieben
wurde, ist auch eine Auskunft. Issue #18.

Dabei fiel auf, dass `imports/[id]/index.get.ts` die heutige Profilversion nie
durchreichte. Auf der Detailseite war `stale` deshalb immer falsch.

**Abnahmekriterium:** „Veraltete Konvertierungsergebnisse nach Änderungen am
Mappingprofil werden als solche gekennzeichnet" galt bisher nur in der Liste,
nicht auf der Detailseite. Und die Kopplung des Ergebnisses an die
Konfigurationsrevision war zwar gespeichert, aber nicht sichtbar.

### Das Beispielpasswort aus der Dokumentation war das echte

**Ausgelöst durch Elias Oltmanns (09.09., 18:29).** Für die Übergabe des
Repositorys an die AV-EFI-Organisation wies er darauf hin, dass die Zugangsdaten
des Deployments im Repository stünden und vorher zu ändern seien.

Geprüft über die gesamte Historie: keine Tokens, keine Schlüssel, keine URL mit
eingebetteten Zugangsdaten, keine jemals eingecheckte `.env`. Der einzige Fund
war `docs/barrierefreiheit.md`, das an vier Stellen ein Verwaltungskonto samt
Passwort als Beispielanmeldung gegen die laufende Instanz nannte. Die Gegenprobe
antwortete mit HTTP 200 — das Beispiel war der echte Zugang. Dazu standen
`DB_PASS` und `SESSION_SECRET` beide auf ihrem Vorgabewert. Der Wert steht hier
bewusst nicht; das Protokoll ist oeffentlich.

Die Anleitung sagte das Richtige bereits: `deployment.md` schreibt zu `DB_PASS`
wörtlich „Die Vorgabe ist ein Entwicklungswert und gehoert ersetzt", und die
Tabelle der Umgebungsvariablen hat eine Pflicht-Spalte. Trotzdem lief die
öffentlich erreichbare Instanz wochenlang so. Mehr Dokumentation auf ein Problem
zu legen, das keines der Dokumentation war, hätte daran nichts geändert.

Die Anwendung prüft es jetzt beim Start selbst, abgestuft: `SESSION_SECRET` auf
einem Vorgabewert bricht den Start ab, aber nur unter `NODE_ENV=production` —
wer den Wert kennt, baut sich ein gültiges Sitzungscookie für jedes Konto. Bei
`DB_PASS` und bei einem Administratorkonto mit bekanntem Passwort bleibt es bei
einer Warnung im Protokoll und einem Hinweisstreifen, den nur angemeldete
Administratoren sehen. Neu ist außerdem der Abschnitt „Vor dem ersten
Produktivstart" in `deployment.md`. Issue #19.

`SESSION_SECRET` hatte drei verschiedene Platzhalter, verteilt auf
`nuxt.config.ts`, die Compose-Datei und `.env.example`. Alle drei stehen jetzt
in der Prüfliste, und zwei Tests lesen die Vorgabewerte aus den Quelldateien,
statt sie zu wiederholen.

### Offen geblieben

**Das Passwort der Demo-Instanz und `DEMO_PASSWORD` bleiben zunächst
unverändert.** Bewusste Entscheidung am 09.09.: Es ist eine Vorführinstanz mit
Testbeständen, und die Tester arbeiten gerade damit. Mit dem Übertrag an die
AV-EFI am 10.09. wurde das Repository öffentlich; das Ändern liegt seither bei
der Organisation, die die Instanz übernimmt. Aus der Dokumentation ist der Wert
entfernt (siehe Runde vom 10.09.), und für jede Produktivinstallation greift die
Startprüfung.

**`docs/oberflaeche/` ist nicht nachgezogen.** Die Beschreibungen sind aus der
laufenden Anwendung ausgelesen, Stand `6e89117`. Die neue Überschrift „Herkunft
des Ergebnisses", der Menüpunkt „Herkunft ansehen" und die geänderten
Beschriftungen stehen dort noch nicht. Nachziehen mit `tests/a11y/oberflaeche.mjs`
in einem Durchlauf, nicht einzeln von Hand.

**Nachgetragen am 10.09.:** die Runde vom 08.09., die hier nie eingetragen
worden war. Weiterhin offen sind die Runden vom **02.09.** (Jaspers Punkte,
Terminologie, Doku-Lücken) und vom **07.09.** (Umbau auf Services, Wächter,
Mappingkern mit Codes statt Sätzen). Beide sind überwiegend Umbau aus eigenem
Antrieb, aber der Nachweis gehört vollständig.

**`avefiSchemaVersion` enthält eine Adresse, keine Version.** `core/check.py` in
efi-conv holt das Schema vom `main`-Branch. Solange das so ist, sagt die Zeile in
der Herkunft nur, wogegen geprüft wurde, und eine Konvertierung ist nicht
reproduzierbar.

---

## 2026-09-08 — Matti Stöhr, Jasper Stratil, Elias Oltmanns, Jonas von Pitz und Stefan Stretz

Commits `1e73163` bis `bd39068`. Live auf `https://avefiimporter.goo1.de`.

Nachgetragen am 10.09.2026. Die Runde ist an dem Tag selbst nicht ins Protokoll
gekommen — vermerkt, weil eine Lücke im Nachweis selbst ein Befund ist.

### Gleichnamige Zeilen ließen sich nur am Zeitstempel unterscheiden

**Gewünscht von Matti Stöhr (Issue #1).** Läuft dieselbe Datei mehrmals, stehen
in der Liste gleichnamige Zeilen nebeneinander.

Neu ist ein Anzeigename **neben** dem Dateinamen, nicht statt seiner. Der
Dateiname ist die Verbindung zur Lieferung des Archivs; wer später fragt, aus
welcher Datei ein Datensatz stammt, braucht ihn. Neue Spalte `imports.label`,
gesetzt über `PATCH /api/imports/:id`, ein leerer Wert entfernt ihn wieder.
Commit `e56783d`.

### Bei über achtzig Importen findet man einen bestimmten nur durch Scrollen

**Gewünscht von Matti Stöhr (Issue #2).** Sortieren und Filtern über den ganzen
Bestand, die Auswahl steht in der Adresse und lässt sich weitergeben.

Beim Nachsehen kam ein Fehler dazu, den niemand gemeldet hatte: `listImports`
holte `LIMIT 200`, und die Seite zeigte alles davon — ohne Seitenzahlen und ohne
Hinweis. Wer 201 Importe hat, sieht 200 und erfährt es nicht. Mit einer
Sortierung wäre daraus ein echter Schaden geworden: „nach Dateiname" hätte die
200 alphabetisch ersten geliefert und den Rest verschwiegen. Die Antwort nennt
jetzt `total`, `loaded` und `shown`, und die Seite sagt es, wenn `loaded` unter
`total` fällt. Commit `b7be5d6`.

### Der Bericht sagte, was falsch ist, aber nicht, wie es richtig geht

**Gewünscht von Matti Stöhr (Issue #3),** festgehalten im Pad unter „Test 2 —
Matti Stöhr (TIB)" und im Termin am 01.09. als „Advisories weiter ausbauen"
wiederholt.

„»Betacam SP« ist kein zulässiger Wert für »Optischer Datenträger«" liest sich
wie ein Tippfehler im Wert; tatsächlich hängt die Spalte am falschen Ziel. Beim
ersten Befund je Zielfeld steht jetzt, was das Feld bedeutet und welche Werte es
annehmen darf — einmal je Feld, nicht bei jeder der zwanzig gleichartigen
Meldungen. Beschreibung und Werteliste kommen aus dem Zielkatalog und dem
Schemamodell; erfunden wird nichts. Commit `bd39068`.

Abgegrenzt bleibt die automatische Korrektur: vertraglich ausgeschlossen,
vorgeschlagen wird, nie angewandt.

### „Zuordnung ansehen" zeigte die heutige Profilfassung, nicht die verwendete

**Gemeldet von Jasper Stratil (Issue #6),** beim Test am 07.09.

Beim Nachsehen war es dieselbe Lücke von zwei Seiten. Am Profil bot der
Versionsverlauf nur „Zurücksetzen" an — man setzte also auf einen Stand zurück,
den man nicht kannte. Der Inhalt lag in `mapping_profile_versions` und war
nirgends sichtbar.

Neu ist eine eigene, unveränderliche Ansicht auf eine bestimmte Version:
`GET /api/mappings/:id/versions/:version` und `/mappings/:id/versionen/:n`. Die
Zuordnungsseite eines Imports sagt jetzt, mit welcher Version konvertiert wurde,
und zeigt die heutige daneben, wenn beide auseinanderfallen. Commit `2876909`.

**Abnahmekriterium:** „Veraltete Konvertierungsergebnisse nach Änderungen am
Mappingprofil werden als solche gekennzeichnet."

### Eckige Klammern am Titel: die Entscheidung gehört ins Profil

**Elias Oltmanns in Issue #5.** Wird der Vorschlag „Archivtitel" angenommen, sind
die Klammern Kennzeichnung und gehören weg. Wird er abgelehnt und der Wert bleibt
ein `PreferredTitle`, sind sie Bestandteil des Titels und bleiben stehen.

Das nimmt `cd75606` vom selben Tag zurück, wo das Abschneiden noch im Code stand.
Ob eine Klammer Kennzeichnung oder Titelbestandteil ist, ist keine Konvention,
sondern eine Entscheidung — und sie gehört dorthin, wo die Entscheidung fällt.
Commit `e7ce560`.

### Ein Datensatz ohne Haupttitel stand auf Gelb

**Gefunden von Matti Stöhr (Issue #15),** im Telefonat mit Elias am 08.09.
besprochen. Ein Datensatz aus Paderborn ohne jeden Haupttitel stand auf Gelb,
während direkt daneben „Pflichtangabe fehlt" in Rot stand.

Eine Anzeige war ihrer eigenen Legende davongelaufen. Die Plakette nannte seit
dem 31.08. benannte Felder („0 von 4"), die Farbe kam weiter aus dem Prozentwert,
und die Legende beschrieb noch die Prozentgrenzen. Drei Stellen, drei Aussagen.
Die Farbe folgt jetzt der Verbindlichkeit statt der Menge: rot, wenn ein
Pflichtfeld fehlt, gelb bei fehlenden Empfehlungen, grün bei allen vier
Kernfeldern. Welche Felder Pflicht sind, entscheidet `completenessIssues`, nicht
eine zweite Liste. Commit `21a391c`.

### Beim Zusammenfassen gewann stillschweigend die erste Zeile

**Aus dem Telefonat mit Elias Oltmanns am 08.09. (Issue #16).** Stimmen die zur
Werkbildung gewählten Spalten überein, sollte geprüft werden, ob die übrigen
gemappten Werksfelder das auch tun.

Der Ist-Zustand war genau der stille Fall. `mergeNode` ergänzt fehlende Felder,
vereinigt Listen und überschreibt Skalare nicht — bei einem Widerspruch hieß das:
Die erste Zeile gewinnt, kommentarlos. Welche „die erste" ist, hängt an der
Zeilenreihenfolge in der Datei und damit an nichts, was der Bearbeiter sehen
kann. Dieselbe Fehlerklasse wie der verdrängte Primärtitel aus `adb444d`, nur
eine Ebene höher: dort innerhalb einer Zeile, hier zwischen Zeilen.

Gemeldet wird nur, was verloren geht. Listen werden vereinigt, da verschwindet
nichts — zwei Zeilen mit verschiedenen Regisseurinnen ergeben ein Werk mit
beiden, und genau dafür fasst man zusammen. Commit `aa9c38a`.

### Die Beschriftungen sollen die des gedruckten FIAF-Katalogs sein

**Jonas von Pitz in Issue #12.** Alle Beschriftungen stammen aus der deutschen
Ausgabe des FIAF Cataloguing Manual, jeweils von der ersten Stelle, an der der
Begriff im englischen Original vorkommt. Aus Konsistenzgründen sollen die
Originalübersetzungen gelten.

Sein Argument ist besser als meins. Ich hatte für Verständlichkeit plädiert
(„Bild und Ton auf einem Träger" statt „Kombiniert"), er für Übereinstimmung mit
dem Katalog, den die Archivarinnen benutzen. Wer den Manual kennt, sucht
„Featurette", nicht „Mittellangfilm". 31 deutsche und 14 englische Beschriftungen
übernommen, über acht Vokabulare. Commit `020a15c`.

Vorher am selben Tag drei Beschriftungen aus der Gegenrichtung: Von 114 deutschen
Beschriftungen des Verbundkatalogs wichen 38 von unseren ab, übernommen sind die
drei, in denen der Katalog recht hat — „Archivtitel" statt „Gelieferter/
Entworfener Titel", „Transliterierter Titel" statt „Transkribierter Titel",
„Übernahmetitel" statt „Erwerbstitel". Der mittlere war ein Fachfehler von mir.
`model.schema.json` blieb dabei byte-identisch. Commit `3d57c23`.

### Der Zuordnungseditor kannte seine Einbaustelle

**Aus Stefan Stretz' Frontend-Abnahme (Issue #13).** `components/mapping/Editor.vue`
griff auf `useRoute()`, `route.query.spalte` und `navigateTo()` zu. Die Komponente
wusste damit, an welcher Stelle der Anwendung sie hängt, und ließ sich ohne diese
Stelle nicht verwenden. Stefan hat es ausdrücklich nicht als Abnahmemangel
eingestuft.

Beides sind jetzt Schnittstellen statt Annahmen: `initialColumn` und `@started`.
Die Adresszeile liest die Importseite, nicht der Editor. Commit `e493d56`.

### Aus eigenem Antrieb

**Alle dreizehn Titeltypen aus `TitleTypeEnum`** als Zielfelder, dazu die
Erkennung mehrteiliger Klammervorschläge, der Konverter „Nur wenn" als Wächter
über einem Zweig, die Zweigbilanz und die Meldung des verdrängten Primärtitels.
Commits `1e73163` bis `cd75606`.

**Handbuch nachgezogen** an Ampel und Zusammenfassen. Kapitel 3 nannte noch
„Vollständigkeit (Ring)" und „Rot unter 50 %". Kapitel 7 bekam dazu, was beim
Zusammenfassen mit widersprüchlichen Angaben passiert, samt dem Hinweis, der beim
Lesen der eigentliche Wert ist: Tragen zwei Zeilen denselben
Gruppierungsschlüssel, aber verschiedene Titel, meinen sie möglicherweise gar
nicht dasselbe Werk. Commit `0784909`.

**Zwei Sicherheitshinweise von GitHub** zu `uuid < 11.1.1` als transitive
Abhängigkeit von `exceljs`. `npm audit fix --force` hätte `exceljs` auf 3.4.0
herabgestuft, also genau die Bibliothek gebrochen, die unsere Excel-Dateien
liest. Ein Sicherheitshinweis ist kein Grund, eine Kernabhängigkeit um eine
Hauptversion zurückzudrehen. Stattdessen ein `overrides`-Eintrag, der `uuid`
hochzieht, ohne `exceljs` anzufassen. Der verwundbare Pfad liegt ohnehin im
Schreiben bedingter Formatierung; wir lesen. Commit `cf0bb80`.

---

## 2026-09-01 — Andreas Kasper, Sprungziele im Prüfbericht

Commits `26e0038` (Oberfläche, Handbuch) und `b6480a8` (Prüfung).
Live auf `https://avefiimporter.goo1.de`.

### Eine Beanstandung beschrieb die Stelle, führte aber nicht hin

**Gemeldet von Andreas Kasper (13:40).** Im Prüfbericht steht zu jeder
Beanstandung, wo sie sitzt — Zeile, Prüfsatz, Quellspalte, Schemafeld —, aber
es war Text. Wer den Fehler ansehen wollte, musste die Datensatzliste öffnen
und suchen. Ausdrücklicher Rahmen der Meldung: Die Tester finden die Seite gut,
also nur minimale Änderungen.

Zwei Angaben sind jetzt Sprungmarken. Die Zeile führt zu dem Datensatz, der aus
ihr entstanden ist; die Quellspalte führt in die Zuordnung und klappt die Spalte
dort auf. Das Listenbild bleibt sonst, wie es war: dieselbe Sortierung, dieselbe
Filterleiste, dasselbe Nachladen.

Die Zeile wird beim Lesen des Berichts zu einer Datensatznummer aufgelöst
(`SELECT id, source_row FROM records …`) und **nicht** in `report_json`
geschrieben. Eine gespeicherte Nummer zeigte nach dem nächsten „Neu
konvertieren" auf einen Satz, den es nicht mehr gibt.

Für die Spalte gab es die Mechanik schon: Der Zuordnungs-Editor kann seit dem
25.08. per `gotoColumn` zu einer Spalte springen, bisher nur aus seiner eigenen
Prüfleiste heraus. Er nimmt jetzt zusätzlich `?spalte=…` aus der Adresse entgegen.

### „Datensatz 159" meinte nie den Datensatz 159

**Aufgefallen bei derselben Meldung.** Die Facette hieß „Datensatz", zeigte aber
die Position im Prüfbestand: Je Zeile entstehen ein Werk, eine Manifestation und
ein Exemplar, aus Zeile 53 werden also die Prüfsätze 157 bis 159. In der
Oberfläche heißt „Datensatz" dagegen die Zeile in `records`. Ein Link auf diese
Zahl hätte auf einen fremden Satz gezeigt.

Die Facette heißt jetzt **Prüfsatz**. Für die Kommandozeile mit `efi-conv check`
ist die Nummer weiter nützlich, zum Auffinden im Importer ist es die Zeile.
Querverweise in den Meldungen nennen ab sofort die Zeile: statt „kommt auch in
Datensatz 162 vor" steht „kommt auch in Zeile 54 vor". Wirkt auf neue
Konvertierungen; bereits erzeugte Berichte behalten ihren Text.

### Lösungshinweis je Beanstandung, und das Handbuch in der Anwendung

Beim ersten Auftreten einer Kennung steht jetzt eine Zeile, was zu tun ist, mit
Verweis ins Handbuch. Einmal je Kennung, nicht an jeder Meldung: Bei zwanzig
gleichartigen Hinweisen wäre derselbe Satz zwanzigmal die längere, nicht die
verständlichere Liste. Der Katalog liegt in den Übersetzungen
(`imports.advice.*`, deutsch und englisch) und deckt die acht Kennungen ab, die
im Betrieb vorkommen. Fehlt eine, erscheint keine Hinweiszeile — nie ein leerer
Kasten.

Das Handbuch lag im Wurzelverzeichnis des Repositoriums und war für die
Anwendung damit unsichtbar: In den Container gemountet ist nur `src/`. Es liegt
jetzt unter `src/docs/handbuch/` und ist unter `/dokumentation/handbuch` lesbar,
über dieselbe Mechanik wie die Oberflächenbeschreibungen (`doku/rubrik.ts`, von
beiden Rubriken geteilt). Überschriften tragen Kennungen, damit ein Verweis auf
einen Abschnitt zeigen kann; Umlaute werden dabei umschrieben, und
gleichlautende Überschriften werden durchgezählt — zwei gleiche `id`-Werte auf
einer Seite wären ein Barrierefreiheitsfehler. Kapitel 3 hat einen neuen
Abschnitt „Beanstandungen und ihre Behebung" mit einer Unterüberschrift je
Kennung. `tests/a11y/axe.mjs` prüft die neuen Seiten in beiden Farbschemata mit.

### 107 Fehler, die es nicht gab: die Prüfung sah immer nur 500 Sätze

**Aus eigenem Antrieb, beim Lesen des Prüfcodes gefunden.** Drei Regeln des
Prüfdienstes gelten über die ganze Lieferung: Eindeutigkeit der Kennungen,
auflösbare Verweise, und dass zu jeder Manifestation ein Exemplar gehört. Sie
liefen in `/check` mit, und `/check` wird in Bündeln zu 500 Sätzen aufgerufen.
Jede Regel sah also nur einen Ausschnitt.

Nachweisbar an `20240829_ItemExport_1.csv` (9.630 Sätze, 20 Bündel): 43
`dangling_reference` und 32 `no_items_associated`, zusammen **alle 75 Fehler
dieses Imports**. Sie saßen sämtlich direkt hinter einer Bündelgrenze — 501 bis
506, 1010 bis 1012, 1515, 2016, 2517 bis 2520 und so fort. Die Manifestation lag
in Bündel 2, ihr Werk in Bündel 1, also „zeigt auf keinen Datensatz dieser
Lieferung". Umgekehrt blieb eine doppelt vergebene Kennung unentdeckt, wenn ihre
beiden Träger in verschiedenen Bündeln standen.

Die drei Regeln sind aus `/check` heraus und in einen eigenen Endpunkt
`/crossref` gewandert, der **einmal** über den gesamten Bestand läuft. Damit das
in eine Anfrage passt, bekommt er eine reduzierte Sicht: `category`,
`has_identifier` und die vier Verweisfelder. Bei 9.630 Sätzen sind das wenige
hundert Kilobyte statt zweistelliger Megabyte. Die Auswahl der Felder ist eine
Feldauswahl im Worker, keine zweite Umsetzung der Regel — gelesen und beurteilt
wird weiter in `efi-conv/service.py`.

`convert.ts` bündelt eine Ebene höher noch einmal und sammelt die reduzierte
Sicht deshalb über den ganzen Import mit; geprüft wird sie nach dem letzten
Bündel. Die Zahl der gültigen Sätze wird seitdem über eine Menge beanstandeter
Prüfsätze gebildet statt über eine Summe je Bündel: Derselbe Satz kann in seinem
Bündel und noch einmal im Querlauf beanstandet werden, und zweimal abgezogen
ergäbe zu wenig gültige Sätze.

Beide betroffenen Importe wurden neu konvertiert. Vorher je 9.555 gültig, 75
Fehler; nachher **9.630 gültig, 0 Fehler**. `tests/pruefung/querlauf.test.ts`
nagelt fest, dass `/check` gebündelt und `/crossref` genau einmal über alles
aufgerufen wird.

### Offen geblieben

- Der Import `0a67d79e` (UPB-Archivliste) ist **nicht** neu konvertiert worden —
  die Tester arbeiten daran. Sein Bericht zeigt die Sprungmarken und die
  Hinweiszeilen, in den Meldungstexten steht aber weiter „Datensatz 162" statt
  „Zeile 54". Ein „Neu konvertieren" räumt das auf.
- Das Handbuch stammt aus der PHP-Fassung. Kapitel 1 und 6 sind überholt, und
  Kapitel 3 nennt an einer Stelle noch `/imports/<uuid>/details` und
  `AvefiMapper`. Der neue Abschnitt ist auf dem Stand, der Rest des Kapitels
  nicht.

---

## 2026-09-01 — Stefan Stretz und Luca Wollny, zweite Testrunde

Commit `2719a43`. Live auf `https://avefiimporter.goo1.de`.

### Fünf Meldungen, ein Fehler: Dialoge blieben unsichtbar

**Gemeldet von Luca Wollny (11:38) und Stefan Stretz (09:25).** Luca: „Löschen"
und „Neu konvertieren" in der Importe-Übersicht tun nichts, die Seite dunkelt
ab; dasselbe bei „Zuordnen" in der Profilliste und in der Zuordnungsvorschau.
Stefan: Nach dem Anlegen eines Nutzers bleibt die Oberfläche in einem
abgedunkelten Overlay hängen, ohne sichtbaren Dialog.

Ursache war eine Namenskollision, kein Bedienfehler und keine fünf Fehler.
`.modal-box` war zweimal vergeben — einmal von uns, einmal von daisyUI 5. Die
eigene Regel setzte Breite, Hintergrund und Rahmen und sagte zu `opacity`
nichts; daisyUIs Regel setzt `opacity: 0` und hebt das nur unter einem Element
mit `.modal.modal-open` wieder auf. Die Dialoge hingen unter `.modal-overlay`,
einer eigenen Klasse. Also wurde der Overlay gezeichnet und die Box blieb
unsichtbar.

Zwölf Klassennamen waren doppelt vergeben: `alert`, `avatar`, `badge`, `btn`,
`btn-xs`, `card`, `disabled`, `divider`, `input`, `menu`, `modal-box`, `step`.
Neun anwendungseigene Familien (26 Klassen, 227 Stellen in 43 Dateien) tragen
jetzt das Präfix `ui-`; `btn`, `badge` und `disabled` bleiben daisyUI und werden
von uns nur ergänzt. `tests/frontend/klassennamen.test.ts` schneidet beide
Namensmengen und lässt den Testlauf fehlschlagen, sobald eine eigene Klasse
wieder einen daisyUI-Namen trägt — die drei Ausnahmen stehen dort namentlich,
jede mit dem Satz, was genau ergänzt wird. Der Test prüft zusätzlich, dass keine
Ausnahme überflüssig geworden ist.

*Abnahmebezug: Anlage „Integration und Kompatibilität" — „Globale CSS-Regeln,
ein separates Theme-System und fest verdrahtete Layoutannahmen, die mit dem
AVefi-Frontend kollidieren, sind vermieden."*

### Die Barrierefreiheitsprüfung wertete nicht aus, was sie nicht beurteilen konnte

**Gemeldet von Stefan Stretz.** Kontrastprobleme an dunkelblauen
Primärknöpfen im hellen Schema, mit der Frage: „Der aktuelle axe-Test scheint
solche Fälle noch nicht vollständig abzudecken?"

Die Frage traf. `tests/a11y/axe.mjs` las ausschließlich `ergebnis.violations`.
`ergebnis.incomplete` — axe-cores dritter Ausgang, „nicht beurteilbar" — wertete
niemand aus. axe gibt beim Kontrast genau dann auf, wenn hinter dem Text ein
Hintergrundbild liegt, und daisyUI legt auf jeden Knopf eines. Allein auf der
Startseite fielen dadurch **171 Stellen** aus der Wertung, darunter sämtliche
Primärknöpfe.

Damit war die Aussage aus der Mail vom 31.08. — „75 Stände in beiden
Farbschemata mit axe-core erneut geprüft, kein Befund ab serious" — eine Aussage
über die Reichweite des Werkzeugs und nicht über die Oberfläche. Das ist in der
Antwort vom 01.09. ausdrücklich richtiggestellt worden.

Die Prüfung misst offene Kontraste jetzt aus den gerenderten Bildpunkten nach:
Element abfotografieren, häufigste Farbe als Grund, häufigste deutlich
abweichende als Schrift, alles unter 4,5:1 als Fehler. Gleichartige Elemente
werden einmal gemessen. Die Zahl der nicht beurteilten Fälle steht jetzt in
jedem Protokoll, auch für die übrigen Regeln.

### Und dann war der gemeldete Befund doch richtig

In der ersten Antwort an die Runde stand, die Nachmessung ergebe **5,48:1** und
der Befund lasse sich nicht nachstellen. **Das war falsch.**

Die Nachmessung riet die Schriftfarbe aus dem Bild: häufigste Farbe gleich
Hintergrund, häufigste deutlich abweichende gleich Schrift. Bei einem Knopf mit
abgerundeten Ecken sind die Eckpunkte aber der Seitenhintergrund und nicht die
Schrift. Das Verfahren hielt das Weiß der Ecken für die Schrift und gab
Entwarnung.

Mit der Schriftfarbe aus dem Stylesheet gemessen:

| Schema | Schrift auf Grund | Verhältnis |
|---|---|---|
| hell | `#16232a` auf `#43667a` | **2,61:1** |
| dunkel | `#e4ebee` auf `#88a9b9` | **2,07:1** |

Beides fällt unter WCAG 2.2 AA durch.

**Die Ursache ist dieselbe wie bei den Dialogen, nur an einer anderen
Eigenschaft.** In `app.css` stand `a { color: inherit }` **ungeschichtet**;
daisyUIs `.btn { color: var(--btn-fg) }` liegt in `@layer utilities`. Und
ungeschichtetes CSS schlägt geschichtetes unabhängig von der Spezifität. Auf dem
Element stand `--btn-fg` korrekt auf `#ffffff` und wurde nie benutzt. Die Regel
gilt jetzt als `a:not(.btn)`: hell 5,48:1, dunkel 6,96:1.

Das erklärt, warum Stefans Liste ausgerechnet „Edit", „Map", „Start mapping" und
„Assign" nannte: Das sind **Links**, die wie Knöpfe aussehen. Die echten
`<button>` — „Konto anlegen", „Namen speichern" — waren mit 5,48:1 in Ordnung.

Richtiggestellt gegenüber der Runde am 01.09.2026 (`c810461`).

### Die Nachmessung musste dreimal berichtigt werden

Weil sie sonst Schweigen durch Lärm ersetzt hätte, und das ist kein Fortschritt:

1. **Schriftfarbe aus dem Bild geraten** → siehe oben. Sie kommt jetzt aus
   `getComputedStyle`. axe scheitert am *Hintergrund*, nie am Vordergrund.
2. **Häufigste Farbe als Hintergrund.** Auf einem Farbverlauf sind die zwei
   häufigsten Bildfarben beide Hintergrund; der Abstand zwischen zwei
   Verlaufsstufen ist kein Textkontrast. Gewertet wird jetzt der **ungünstigste**
   Bildpunkt: Steht Text auf einem Verlauf, entscheidet die Stelle, an der er am
   schlechtesten steht.
3. **Bis an den Rand gemessen.** Die Kantenglättung an runden Ecken mischt
   Knopf- und Seitenfarbe; diese Mischfarben wurden als ungünstigster
   Hintergrund gewählt — 1,93:1 für einen Knopf, der 5,48:1 hat. Der Rand wird
   jetzt weggeschnitten.

Dazu: Farbübergänge sind während der Prüfung abgeschaltet, sonst wird nach einem
Themenwechsel eine Zwischenstufe abgelichtet, die es in keinem Thema gibt.
Zierzeichen bleiben außen vor — was unter `aria-hidden` liegt oder keinen Text
enthält, wird nicht als Textkontrast gewertet; dafür gilt 3:1 nach WCAG 1.4.11.

### Von der neuen Prüfung selbst gefunden: der Anmelde-Hero

Nicht gemeldet, sondern von der berichtigten Nachmessung entdeckt. Der Verlauf
der Anmeldeseite nimmt `--primary`; im dunklen Schema ist das `#80a3b5`, und die
Schrift darin ist fest weiß — **2,68:1**. Der Verlauf steht jetzt fest und folgt
dem Thema nicht mehr: Er ist Zierde, seine Schrift ist es nicht. (`f5893e5`)

*Abnahmebezug: „Tastaturbedienung, sichtbarer Fokus, Labels sowie Status- und
Fehlermeldungen nach WCAG 2.2 AA".*

### Das Schema kam nach dem Code

**Gemeldet von Luca Wollny.** Konvertierungsfehler `column "run_config" of
relation "imports" does not exist`.

Die Spalte war am Vorabend mit `88d95ec` eingeführt worden. Das Anlegen des
Schemas war ein Handgriff nach dem Ausrollen (`npm run migrate`), an den man
sich erinnern musste. Wer ihn vergaß, merkte nichts — der Server startete, die
Seite lud, und der Fehler traf den nächsten, der die betroffene Stelle benutzte.

Weboberfläche (`server/plugins/schema.ts`) und Hintergrundprozess wenden das
Schema jetzt beim Start selbst an, gegen eine Vorkehrungssperre
(`pg_advisory_lock`, weil beide gleichzeitig starten), und brechen bei einem
Fehlschlag ab, statt mit veraltetem Schema hochzukommen. `DB_SCHEMA_AUTO=0`
schaltet das ab, wenn die Datenbank fremd verwaltet wird; dann bleibt
`npm run migrate` der Weg.

Beim Nachgehen kam ein zweites Loch heraus, das schwerer wiegt: Der
Auslieferungscontainer kopiert nur `.output`. Weder `db/schema.sql` noch
`server/db/migrate.ts` lagen dort. **Eine gebaute Auslieferung konnte ihr
eigenes Schema also überhaupt nicht anlegen** — die Anleitung beschrieb einen
Weg, den das Abbild nicht hergab. Aufgefallen war das nie, weil die Testinstanz
im Entwicklungsmodus läuft und dort alle Dateien liegen. Die Datei liegt jetzt
über `nitro.serverAssets` im Bundle.

*Abnahmebezug: „Die Anwendung kann anhand der bereitgestellten Dokumentation
installiert, initialisiert, gestartet, gebaut und getestet werden."*

Nebenbei: 54 PostgreSQL-NOTICE-Zeilen je Start — `IF NOT EXISTS` quittiert jedes
übersprungene Objekt — sind über `onnotice` stillgelegt. Sie verdeckten alles,
was danach im Protokoll kam.

### Prozentring in der Datensatz-Detailansicht

**Gemeldet von Stefan Stretz.** In der Datensatzliste war der Prozentwert wie
verabredet durch „x von y Kernfeldern" ersetzt, in der Detailansicht stand er
noch, samt Ring.

Ersetzt durch dieselbe Angabe wie in der Liste, samt Namen der fehlenden
Kernfelder. Der Detail-Endpunkt lieferte `core` bereits mit; es fehlte nur die
Anzeige.

### „Importe" war als aktuelle Seite ausgezeichnet, wo man nicht war

**Gemeldet von Stefan Stretz.** Auf Nutzerverwaltung, Profil und Dokumentation
blieb „Importe" in der Hauptnavigation als aktiver Punkt markiert.

`active` gab „imports" als Auffangwert für jeden nicht erkannten Pfad zurück.
Damit stand dort `aria-current="page"` auf einem Punkt, auf dem man nicht steht
— für ein Vorlesewerkzeug keine Kleinigkeit, sondern eine falsche Ortsangabe.
Jetzt nur noch für `/` und `/imports/…`.

### Nicht gebaut, weil schon erledigt

**Gemeldet von Stefan Stretz:** Auf kleineren Viewports verschwindet die
Hauptnavigation vollständig.

War mit `8dbc060` am selben Vormittag behoben. Stefans Mail (09:25) und die
Antwort an Elias (11:55) haben sich gekreuzt.

### `aria-prohibited-attr`: das Abzeichen „veraltet" hieß anders, als es aussah

Nicht gemeldet, sondern von der erweiterten Prüfung sichtbar gemacht — es stand
bis zu 39-mal je Seite als „nicht beurteilt" im Protokoll, seit die Prüfung
`incomplete` überhaupt ausgibt.

Das Abzeichen trug seine Erklärung in `aria-label` auf einem `<span>`. Ein
`<span>` ohne Rolle ist `generic`, und dort ist ein Name unzulässig:
Vorlesewerkzeuge ignorieren ihn — dann war die Erklärung für sie gar nicht da —
oder sie lesen ihn **statt** des sichtbaren Wortes „veraltet". Dann heißt das
Abzeichen anders, als es aussieht, und wer die Oberfläche mit der Stimme
bedient, findet es unter seiner Beschriftung nicht mehr. *Abnahmebezug: WCAG
2.5.3, Label in Name.*

Die Erklärung steht jetzt als sichtbar verborgener Text daneben.
`aria-describedby` war der erste Versuch und ist wieder entfernt: Im Barrierebaum
von Chromium nachgesehen steht ein `<span>` ohne Rolle gar nicht als eigener
Knoten drin, eine Beschreibung daran geht ins Leere. Nachgemessen statt
angenommen — sonst wäre eine Verdrahtung stehen geblieben, die gut aussieht und
nichts tut.

Der Preis ist Umständlichkeit: Die Erklärung gehört jetzt zum Text der
Tabellenzelle und wird beim Durchgehen mitgelesen. Das ist den Zustand davor
wert, in dem sie nur im `title` stand und mit der Tastatur unerreichbar war; für
die Maus bleibt der `title` stehen. Danach 0 Verstöße und 0 nicht beurteilte
Stellen. (`d7fe60e`)

### Lucas zwei Frontend-Fehler: nicht reproduzierbar, Ursache trotzdem entschärft

**Gemeldet von Luca Wollny:** ein Vue-Codegen-Fehler in `users/index.vue` und
`useRuntimeConfig` außerhalb des Nuxt-Kontexts beim Laden — beide traten am Ende
seines Tests schon nicht mehr auf.

Nachgestellt: sechs Seiten, je beim Neuladen und beim Navigieren im Browser,
**keine einzige Konsolenmeldung**. Die Zeitachse erklärt es: Er testete, während
`8dbc060` (10:28) und `34c2be1` (10:32) ausgerollt wurden, und die Testinstanz
läuft im Entwicklungsmodus mit laufendem Neuladen.

Das ist keine Entwarnung, sondern eine Prozessfrage: **Ein Tester auf einer
Instanz im Entwicklungsmodus sieht Fehler, die es nicht gibt**, und kann sie
nicht von echten unterscheiden. Für den Nutzertest der Abnahme gehört ein
gebauter Stand her.

Die Ursache hinter der zweiten Meldung ist echt und jetzt entschärft: `useApi()`
las die API-Basis über `useRuntimeConfig()`, das außerhalb des Nuxt-Kontexts
wirft. Der Zugriff läuft über `tryUseNuxtApp()`, das `null` zurückgibt statt zu
werfen. Nebenbefund, unangetastet und hier notiert: In 16 Dateien steht
`useHead()` nach einem `await` auf oberster Ebene — dieselbe Familie von
Kontextproblemen, gemessen ohne Meldung.

### Der Auslieferungsbau ist geprüft

`nuxt build` läuft durch, und `db/schema.sql` liegt als
`.output/server/chunks/raw/schema.mjs` im Bündel. Damit ist die Schema-Änderung
oben auch außerhalb des Entwicklungsmodus belegt und nicht nur behauptet.

### Offen geblieben aus dieser Runde

- **i18n.** Die Vokabular-Beschriftungen werden noch nicht überall genutzt,
  einzelne Enum-Werte erscheinen technisch, und Fehlermeldungen kommen weiterhin
  auf Deutsch aus dem Backend. Die englische Oberfläche ist damit nicht
  vollständig. *Ausdrücklicher Bestandteil des Werkvertrags.*
- **Anbindung an die AVefi-Authentifizierung.** Es gibt derzeit eine eigene
  Nutzerverwaltung mit Konten, Passwörtern, Sperren und Zurücksetzen. Wie das
  für die spätere Integration gedacht ist, ist eine Vertrags-, keine Codefrage.
- **Zielgruppe und vorausgesetztes Vorwissen.** Offen, und Voraussetzung für
  jede weitere Vereinfachung von Importübersicht, Zuordnung und Format-Review.
- **Rückmeldungen von Matti Stöhr** aus dem Pad: Beanstandungen direkt
  ansteuerbar, flexible Sortierung und Filterung, kontextsensitive Hilfe,
  Wording „Fassung" → „Manifestation" und „die Auswahl gehoert einem Menschen" →
  „Bitte manuell zuordnen". Noch nicht angefasst.

---

## 2026-09-01 — Elias Oltmanns, Test mit Vorlesewerkzeug

Commits `8dbc060`, `34c2be1`.

Sechs Befunde aus einem Durchgang mit Vorlesewerkzeug und Tastatur, dazu zwei
Nebenbefunde beim Nachgehen.

- **Hauptnavigation unter 820 Pixeln ersatzlos ausgeblendet.** Per CSS auf
  `display:none`, ohne Aufklappmenü. `display:none` nimmt einen Zweig auch aus
  dem Barrierebaum, deshalb war er weder mit der Tabulatortaste noch mit der
  Browsersuche zu finden. Betrifft jeden, der die Darstellung vergrößert —
  vergrößerte Darstellung wirkt für die Seite wie ein schmales Fenster. Es gibt
  jetzt einen Aufklappknopf; im Tastaturdurchlauf bei 800 Pixeln steht er an
  Position 3.
- **Speichern ohne erkennbare Rückmeldung.** Die Bestätigung war da, aber an
  eine Bedingung geknüpft — das Element entstand gemeinsam mit seinem Text. Ein
  Meldebereich, der erst mit seiner Meldung in die Seite kommt, wird von den
  verbreiteten Vorlesewerkzeugen nicht angesagt. Der Fehler steckte an 50 Stellen
  in 22 Dateien nach demselben Muster; die Bereiche stehen jetzt dauerhaft in der
  Seite, nur ihr Inhalt wechselt.
- **Doppelte Vokabulareinträge nach einem Upload in falscher Kodierung**
  („Französisch" und „franz?sisch"). Zwei Ursachen: Die Anwendung las jede Datei
  als UTF-8, weil sie nichts anderes kannte — sie erkennt die Kodierung jetzt,
  liest Windows-1252 als Windows-1252 und hält im Prüfbericht fest, wie gelesen
  wurde. Und die gespeicherte Werteliste behielt jeden Eintrag, auch wenn er in
  der Datei nicht mehr vorkam; solche Einträge sind jetzt als „nicht in dieser
  Datei" ausgewiesen und lassen sich gebündelt entfernen. Sie verschwinden
  bewusst nicht von selbst: Ein Profil über mehrere Lieferungen zu benutzen ist
  der Normalfall, und dann ist eine Häufigkeit von null kein Fehler.
- **`has_format` war nicht zuordenbar.** Das Feld fehlte im Zielkatalog, weil es
  im Schema kein Vokabular ist, sondern eine Liste aus sechs Klassen mit je
  eigener Werteliste. Es gibt jetzt sechs Ziele, eines je Trägerklasse. Geraten
  wird die Klasse nicht: „DV" steht in `FormatVideoTypeEnum` und in
  `FormatDigitalFileTypeEnum`, und welches gemeint ist, sagt der Wert nicht.
- **Die Auswahlliste zeigte höchstens 40 Einträge, der Katalog hatte 54.** Ohne
  Suchwort standen Farbe, Ton, Bildfrequenz, Zugangsstatus, Laufzeit, Länge,
  alle drei Sprachen und beide Datumsfelder gar nicht zur Wahl. **Drei davon —
  `has_colour_type`, `has_access_status` und knapp `element_type` — nennt die
  Leistungsbeschreibung namentlich als Felder mit kontrolliertem Vokabular.** Die
  Grenze war unsichtbar; mit der Maus scrollt man dagegen, ohne es zu merken.
  Sie ist weg, die Liste ist nach Ebene gegliedert und die Trefferzahl wird
  angesagt. Dabei kam heraus, dass Suchindex und Suchfeld die Wörter
  unterschiedlich zerlegten — der Index trennte am Punkt, das Feld behielt ihn.
- **Feldpfade nannten eine Ebene, die es nicht gab** („Exemplar, Technik, Farbe";
  „Werk, Werk, Form"). Die mittlere Ebene war ein reiner Anzeigeeimer und hieß
  bei Werksfeldern zufällig auch noch „Werk". Der Pfad nennt jetzt Ebene und
  Feld, sonst nichts.

Zwei Nebenbefunde:

- **Der Vorschlag „Werk › Werk › Form" für `category: avefi:Item has_format`**
  kam zustande, weil „format" mit dem Stichwort „form" anfängt. Die Kopfzeile
  sagte zweimal, dass ein Exemplar gemeint ist, und beides wurde nicht gelesen.
  Ein genannter Schemafeldname gilt jetzt als Angabe und schlägt jede
  Wortähnlichkeit; eine genannte Ebene stuft Vorschläge anderer Ebenen zurück,
  statt sie zu verwerfen — die Angabe in einer Kopfzeile kann auch falsch sein.
- **Die Anlage zur Frontend-Kompatibilität verlangt eine konfigurierbare
  API-Basis-URL.** Sie war vorgesehen und wurde von keiner Zeile gelesen: 63
  Aufrufe standen mit festem Pfad in 27 Dateien. Solange der Importer unter
  derselben Herkunft läuft wie sein Server, fällt das nicht auf — unter
  `import.av-efi.net` hinter dem AVefi-Frontend schon. *Abnahmebezug: „API-Basis-
  URLs, Routing und Authentifizierung sind konfigurierbar und dürfen nicht fest
  im Code hinterlegt sein."*

Die Oberflächenbeschreibungen unter `/dokumentation/oberflaeche` entstehen seit
`34c2be1` bei **zwei** Fensterbreiten statt einer. Genau daher kam die
systematische Abweichung, die Elias gefunden hat: Sie beschrieben eine
Tastaturreihenfolge aus einem Durchlauf bei 1500 Pixeln, die für sein Fenster
nie gegolten hat.

---

## 2026-08-31 — Luca Wollny (dritte Runde) und Stefan Stretz (Statusliste)

Commit `88d95ec`.

### Nur eine Normdatenzuordnung je Zweig kam im Export an

**Gemeldet von Luca Wollny**, mit dem Vorschlag, davor zu warnen. Der Vorschlag
wäre die falsche Antwort gewesen: Es war keine Entwurfsentscheidung, sondern
drei Fehler übereinander.

1. Der Normdatenbedarf wurde je Kette nur für den ersten Abgleichsschritt
   gesammelt — die zweite Quelle wurde nie gefragt.
2. Bestätigte Zuordnungen lagen nur nach Wert vor, nicht nach Quelle, sodass
   eine bestätigte GND-Zuordnung der VIAF-Abfrage als deren eigener Treffer
   zurückgegeben wurde.
3. Die Liste erlaubter Kennungsarten stand fest im Code statt aus dem Schema zu
   kommen.

Mehrere Normdatenquellen im selben Zweig wirken jetzt. Getrennte Zweige braucht
es nur noch dort, wo das Schema am Ziel wirklich nur eine Ressourcenart zulässt
— und dort sagt es die Oberfläche. Neu ist eine Warnung, wenn dieselbe Quelle
zweimal im selben Zweig steht.

### Das Zuordnungsinterface war auf drei Zeilen begrenzt

**Gemeldet von Luca Wollny.** Ein Wert („USA"), der wegen mehrerer Treffer eine
manuelle Zuweisung brauchte, erschien nicht im Fenster und ließ sich deshalb
nicht zuordnen.

Der beschriebene Zielkonflikt zur schnellen Vorschau war keiner: Eine einzige
Konstante steuerte beides — die Vorschau, die nach jeder Änderung neu rechnet
und schnell sein muss, und die Zuordnungsliste, die ein Mensch abarbeitet und
vollständig sein muss. Getrennt lösen sich beide Anforderungen auf. Die Liste im
Zweig rollt jetzt und führt alle Werte; dazu gibt es unter
`/mappings/<id>/normdaten` eine eigene Seite für den Durchgang am Stück, mit
Häufigkeit je Wert und Filter „nur offene". Sie hängt am Profil und nicht am
Import, damit Testperson 2 beim Einlesen des Profils die Entscheidungen von
Testperson 1 mitbekommt.

Für Lucas Profil wurden dort **300 offene Entscheidungen in 20 Gruppen**
sichtbar. Das Drei-Zeilen-Fenster hatte die Aufgabe nicht kleiner gemacht, nur
unsichtbar.

### Stefan Stretz' Statusliste

Umgesetzt: die Hierarchie Werk → Fassung → Exemplar (Exemplare stehen eingerückt
unter ihrer Fassung, die Zugehörigkeit kommt aus `is_item_of` und wird nicht
geraten), die Trennung von Abdeckung, Vollständigkeit und Validität (kein
Prozentwert mehr, sondern „3 von 4 Kernfeldern" samt Namen der fehlenden), die
Fehleranzeige am Feld mit Quellfeld und AVefi-Schemapfad, 114 deutsche
Beschriftungen für die Vokabulare, und die Umstellung auf Tailwind 4 mit
daisyUI 5.

Zur Umstellung, weil sie für die Abnahme zählt: Die Themen tragen die Farbwerte
aus der Barrierefreiheitsarbeit vom 25.08. Deshalb hat die neue Grundlage die
Kontraste nicht zurückgeworfen — 75 Stände in beiden Farbschemata erneut
geprüft. *Zu dieser Aussage siehe die Richtigstellung vom 01.09.: Die Prüfung
konnte die Knöpfe zu diesem Zeitpunkt gar nicht beurteilen.*

### Zwei bewusste Abweichungen von Stefans Präzisierungen

- **„Veraltet" wird abgeleitet, nicht gespeichert.** Verglichen wird die
  Profilfassung, mit der konvertiert wurde, mit der Fassung, die das Profil heute
  trägt. Ein gespeichertes Kennzeichen würde driften, sobald jemand ein Profil
  ändert, ohne dass Importcode läuft — und Mappingprofile sind
  institutionsübergreifend sichtbar. Der erste Lauf wies sechs von 83 Importen
  als veraltet aus, einen aus Fassung 3 bei heute Fassung 60.
- **Die feste Transformationsreihenfolge wird vorgeschlagen und geprüft, nicht
  erzwungen.** Als starre Regel umgesetzt, hat sie beim ersten Lauf „Leerraum
  entfernen" nach „Aufteilen" beanstandet — was richtig ist, weil der Konverter
  dann auf jedes Element wirkt. Eine erzwungene Reihenfolge hätte den Anwender
  zu einer schlechteren Kette gedrängt. Beanstandet wird jetzt nur der Fall, der
  wirklich schadet: nachschlagen, bevor der Suchwert fertig gebildet ist. Zweiter
  Grund: Würde die Ausführung intern umsortieren, sähe der Anwender im Editor
  eine andere Reihenfolge als die gerechnete.

### Reproduzierbarkeit hatte ein Loch

Aus Stefans Präzisierung zu den Transformationseinstellungen: Das
CSV-Trennzeichen wurde bei **jedem** Lesen neu erraten und stand nirgends.
Dieselbe Datei konnte nach einer Änderung an der Erkennungsheuristik anders
zerfallen, ohne dass sich Datei oder Profil geändert hätten. Jetzt wird einmal
geraten, beim Erkennen, und festgehalten — zusammen mit Profilfassung,
Profilformat- und Schemaversion und den Einstellungen des Laufs (`run_config`).

*Abnahmebezug: „Derselbe Testdatensatz mit demselben Mappingprofil erzeugt ein
semantisch identisches AVefi-JSON."*

### Zwei Befunde, die die Runde betreffen

- In Lucas Profil wird die Spalte „Produktion" mit der Normdatenart „Person"
  abgefragt, gemeint ist die Produktionsfirma. So trifft die Abfrage nie, und es
  sieht aus wie „nichts gefunden". Die Oberfläche hat das zugelassen und
  geschwiegen; jetzt meldet sie es. Korrigieren muss das Profil sein Eigentümer.
- Die Paderborner Testdatei besteht `efi-conv check` nicht, weil die Zeilen 61/62
  und 65/66 dieselbe Signatur tragen und die Signatur auf die Exemplarkennung
  gemappt ist. Der Importer weist das jetzt als Beanstandung mit Zeilennummern
  aus, statt die Kennung still eindeutig zu machen: Ob die Zeilen dasselbe
  Exemplar meinen oder die Spalte nicht als Kennung taugt, kann nur das Archiv
  entscheiden. **An dieser Frage hängt Lucas offene Zeile „Validierung der
  gemappten Daten".**

---

## 2026-08-26 — Barrierefreiheit, Oberflächenbeschreibungen, Lucas zweite Runde

Commits `c329f5d`, `84f2d79`, `c6c814e`, `51cecf8`, `cc7ca3f`, `beb2d6a`,
`bdbbd9b`, `a050b94`.

- **Ablagefläche nicht mehr bedienbar** — der Klick öffnete die Dateiauswahl
  nicht mehr (`c329f5d`). Ein Symptom im Browser, dessen Ursache nicht im
  gemeldeten Bereich lag.
- **Barrierefreiheit** (`84f2d79`): Kontraste, Fokusführung, rollende Bereiche.
  258 Kontrastverstöße behoben; die Werte sind seither gegen 4,5:1 gerechnet und
  stehen an einer Stelle. Eine frühere Lösung mit `.45` Deckkraft für
  abgeschaltete Knöpfe hatte allein 130 Verstöße eingetragen.
- **Normdatensuche fragte den Rohwert statt den Wert nach der Konverterkette**
  (`c6c814e`) — **gemeldet von Luca Wollny**: „DE" fand keinen GND-Treffer,
  während die automatische Konvertierung vorher zu „Deutschland" normalisierte
  und traf. Damit zeigte der Editor etwas anderes als der Export.
- **Die Oberfläche in Worten** (`51cecf8`, `cc7ca3f`, `beb2d6a`, `a050b94`):
  Beschreibungen jedes Stands für den Test mit Vorlesewerkzeug, später als Seite
  in der Anwendung selbst. Das Beschreiben fand Dinge, die keine maschinelle
  Prüfung findet — etwa Löschknöpfe, die für ein Vorlesewerkzeug alle gleich
  hießen und jetzt Nummer und Ebene nennen.
- **Normdaten und Ländertabelle wirken jetzt auch im Export** (`bdbbd9b`) —
  **gemeldet von Luca Wollny**: In der Weboberfläche stimmte es, im Export
  fehlten `same_as`, `located_in` und `Director`, und Werte in `has_name` waren
  durch Normdaten-IDs ersetzt.

---

## 2026-08-25 — Projekttreffen, Neufassung auf Nuxt 4

Commits `5290811`, `79cb475`, `d90396d` (Tag `php-final`), `69408c2`, `3366696`,
`7da1b2a`.

Im Treffen verabredet und am selben Tag durchgezogen: Der PHP-Prototyp wird auf
das eigentliche Vue-Frontend überführt. Der letzte PHP-Stand liegt unter dem
annotierten Tag **`php-final`**.

- **Excel-Import mit Auswahl der Tabellenblätter** (`d90396d`).
- **Neufassung auf Nuxt 4 mit Vue 3 und TypeScript** (`69408c2`). *Abnahmebezug:
  „Die Benutzeroberfläche ist mit Vue-3-Single-File-Components umgesetzt" und
  „Für Komponenten, Props, Events und gemeinsam genutzte Datenstrukturen wird
  TypeScript verwendet".*
- Zwei Tabellenfehler und ein abgeschnittener Knopf in der Aktionsspalte
  (`5290811`, `79cb475`), Fortschrittsbalken und Zähler der Importliste
  (`3366696`), Dokumentation an die Neufassung angeglichen (`7da1b2a`).

### Bekannte Einschränkung aus dieser Umstellung

`.xls` und `.ods` werden nicht gelesen. In der Dokumentation benannt.

---

## 2026-08-24 — Luca Wollny, erster Testbericht

Commit `fd42c3c`. Weitergeleitet über Antje Dittmann, Briefing durch Jonas Pitz.

GND-Abgleich repariert, Bestätigen von Normdatenzuordnungen, Normalisierung von
Länderangaben. Der Bericht war präzise genug, um alles nachzustellen, und traf
Stellen, die eigene Durchgänge nicht getroffen hatten.

---

## 2026-08-19 bis 21 — Mapping-Profile und Jonas Pitz' Rückmeldung

Commits `47f5bdf`, `f3b474a`, `06757f1`, `c4b6f1d`, `0d8b259`, `4ac0f2a`,
`a8310e9`, `d282950`.

- **Mapping-Profile**, Entwurf am 19.08. mit Jonas Pitz abgestimmt: CSV/TSV
  werden zugeordnet statt geraten (`f3b474a`), Editor auch ohne Import, Anlegen
  per Beispieldatei, Verzweigungsansicht (`06757f1`).
- **Ausgelieferter Fehler: leere Seite** (`c4b6f1d`). Der Mapping-Editor blieb
  leer, weil das Wurzel-Template nicht aus dem Mount-Element kam.
- **Vorschau zeigt drei gesuchte Beispiele je Spalte statt nur Zeile 1**
  (`0d8b259`) — Beispiele suchen, nicht abzählen.
- **Normdaten ergänzen statt überschreiben** (`d282950`) — **gemeldet von Jonas
  Pitz am 20.08.**: Beim Anlegen von Normdaten für Regisseure wurde der Name mit
  der ID überschrieben, statt einen GND-Link zu ergänzen. Dazu Profil-Export mit
  Beispieldaten.
- Kontextmenü statt Papierkorb in der Importliste, Neu-Konvertieren mit Warnung
  (`47f5bdf`); feste Spaltenbreiten statt waagerechtem Rollbalken (`4ac0f2a`);
  farbige Vorschau-Ergebnisse mit Haken bzw. Warnzeichen (`a8310e9`).

---

## 2026-07-25 bis 27 — Erste Fassung, vor dem Werkvertrag

Commits `d5d142e` bis `95cdc1f`.

Vorarbeit, entstanden vor dem formellen Go am 31.07.2026 und vor dem Kick-Off am
11.08.2026: die vollständige Anwendung als PHP-Fassung (`1fb4c46`), Handbuch und
Gerüst für die PID-Registrierung (abgeschaltet, `ba50f57`), Worker-Warteschlange
und Fehlerreport (`8dc8a73`, `733b3e3`, `6d1ff84`), sowie der
AVefi-Schema-Editor in Vue 3 mit Abgleich gegen GND, Wikidata und VIAF
(`0116acc`, `18e136e`, `95cdc1f`).

Dieses Mockup war beim Kick-Off der gezeigte Zwischenstand.

---

## Dauerhaft bekannte Einschränkungen und Annahmen

Diese Liste ergänzt die ausführliche Fassung in der `README.md`.

- **`.xls` und `.ods` werden nicht gelesen.** Nur `.xlsx`.
- **Der Testserver läuft im Entwicklungsmodus.** Der Auslieferungspfad ist im
  Dockerfile als eigene Stufe enthalten und in der README beschrieben. Mehrere
  Befunde sind nur deshalb erst spät aufgefallen — zuletzt am 01.09. das im
  Auslieferungsabbild fehlende `db/schema.sql`.
- **Nichts wird zwischengespeichert.** Jede Seite zeigt Daten der angemeldeten
  Institution; ohne `no-store` legt ein vorgelagerter Zwischenspeicher eine
  angemeldete Seite ab und liefert sie weiter aus. Nachweislich geschehen.
- **Normdatenanreicherung ist abschaltbar** (`AUTHORITY_ENABLED`). Vorschau und
  Hintergrundprozess müssen dieselbe Einstellung sehen, sonst zeigt der Editor
  etwas anderes als der Export.
- **`efi-conv` wird referenziert, nicht nachgebaut.** Ein eigener Sidecar
  installiert das Python-Paket und prüft die Ergebnisse damit — derselbe
  Validator, der später die Lieferung prüft.
- **`RecordMapper::classify`** lebt für JSON-Quellen weiter; die dortigen
  Teilstring-Treffer sind nicht behoben. Für Tabellen macht es `MappingSuggest`
  richtig.
