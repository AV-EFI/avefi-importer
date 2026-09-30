# 3 · Datensätze bearbeiten & validieren

## Datensatz-Liste

Bei einem konvertierten Import öffnet **„✎ Bearbeiten"** die Liste der erzeugten
AVefi-Werke. Je Zeile: Titel (+ Beteiligte), Jahr, Typ, AVefi-PID, Anzahl
Manifestationen/Exemplare, die **Belegung der Kernfelder** und ein
**„ungültig"-Marker**, falls der Datensatz das Schema noch nicht erfüllt.

- **Suche**: filtert die Liste nach Titel/PID.
- **⬇ AVefi-JSON**: lädt das Konvertierungsergebnis des Imports herunter
  (`/imports/<uuid>/avefi.json`).

Die Plakette nennt, wie viele der vier Kernfelder belegt sind — Titel, Regie,
Produktionsdatum und Produktionsland — und färbt sich nach der Verbindlichkeit
des Fehlenden:

| Farbe | Bedeutung |
|---|---|
| Grün | alle vier Kernfelder belegt |
| Gelb | empfohlene Felder fehlen |
| Rot | ein Pflichtfeld fehlt — so lässt sich der Datensatz nicht nach AVefi übernehmen |

Pflicht sind die Felder, die das AVefi-Schema zwingend verlangt: der Haupttitel
und die Werkart. Ein Datensatz, der nur einen Alternativtitel trägt, ist deshalb
rot, auch wenn sonst viel ausgefüllt ist.

## Editor (AVefi-Schema)

Der Editor bearbeitet die **echte AVefi-Struktur** (WorkVariant → Manifestation → Item)
und ist eine interaktive Vue-Oberfläche mit den Reitern **Werk / Manifestationen / Exemplare**.

**Werk-Ebene:**

- **Titel** — beliebig viele Titel, jeder mit **Typ** (`TitleTypeEnum`: PreferredTitle,
  TitleProper, AlternativeTitle, TranslatedTitle …); ein Titel ist der primäre.
- **Schlagwörter · Personen · Orte** (`has_subject`) — pro Eintrag die Art wählen
  (Schlagwort / Person / Körperschaft / Ort). Beim Tippen schlägt das System **proaktiv
  Normdaten** vor (GND, Wikidata, VIAF); ein Klick hängt die ID als `same_as` an
  (sichtbar als Chip). Welche Quellen erlaubt sind, richtet sich pro Feld nach dem Schema.
- **Beteiligte** — Tätigkeit (Regie, Kamera, Musik …) + Person, die Person ebenfalls
  mit GND/Wikidata/VIAF verknüpfbar.
- **Ereignisse, Genre & Form, Identifier, Notizen** — jeweils wiederholbar.

**Manifestation / Exemplar:** Titel, Identifier, Notizen; beim Exemplar zusätzlich
Elementtyp, Farbe, Ton, Bildrate, Zugang, Dauer und Sprachen — alle Auswahllisten
kommen direkt aus dem Schema (`model.schema.json`).

**Speichern** schreibt den Datensatz als JSON, berechnet die Vollständigkeit neu und
aktualisiert `avefi.v1.json`. Über **{ } JSON** lässt sich der erzeugte AVefi-Datensatz
live ansehen.

## Schema-Prüfung

Beim Speichern wird der Datensatz gegen das **echte av-efi-schema**
(WorkVariant / Manifestation / Item, [`model.schema.json`](../src/html/schema/avefi/model.schema.json))
geprüft; Beanstandungen erscheinen als Hinweisliste (Speichern bleibt möglich — Kuratieren
ist iterativ). Der ausführliche Bericht liegt weiterhin unter **Report**.

> Normdaten-Autocomplete: Der Server ruft dafür GND (lobid.org), Wikidata und VIAF ab —
> ein Internet-Ausgang des Servers ist Voraussetzung.

## Prüfbericht (Fehlerreport)

