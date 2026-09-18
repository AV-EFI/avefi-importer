# Barrierefreiheit pruefen

Die Oberflaeche muss ohne Maus und mit einem Vorlesewerkzeug bedienbar sein.
Drei Dinge sichern das ab: eine maschinelle Pruefung, die sich wiederholen
laesst, ein Durchgang von Hand, den die Maschine nicht ersetzen kann, und eine
Beschreibung der Oberflaeche in Worten, damit man ueber sie reden kann, ohne
sie zu sehen.

## 1. Maschinelle Pruefung

`tests/a11y/axe.mjs` faehrt die Kernseiten mit einem echten Browser an, meldet
sich an und laesst auf jedem Stand [axe-core](https://github.com/dequelabs/axe-core)
laufen — gegen `wcag2a`, `wcag2aa`, `wcag21a` und `wcag21aa`.

Seit die Oberflaechenbeschreibungen in der Anwendung lesbar sind, gehoeren auch
`/dokumentation/oberflaeche` und die 16 Einzelseiten dazu.

Geprueft wird nicht nur der Ruhezustand. Zusaetzlich werden die Zustaende
geoeffnet, in denen die Fehler sitzen: Nutzermenue, Zeilenmenue, Rueckfrage,
aufgeklappte Zuordnungszeile, Zielliste der Combobox, Konverterauswahl und die
Reiter des Schema-Editors. Jede Seite laeuft in beiden Farbschemata, weil sich
Kontrastfehler nur in einem von beiden zeigen koennen.

Die Kennungen von Import, Profil, Datensatz und Format-Review liest das Skript
aus der laufenden Anwendung. Es muss also nicht angepasst werden, wenn ein
Testimport wegfaellt.

## Zugangsdaten

Beide Werkzeuge melden sich an der laufenden Instanz an und brauchen dafuer ein
Konto. Die Werte stehen **nicht** in diesem Repository, sondern kommen aus der
Umgebung:

```bash
read -rp  'Konto: '    A11Y_USER
read -rsp 'Passwort: ' A11Y_PASS; echo
export A11Y_USER A11Y_PASS             # bzw. OBF_USER / OBF_PASS
```

`read -s` schreibt das Passwort nicht auf den Bildschirm und nicht in die
Verlaufsdatei der Shell. Eine Zuweisung in der Befehlszeile taete beides.

Bis zum 10.09.2026 nannte diese Datei an vier Stellen ein Konto samt Passwort
als Beispiel. Das Beispiel war der echte Zugang der Demo-Instanz, und mit dem
Uebertrag an die Organisation AV-EFI wurde das Repository oeffentlich. Ein
Beispielwert, der auf einer erreichbaren Instanz funktioniert, ist kein
Beispiel.

Die Anwendung erkennt beim Start, wenn ein aktives Verwaltungskonto ein
Passwort aus dieser Dokumentation traegt, und meldet es (siehe
`server/lib/vorgabewerte.ts`).

### Aufruf

```bash
docker run --rm --network host \
  -v /var/www/avefi-importer/src:/app -w /app \
  -e A11Y_BASE=https://avefiimporter.goo1.de \
  -e A11Y_USER="$A11Y_USER" -e A11Y_PASS="$A11Y_PASS" \
  mcr.microsoft.com/playwright:v1.50.0-noble node tests/a11y/axe.mjs
```

Voraussetzung sind die Entwicklungsabhaengigkeiten `axe-core` und
`playwright-core` (`npm install`). Der Browser kommt aus dem Abbild;
`playwright-core` ist deshalb auf `1.50.0` festgenagelt — eine andere Version
sucht eine Chromium-Ausgabe, die im Abbild nicht liegt.

Stellschrauben:

| Umgebungsvariable | Vorgabe | Wirkung |
| --- | --- | --- |
| `A11Y_BASE` | `http://localhost:3000` | Adresse der Anwendung. Ueber HTTPS aufrufen, sonst greift das Sitzungscookie nicht. |
| `A11Y_USER` / `A11Y_PASS` | keine | Anmeldung. Aus der Umgebung, siehe unten. |
| `A11Y_THEMES` | `light,dark` | Farbschemata, die geprueft werden. |
| `A11Y_VIEWPORT` | `1500x1100` | Fenstermass fuer den Hauptdurchlauf. |
| `A11Y_VIEWPORT_SCHMAL` | `390x844` | Fenstermass fuer den Abschnitt „Schmale Darstellung". Muss unter 820 Pixeln liegen, sonst greift der Umbruch nicht und der Abschnitt prueft dieselbe Darstellung ein zweites Mal. |

### Schmale Darstellung

Bis zum 18.09.2026 lief die Pruefung nur mit 1500 x 1100. Unterhalb von 820
Pixeln (`app.css`, `@media`) liegt die Navigation hinter einem Aufklappknopf —
und genau dieser Zweig war einmal fehlerhaft: Er stand auf `display:none`, was
ihn aus dem Barrierebaum nimmt, sodass die Ziele weder mit der Tabulatortaste
noch mit der Suche des Browsers zu finden waren. Repariert wurde das im August,
geprueft wurde es nie (#11).

Der Abschnitt am Ende des Laufs stellt das Fenster auf `A11Y_VIEWPORT_SCHMAL`
und prueft eine Auswahl von Seiten — Startseite, Zuordnungsprofile, Zuordnung,
Datensaetze, Pruefbericht, Konten — sowie den Aufklappknopf in beiden
Zustaenden. Dabei wird nicht nur axe befragt, sondern auch nachgesehen, ob
`aria-expanded` dem Zustand folgt und ob aufgeklappt ueberhaupt ein erreichbares
Ziel darin steht.

Geprueft wird eine Auswahl und nicht alles noch einmal: Der ganze Lauf ein
zweites Mal wuerde die Dauer verdoppeln, um ueberwiegend dieselben Regeln an
denselben Bausteinen zu pruefen.

**Das ersetzt den Nachtest durch einen Menschen nicht.** axe findet, was messbar
ist. Ob die Bedienung mit der Tabulatortaste in dieser Breite ertraeglich ist,
findet es nicht.

### Ergebnis

Je Stand eine Zeile mit der Zahl der Befunde nach Schwere, darunter jeder
Befund mit Regel, WCAG-Kriterium und den betroffenen Stellen. Das Skript endet
mit 1, sobald irgendwo ein Befund der Schwere `serious` oder `critical` steht —
so faellt es in einer Pipeline auf. `moderate` und `minor` werden gemeldet,
lassen den Durchlauf aber gruen.

## 2. Durchgang von Hand

axe-core findet fehlende Beschriftungen und schlechte Kontraste. Es findet
nicht, ob man ans Ziel kommt. Der folgende Ablauf ist der vertraglich zugesagte
Kernweg und wird **ausschliesslich mit der Tastatur** gegangen — Maus weglegen:

1. Anmelden. Der erste Tabstopp muss die Sprungmarke „Zum Inhalt springen"
   sein.
2. Datei hochladen: bis zum Dateifeld tabben, mit Leertaste oder Eingabetaste
   oeffnen, Datei waehlen. Erwartung: Der Stand wird angesagt, nicht nur
   angezeigt.
3. Ueber die Zeilenaktion in die Zuordnung springen.
4. Mindestens eine Feldzuordnung aendern: Zielvorschlag uebernehmen, dann im
   Zielfeld tippen, mit Pfeiltasten waehlen, mit Eingabetaste uebernehmen.
5. Vokabularzuordnung pruefen: „Werteliste anlegen", dann in der Tabelle je
   Quellwert einen AVefi-Wert waehlen.
6. „Gegen das AVefi-Schema pruefen".
7. Speichern, offene Spalten ignorieren, „Speichern und konvertieren".
8. Mappingprofil und AVefi-JSON herunterladen.

Worauf dabei zu achten ist:

- **Der Fokus muss sichtbar sein**, auf jedem Schritt. Kein `outline:none` ohne
  Ersatz.
- **Der Fokus darf nicht verlorengehen.** Verschwindet der gedrueckte Knopf —
  weil er gesperrt wird oder aus dem Baum faellt —, faellt der Fokus sonst auf
  `<body>`, und der Weg zurueck beginnt am Seitenanfang. Dagegen stehen
  `useKeepFocus()` und das Nachfuehren in Editor, Verzweigung und Kette.
- **Dialoge**: Escape schliesst, der Fokus kehrt an die ausloesende Stelle
  zurueck, und dazwischen kommt man nicht aus dem Dialog heraus.
- **Menues**: Pfeiltasten wandern, Pos1/Ende springen, Escape schliesst und
  gibt den Fokus zurueck.
- **Zustandsaenderungen ohne Seitenwechsel** muessen in einem `aria-live`- oder
  `role="status"`-Bereich stehen, sonst bleiben sie stumm.

## 3. Die Oberflaeche in Worten

`tests/a11y/oberflaeche.mjs` beschreibt dieselben Seiten, die `axe.mjs` prueft,
und benutzt dasselbe Anmeldemuster. Es prueft nichts, es schreibt auf: je Seite
eine Datei in Markdown unter `docs/oberflaeche/`, dazu einen Bildschirmabzug.

Gedacht ist das fuer alle, die die Anwendung besprechen, ohne sie zu sehen. Je
Seite stehen zwei Teile drin. Zuerst, was ein Vorlesewerkzeug vorfindet:
Landmarken in Dokumentreihenfolge, die Ueberschriftenhierarchie samt
uebersprungener Stufen, die durchnummerierte Tab-Reihenfolge mit Name und Rolle
jedes Ziels, die Formularfelder mit Beschriftung, Pflichtangabe und verknuepftem
Hinweis, die Tabellen mit Spalten und Ueberschriften, die Live-Bereiche mit
ihrem aktuellen Inhalt, die Bilder mit Alternativtext, und was beim Bedienen
stoert. Danach ein kurzer Absatz zur raeumlichen Anordnung, damit „der Knopf
oben rechts" in einer Besprechung eindeutig ist.

Beim Mapping-Editor kommt die aufgeklappte Zuordnungszeile mit ihren Zweigen
dazu. Das Skript sucht sich dafuer die Zuordnung mit den meisten belegten Zielen
und darin die Zeile mit den meisten Zweigen — an einer leeren Zeile gibt es
nichts zu beschreiben. Geaendert wird dabei nichts: die Zeile wird wieder
zugeklappt, gespeichert wird nirgends.

### Aufruf

```bash
docker run -d --name oberflaeche --ipc=host --shm-size=1g --network host \
  -v /var/www/avefi-importer/src:/app -w /app \
  -e OBF_BASE=https://avefiimporter.goo1.de \
  -e OBF_USER="$OBF_USER" -e OBF_PASS="$OBF_PASS" \
  -e OBF_COMMIT=$(git -C /var/www/avefi-importer rev-parse --short HEAD) \
  mcr.microsoft.com/playwright:v1.50.0-noble node tests/a11y/oberflaeche.mjs
docker logs -f oberflaeche
```

Das ergibt den breiten Durchlauf. Der schmale kommt aus demselben Skript mit
`OBF_WIDTH=800` und `OBF_OUT=/tmp/obf-schmal`. Zusammengefuehrt wird danach:

```bash
docker cp oberflaeche-schmal:/tmp/obf-schmal /var/www/avefi-importer/src/obf-schmal
docker exec avefi_web sh -c 'cd /app && node tests/a11y/tabreihenfolge.mjs docs/oberflaeche obf-schmal'
rm -rf /var/www/avefi-importer/src/obf-schmal
```

`tabreihenfolge.mjs` ersetzt in jeder Beschreibung den Abschnitt
„Tab-Reihenfolge" durch beide Varianten und meldet mit Rueckgabewert 1, wenn zu
einer Seite die schmale fehlt. Bis zum 01.09.2026 war das ein Handgriff von
Hand, und beim ersten Neuerzeugen danach war die schmale Variante wieder weg,
ohne dass es auffiel — ein Schritt, an den man sich erinnern muss, ist kein
Verfahren. Wer den breiten Durchlauf ohne den schmalen laufen laesst, hat
seitdem eine Beschreibung, die zu wenig sagt, und muss nachziehen.

Zwei Breiten, weil eine Beschreibung sonst mehr behauptet, als sie weiss. Die
Beschreibungen entstanden bis zum 01.09.2026 aus einem einzigen Durchlauf bei
1500 Pixeln und nannten damit eine Tab-Reihenfolge, die unterhalb von 820 Pixeln
nie gegolten hat — dort lag die Hauptnavigation hinter einem Aufklappknopf, und
davor war sie ganz ausgeblendet. Ein Test mit Vorlesewerkzeug hat genau diese
Abweichung gefunden, und die Beschreibung war daran mitschuldig. Wer die
Darstellung vergroessert, bekommt uebrigens die schmale Variante, auch am grossen
Bildschirm.

Der Durchlauf dauert rund vier Minuten. `--ipc=host` und `--shm-size=1g` sind
nicht schmueckendes Beiwerk: ohne sie beendet sich der Browser mitten im Lauf.
Der Container laeuft im Hintergrund, weil er sonst mit der Sitzung endet, aus
der er gestartet wurde. `OBF_COMMIT` wird von aussen gesetzt, weil `.git` eine
Ebene oberhalb von `src/` liegt und im Container nicht sichtbar ist; ohne die
Angabe fehlt in der Uebersicht nur der Commit.

Voraussetzung ist dieselbe wie bei `axe.mjs`: `playwright-core` in der Version
`1.50.0` aus `npm install`, der Browser kommt aus dem Abbild.

### In der Anwendung lesbar

Die Beschreibungen sind zusaetzlich in der laufenden Anwendung abrufbar, unter
`/dokumentation/oberflaeche` (Uebersicht) und `/dokumentation/oberflaeche/:seite`
(die einzelnen Beschreibungen), erreichbar ueber das Nutzermenue. Das Markdown
wird dafuer serverseitig in HTML uebersetzt (`server/lib/doku/markdown.ts`), denn
im Rohtext liest ein Vorlesewerkzeug Rauten und Sternchen mit; als `h2`, `ol` und
`table` sind sie das, wofuer sie gedacht sind. Der Bildschirmabzug steht am Ende
jeder Seite in einem eigenen Bereich, ausdruecklich als Beiwerk.

Die Seiten sind nur fuer Angemeldete erreichbar, auch die Bildschirmabzuege
(`/api/doku/oberflaeche/bild/:seite`). `axe.mjs` prueft sie mit; die Kapitel liest
es aus der Uebersicht, damit die Liste nicht gepflegt werden muss.

Stellschrauben:

| Umgebungsvariable | Vorgabe | Wirkung |
| --- | --- | --- |
| `OBF_BASE` | `http://localhost:3000` | Adresse der Anwendung. Ueber HTTPS aufrufen, sonst greift das Sitzungscookie nicht. |
| `OBF_USER` / `OBF_PASS` | keine | Anmeldung. Aus der Umgebung, siehe unten. |
| `OBF_OUT` | `docs/oberflaeche` | Ablage der Beschreibungen und Abzuege. |
| `OBF_WIDTH` / `OBF_HEIGHT` | `1500` / `1100` | Fenstergroesse. Steht in jeder Beschreibung, weil der raeumliche Teil davon abhaengt. |
| `OBF_MAXTABS` | `400` | Obergrenze fuer die Tab-Reihenfolge je Seite. Wird sie erreicht, sagt die Beschreibung das. |

### Ergebnis

`docs/oberflaeche/README.md` verweist auf die einzelnen Seiten und nennt Datum
und Commit des Standes. Alle Dateien werden bei jedem Lauf neu geschrieben; von
Hand geaenderte Stellen gehen dabei verloren.

Die Beschreibungen sind selbst zum Vorlesen gedacht: echte Ueberschriften, kurze
Absaetze, Listen. Keine breiten Tabellen, keine Kaesten aus Sonderzeichen, keine
Zeichnungen aus Bindestrichen — die sind mit einem Vorlesewerkzeug unlesbar.

Was dem Skript beim Beschreiben auffaellt — fehlende Beschriftungen, ins Leere
zeigende `aria-describedby`-Verweise, Namen aus einem einzigen Sonderzeichen,
mehrfach vergebene Namen im selben Bereich — steht je Seite unter
„Auffaelligkeiten". Das ist eine Beschreibung, keine Wertung nach WCAG; die
kommt aus `axe.mjs`.

## 4. Kontraste

Beide Farbschemata muessen WCAG AA erfuellen: 4,5:1 fuer Text, 3:1 fuer grosse
Schrift und Bedienelemente. Die Farbwerte stehen ausschliesslich in
`app/assets/css/app.css`, seit dem 31.08.2026 in den beiden daisyUI-Themen
„light" und „dark"; geaendert wird dort und nirgends sonst. Die semantischen
Namen der Anwendung (`--primary`, `--ok`, `--border` …) zeigen auf diese
Themenfarben — eine Palette, zwei Sprechweisen.

Die Umstellung auf Tailwind 4 mit daisyUI 5 hat die Kontraste **nicht**
zurueckgeworfen, weil die Themen mit genau den Werten belegt wurden, die aus
dieser Pruefung stammen. Das ist der Grund, warum eine neue Grundlage nicht
automatisch neue Befunde bedeutet — und der Grund, warum man sie trotzdem
misst: 75 Staende, beide Schemata, nach der Umstellung erneut durchlaufen.

Zwei Fallen, die hier schon zugeschlagen haben:

- **Deckkraft senkt den Kontrast.** `opacity` auf einer Tabellenzeile zieht
  jeden Text darin mit nach unten. Ignorierte Zeilen werden deshalb ueber
  `--row-ignored` eingefaerbt, nicht abgeblendet.
- **Weisse Schrift auf einer hellen Flaeche.** Im dunklen Schema ist
  `--primary` hell; weisser Text darauf kommt auf 2,7:1. Dafuer gibt es
  `--on-primary` und `--on-danger`, die im dunklen Schema auf Dunkel umstellen.