Jeder verarbeitete Import erhält einen **Prüfbericht**. In der Import-Übersicht führt
der Button **„✓ Report"** bzw. **„⚠ Report"** (rot bei Beanstandungen) zur Seite
`/imports/<uuid>/report`. Der Bericht prüft das ausgelieferte `avefi.v1.json` gegen
das **echte av-efi-schema** (Klassen WorkVariant / Manifestation / Item) und zeigt:

- **Kennzahlen**: Datensätze (Werke), geprüfte AVefi-Records, schema-gültig, mit Beanstandung.
- **Parse-Hinweise**: Zeilen/Dateien, die nicht (vollständig) gelesen werden konnten
  (kaputtes CSV/TSV/JSON/XML, fehlende Pflichtspalten …).
- **Schema-Beanstandungen**: je Record die konkreten Verstöße (fehlende Pflichtfelder,
  unzulässige Enum-Werte, falsche/fehlende `category` …).

So lässt sich auch ein **bereits als AVefi eingereichtes, aber fehlerhaftes** Schema
gezielt prüfen: Der Report benennt jeden beanstandeten Record einzeln.

Jede Meldung nennt, soweit bekannt, die Zeile der Quelldatei, die Nummer des
Prüfsatzes, die Quellspalte und das Schemafeld. Zwei dieser Angaben sind Links:
Die Zeile führt zu dem Datensatz, der aus ihr entstanden ist; die Quellspalte führt
in die Zuordnung und klappt die Spalte dort auf.

Die Nummer des Prüfsatzes ist nicht die Datensatznummer der Oberfläche. Geprüft wird
das ausgelieferte Record-Set, und darin steht je Zeile ein Werk, eine Manifestation und
ein Exemplar. Aus Zeile 53 werden also die Prüfsätze 157 bis 159. Für den Abgleich mit
`efi-conv check` auf der Kommandozeile ist die Nummer nützlich, zum Auffinden im
Importer die Zeile.

## Auskunft zum betroffenen Feld

Beim ersten Befund zu einem Zielfeld steht im Bericht, was das Feld bedeutet und —
wenn es eine feste Werteliste hat — welche Werte dort zulässig sind. Bei zwanzig
gleichartigen Meldungen steht die Auskunft einmal, nicht zwanzigmal.

Der Nutzen zeigt sich, wo die Meldung allein nicht weiterhilft:

> „Betacam SP" ist kein zulässiger Wert für „Optischer Datenträger (DVD, Blu-ray …)"
>
> **Zum Feld:** Träger oder Datei, auf der das Exemplar vorliegt.
> **Zulässig sind:** BluRay, CD, DVD, LaserDisc

Betacam SP ist kein optischer Datenträger, sondern ein Videoband. Die Spalte gehört
also nicht auf **Exemplar › Optischer Datenträger**, sondern auf
**Exemplar › Videoband**. Ohne die Werteliste daneben liest sich dieselbe Meldung wie
ein Tippfehler im Wert.

Lange Wertelisten werden nach zwölf Einträgen gekürzt; vollständig stehen sie in der
Auswahlliste des Ziels im Zuordnungs-Editor.

Die Auskunft ist ausdrücklich eine Auskunft und kein Eingriff: Sie sagt, was zulässig
wäre. Gesetzt wird nichts — automatische Korrektur von Validierungsfehlern ist
vertraglich ausgeschlossen.

Zu Beanstandungen, deren Schemafeld kein Ziel des Katalogs ist (etwa `has_identifier`
aus der Schemaprüfung), gibt es keine Feldauskunft. Dort hängt der Hinweis am Code und
steht ohnehin daneben.

## Woher eine Beanstandung kommt

Jede Meldung im Prüfbericht trägt ihre Herkunft, weil die vier Quellen
verschiedenes Gewicht haben:

| Herkunft | Wer prüft | Bedeutung |
|---|---|---|
| **AVefi-Schema** | der Dienst `efi-conv` | Verstoß gegen das Schema des Verbunds. |
| **Satzübergreifend** | derselbe Dienst, über den ganzen Bestand | Eindeutigkeit der Kennungen, auflösbare Verweise, Exemplar je Manifestation. |
| **Vollständigkeit** | diese Anwendung | Regeln, die über das Schema hinausgehen. |
| **Konvertierung** | diese Anwendung | Beim Lesen und Umsetzen der Datei aufgefallen. |

Der Unterschied ist keine Förmlichkeit. **Ein Werk ohne Haupttitel ist
schemakonform** — `has_primary_title` ist am `WorkVariant` nicht verlangt, und
der Prüfdienst gibt einen solchen Datensatz ohne Beanstandung zurück. Diese
Anwendung beanstandet ihn trotzdem, weil ein Werk ohne Titel im Verbund nicht
auffindbar ist. Steht die Herkunft nicht dabei, sieht diese Entscheidung aus wie
eine Vorgabe des Schemas, und eine Diskussion darüber liefe mit dem falschen
Argument.

Bis zum 10.09.2026 speiste die Vollständigkeitsprüfung nur die Plakette in der
Datensatzliste und den Editor, nicht den Bericht. Ein Import ohne jede
Titelangabe wurde deshalb als „keine Beanstandungen" ausgewiesen, während auf
derselben Seite in der Belegungsstatistik „Haupttitel 0 von N" stand.

## Beanstandungen und ihre Behebung

Beim ersten Auftreten einer Beanstandung steht im Bericht ein kurzer Hinweis, was zu
tun ist. Hier stehen dieselben Fälle ausführlich.

### Kennung ist nicht eindeutig

Zwei Sätze der Lieferung tragen dieselbe Kennung. Die Schemaprüfung lässt das nicht
durch, und `efi-conv check` weist die Lieferung ebenfalls ab.

Zwei Ursachen kommen in Frage. Entweder beschreiben die Zeilen wirklich dasselbe Objekt,
dann gehört im Zuordnungs-Editor die Werkbildung darauf eingestellt, damit sie zu einem
Satz zusammenfallen. Oder die Spalte, die auf `has_identifier` zeigt, ist gar keine
Kennung — eine Signaturgruppe etwa oder eine Bestandsnummer, die für mehrere Objekte
gilt. Dann gehört sie einem anderen Ziel zugeordnet, und die Kennung kommt aus einer
anderen Spalte.

### Exemplarkennung doppelt in der Quelldatei

Dasselbe, eine Stufe früher bemerkt: Schon beim Zuordnen fällt auf, dass zwei Zeilen
dieselbe Exemplarkennung tragen. Die Meldung nennt beide Zeilen. Sind es zwei Exemplare,
braucht jedes eine eigene Kennung. Ist es eines, das versehentlich zweimal erfasst wurde,
gehört eine der Zeilen aus der Quelldatei entfernt.

### Verweis zeigt ins Leere

Ein Satz verweist über `is_manifestation_of` oder `is_item_of` auf einen anderen, den
die Lieferung nicht enthält. In aller Regel liegt es daran, dass die Spalte, aus der die
Kennung des Ziels gebildet wird, in dieser Zeile leer war. Prüfe die genannte Zeile in
der Quelldatei; in der Zuordnung hilft ein Festwert oder ein `default`-Konverter, damit
auch leere Zellen eine Kennung ergeben.

### Kein Exemplar zur Manifestation

Zu einer Manifestation gehört kein Exemplar. AVefi verlangt zu jeder Manifestation
mindestens eines, sonst wird die Lieferung abgelehnt. Meist fehlt in der Zuordnung das
Ziel für die Exemplarkennung, oder die Werkbildung fasst Zeilen so zusammen, dass die
Exemplare verlorengehen.

### Normdatentreffer ist mehrdeutig

Ein Name passt auf mehrere Normdatensätze — zwei Personen desselben Namens in der GND
etwa. Der Importer trägt dann bewusst keine ID ein. Anreichern ist keine Umwandlung, und
welcher der beiden gemeint ist, kann nur ein Mensch entscheiden.

Der Befund blockiert nichts; er ist ein Hinweis. Über den Link auf die Spalte lässt sich
in der Zuordnung einstellen, welche Normdatenquellen überhaupt befragt werden — wer nur
GND zulässt, bekommt weniger Mehrdeutigkeiten. Die Auswahl selbst wird pro Datensatz
getroffen: im Datensatz-Editor bei der betroffenen Entität unter `same_as`.

### Verstoß gegen das AVefi-Schema

Der Wert passt nicht zu dem, was das Schema an dieser Stelle erlaubt. Das Schemafeld in
der Meldung nennt die Stelle, der Wert daneben zeigt, woran es lag.

Häufig fehlt nur ein Konverter in der Zuordnung:

| Was das Schema erwartet | Konverter |
|---|---|
| Datum nach ISO 8601 | `date` |
| Laufzeit als Dauer | `duration` |
| Zahl statt Zeichenkette | `number` |
| Wert aus einer festen Liste | `map` mit Wertetabelle |
| Sprachcode | `language` |
| Ländercode | `country` |

### efi-conv kann den Datensatz nicht laden

**Herkunft: AVefi-Schema.** efi-conv liest eine Lieferung, bevor es irgendetwas
prüft, als Datenmodell ein. Passt ein Datensatz nicht in dieses Modell, bricht
`efi-conv check` an ihm ab, und die ganze Datei gilt als abgelehnt. Der Importer
lädt deshalb jeden Datensatz genauso und meldet, woran es scheitert: eine fehlende
Pflichtangabe, ein Wert außerhalb der erlaubten Liste, ein Feld, das es an dieser
Stelle nicht gibt (etwa eine Anmerkung am Werk).

Unter „Wortlaut des Prüfwerkzeugs“ steht, was efi-conv selbst gemeldet hat,
unübersetzt. Das Schemafeld in der Meldung nennt die Stelle. Meist hilft dasselbe
wie oben: ein Konverter, ein anderes Ziel, oder die Spalte nicht übernehmen.

### efi-conv check lehnt den Datensatz ab

**Herkunft: AVefi-Schema.** Über das Datenmodell hinaus wendet `efi-conv check`
einige Regeln an, und der Importer wendet dieselben an:

| Regel | Was zu tun ist |
|---|---|
| Ein Datum hat keine gültige Form | Konverter `date` in die Kette, er bringt Angaben wie „1962“ oder „März 1962“ in die Form JJJJ, JJJJ-MM, JJJJ-MM-TT |
| Ein Zeitraum endet vor seinem Beginn | Die Quelldaten prüfen, meist sind Anfang und Ende vertauscht |
| Ein Titel oder eine Anmerkung ist zu lang | Die Quelle kürzen oder die Spalte einem anderen Ziel zuordnen |
| Ein Name ist leer | Leere Zellen bei Personen, Orten, Genres oder Schlagwörtern prüfen |
| Der Typ des Haupttitels passt nicht zur Ebene | Am Werk Haupttitel oder Archivtitel wählen, an Manifestation und Exemplar Hauptsachtitel oder Archivtitel |
| Ein aufgegebenes Exemplar hat keine PID | Aufgegebene Exemplare (Zugangsstatus „Removed“) werden nur geliefert, wenn sie schon eine AVefi-PID haben; sonst die Zeile weglassen |

Der genaue Wortlaut von efi-conv steht auch hier unter „Wortlaut des Prüfwerkzeugs“.

### Kein Haupttitel

**Herkunft: Vollständigkeit.** Der Datensatz trägt keinen Haupttitel.

Zwei Ursachen kommen infrage. Entweder führt keine Spalte auf einen Titel — dann
meldet das schon der Zuordnungseditor, und „Speichern und konvertieren" ist
gesperrt. Oder die Spalte ist zugeordnet und die Zelle dieser Zeile ist leer;
dann steht die Zeilennummer an der Meldung, und die Korrektur gehört in die
Quelldatei oder in den Datensatz-Editor.

Als Ersatz kann das Werk den Titel der Manifestation oder des Exemplars
übernehmen — das passiert von selbst, sobald dort einer steht.

### Kennung fehlt

Der Satz hat kein `has_identifier`. Ohne Kennung lässt sich später kein PID vergeben,
und Verweise anderer Sätze können ihn nicht finden. In der Zuordnung muss eine Spalte
auf eine Kennung zeigen; wo die Quelle keine hergibt, kann ein Festwert mit laufender
Nummer einspringen.

### Die Schemaprüfung war nicht möglich

Der Prüfdienst war nicht erreichbar. Die Datei wurde erzeugt, aber nicht geprüft — der
Bericht sagt in diesem Fall nichts über die Schemakonformität aus, auch wenn er sonst
leer aussieht. Der Container `avefi_efi_conv` muss laufen; danach setzt
**Neu konvertieren** die Prüfung erneut an.

## AVefi-Ausgabe & natives AVefi

- Für CSV/TSV/JSON/MARC-XML/EAD wird intern gemappt und `avefi.v1.json` als echtes
  AVefi-Record-Set (`WorkVariant` + `Manifestation` + `Item`, verknüpft über
  `LocalResource`-IDs) geschrieben — siehe `AvefiMapper`.
- Ist die Quelle **bereits natives AVefi-JSON** (Array mit `category: "avefi:…"`,
  bzw. `has_record`-Container), wird sie **erkannt und unverändert durchgereicht**
  (kein erneutes Mapping); das Original bleibt erhalten. Beispiel: [`samples/avefi-native.json`](../samples/avefi-native.json).

## Fehlerdetails (Verarbeitungsfehler)

Schlägt die **Verarbeitung** fehl (Status **Fehler**), zeigt die Import-Übersicht
statt „Bearbeiten" einen roten Button **„⚠ Details"** → `/imports/<uuid>/details`.
Die Seite erklärt den Fehler konkret:

- **Stufe & Worker-Meldung**: In welchem Schritt (Download / Erkennung / Konvertierung)
  es hakte und die Roh-Fehlermeldung.
- **Position**: Zeile und Spalte des Fehlers.
- **Code-Ausschnitt**: die betroffene Zeile (± Kontext) mit markierter Fehlerstelle.
- **Lösungshinweis**: was konkret zu tun ist.

Erkannte Fehlerquellen:

| Format | Beispiele |
|--------|-----------|
| **JSON** | Syntaxfehler mit Zeile/Spalte: überzähliges/fehlendes Komma, nicht geschlossene Zeichenkette, fehlender Doppelpunkt, einfache statt doppelter Anführungszeichen, ungültiges Escape … (selbst-enthaltener `JsonLint`) |
| **XML/MARC-XML/EAD** | nicht geschlossene/verschachtelte Tags, ungültige Zeichen — Position via `libxml` |
| **CSV/TSV** | uneinheitliche Spaltenzahl (mit Zeilennummer), fehlende Titel-Spalte, keine Datenzeilen |

## Belegung der Kernfelder

Der Prüfbericht weist aus, wie oft Titel, Regie, Produktionsdatum und Produktionsland
belegt sind, und wie viele Datensätze alle vier tragen. Über diese vier Angaben lässt
sich ein Werk über Häuser hinweg wiedererkennen — Datensätze mit allen vieren eignen
sich für einen Abgleich, bei zweien wird jede Zusammenführung zum Ratespiel.

Beispiel aus der Paderborner Liste: 77 Datensätze, Titel durchgehend belegt,
Produktionsdatum in 74 Prozent, Produktionsland in 61, Regie in 45 — und 31 Datensätze
(40 Prozent) mit allen vier Angaben.
