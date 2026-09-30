# Mappingprofil-Format

Ein Mappingprofil beschreibt, wie die Spalten einer Tabelle auf das AVefi-Schema
abgebildet werden. Es ist ein Artefakt dieses Importers und **kein
Austauschformat mit efi-conv**: efi-conv sieht nur das fertige Ergebnis, also
AVefi-Datensaetze, nie ein Profil.

Ein Profil enthaelt **keine Zugangsdaten und keine vollstaendigen
Quelldatensaetze**. Es enthaelt Spaltennamen, Konverterketten, Zielangaben,
bestaetigte Normdaten-Zuordnungen und eine Stichprobe von etwa
fuenfundzwanzig Zeilen. Wer ein Profil weitergibt, gibt diese Stichprobe mit;
das ist beabsichtigt, weil sich ein Profil ohne Beispieldaten nicht bearbeiten
laesst, sollte aber bei schutzwuerdigen Bestaenden bedacht werden.

Der Typ steht in `shared/types/domain.ts` (`MappingJson`, `ColumnMapping`,
`TransformStep`, `TargetBinding`, `MappingProfileExport`, `ProfileSample`), die
Konverter in `server/lib/mapping/transform.ts`.

## Aufbau

```jsonc
{
  // Format des Profils selbst. Aendert sich nur, wenn sich der Aufbau aendert.
  // Eine Datei mit unbekannter Zahl wird beim Einlesen abgewiesen, statt
  // halb verstanden zu werden.
  "profileFormatVersion": 1,

  // AVefi-Schemaversion, gegen die gemappt wurde. Wird beim Speichern aus dem
  // geladenen Schema uebernommen. Damit laesst sich spaeter sagen, ob ein
  // Profil noch zum aktuellen Schema passt oder gegen einen aelteren Stand
  // gebaut wurde.
  "avefiSchemaVersion": "https://www.av-efi.net/av-efi-schema/model",

  // Je Quellspalte eine Zuordnung. Schluessel ist der Spaltenname der Kopfzeile.
  "columns": {
    "Titel": {
      // Gemeinsame Kette VOR der Verzweigung. Laeuft einmal.
      "pre": [ { "op": "trim" } ],
      // Ein oder mehrere Ziele. Eine Spalte darf mehrfach landen.
      "targets": [
        { "target": "work.title.primary", "post": [] }
      ]
    },

    "Regie": {
      "pre": [ { "op": "trim" }, { "op": "split", "sep": ";" } ],
      "targets": [
        { "target": "work.activity.director", "post": [] }
      ],
      // Bestaetigte Normdaten-Treffer: Quellwert -> Ressource.
      // Nur was ein Mensch bestaetigt hat, steht hier.
      //
      // Je Quellwert kann EINE Zuordnung stehen oder eine Liste — eine je
      // Normdatenquelle. Frueher gab es nur die Einzelform; wer erst GND und
      // dann VIAF bestaetigte, ueberschrieb damit die erste Entscheidung, ohne
      // dass etwas darauf hinwies. Die Einzelform bleibt gueltig und gilt als
      // GND, damit aeltere Profile weiter greifen.
      "authorities": {
        "Herbert Selpin": { "id": "118613766", "type": "GNDResource", "label": "Selpin, Herbert" },
        "Heinz Sielmann": [
          { "id": "118614371", "type": "GNDResource", "label": "Sielmann, Heinz" },
          { "id": "24608912", "type": "VIAFResource" }
        ]
      }
    },

    "Color": {
      "pre": [ { "op": "trim" } ],
      "targets": [ { "target": "item.colour_type", "post": [] } ],
      // Zuordnung von Quellwerten auf Vokabularwerte des Schemas.
      "valuemap": { "Farbe": "Colour", "s/w": "BlackAndWhite" }
    },

    // Ausdruecklich ignoriert. Bewusste Entscheidung, kein Versehen.
    "Ausgeliehen am an": { "ignore": true }

    // Eine Spalte, die weder "targets" noch "ignore" hat, gilt als
    // NOCH NICHT ANGEFASST — siehe „Die drei Spaltenzustaende".
  },

  // Festwerte, die fuer jede Zeile gelten. Zum Beispiel das eigene Haus,
  // das in der Tabelle nirgends steht.
  "defaults": [
    { "target": "item.access_status", "value": "OnSiteAccess" }
  ],

  // Was eine Zeile darstellt: ein Exemplar, eine Manifestation oder ein Werk.
  "row": { "represents": "item" },

  // Zusammenfassung mehrerer Zeilen. Leere Liste = keine Zusammenfassung.
  "grouping": {
    "work": { "by": [ "target:work.title.primary" ] },
    "manifestation": { "by": [] }
  }
}
```

## Die drei Spaltenzustaende

Eine Spalte ist **gemappt**, **ausdruecklich ignoriert** oder **noch nicht
angefasst**. Die Unterscheidung ist der Grund fuer das Kennzeichen
`complete`.

| Zustand | Woran erkennbar | Bedeutung |
|---|---|---|
| gemappt | `targets` vorhanden und nicht leer | Der Wert wandert an mindestens ein Ziel. |
| ignoriert | `ignore: true` | Jemand hat entschieden, dass die Spalte nicht gebraucht wird. |
| noch nicht angefasst | weder `targets` noch `ignore` | Es gibt keine Entscheidung. |

Ein Profil gilt erst als vollstaendig, wenn keine Spalte mehr im dritten Zustand
ist **und** mindestens eine Spalte tatsaechlich irgendwohin fuehrt. Ein Profil,
in dem alles ignoriert ist, erzeugt keine Datensaetze und ist deshalb nicht
fertig.

Ohne diesen dritten Zustand liesse sich „nicht gebraucht" nicht von „noch nicht
angeschaut" unterscheiden. Jemand speichert dann ein halbes Profil und wundert
sich ueber leere Datensaetze. Der Editor zeigt die offenen Spalten deshalb
gesondert an.

## Die Verzweigung: `pre` und `targets[{target, post}]`

Eine Spalte laeuft durch **eine** gemeinsame Vorkette (`pre`) und verzweigt
danach auf ein oder mehrere Ziele, jedes mit einer eigenen Nachkette (`post`).

```jsonc
"Länge": {
  "pre": [ { "op": "trim" } ],
  "targets": [
    { "target": "item.duration",     "post": [ { "op": "duration", "unit": "minutes" } ] },
    { "target": "item.note",         "post": [ { "op": "suffix", "value": " Minuten" } ] }
  ]
}
```

Der Wert wird einmal getrimmt, dann laufen zwei verschiedene Nachketten. Ohne
die Trennung muesste die gemeinsame Vorarbeit je Ziel wiederholt werden, und
zwei Kopien einer Kette laufen erfahrungsgemaess auseinander.

Die Reihenfolge ist immer `pre` zuerst, dann `post` des jeweiligen Ziels.

## Konverteroperationen

Jeder Schritt ist ein Objekt mit `op` und Parametern — nie ein nackter String.
Sobald eine Operation einen Parameter braucht, gaebe es sonst zwei Formen fuer
dieselbe Sache.

Jede Operation nimmt einen Typ herein und gibt einen heraus: `text`
(Einzelwert), `list`, `number` oder `any` (beliebig). `same` heisst, der Typ
bleibt. Daraus laesst sich der Ausgabetyp einer Kette bestimmen, ohne sie
auszufuehren; der Editor beanstandet eine Kette, die eine Liste in ein
einwertiges Ziel schreiben will, bevor Daten fliessen.

Operationen, die auf einer Liste stehen, arbeiten elementweise. Leere Ergebnisse
fallen dabei weg.

### Text

| `op` | herein → heraus | Parameter |
|---|---|---|
| `trim` | any → gleich | `chars` (optional): zusaetzliche Zeichen |

```jsonc
{ "op": "trim" }                    // "  Der Film  " -> "Der Film"
{ "op": "trim", "chars": ".*" }     // "**Der Film.." -> "Der Film"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `lowercase` | any → gleich | keine |
| `uppercase` | any → gleich | keine |

```jsonc
{ "op": "lowercase" }               // "Der FILM" -> "der film"
{ "op": "uppercase" }               // "16 mm"    -> "16 MM"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `titlecase` | any → gleich | `words` (optional, wahr/falsch) |

Ohne `words` wird nur der erste Buchstabe gross. Mit `words` jedes Wort, wobei
auch Bindestriche, Klammern und Apostrophe als Wortgrenze zaehlen.

```jsonc
{ "op": "titlecase" }                  // "der film" -> "Der film"
{ "op": "titlecase", "words": true }   // "der film" -> "Der Film"
                                       // "jean-luc" -> "Jean-Luc"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `replace` | any → gleich | `search` (Pflicht), `with` (optional, Vorgabe leer) |

Einfacher Textersatz, kein regulaerer Ausdruck. Ersetzt alle Vorkommen.

```jsonc
{ "op": "replace", "search": "u. a.", "with": "unter anderem" }
{ "op": "replace", "search": "[unbekannt]" }   // entfernt den Text
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `regex` | any → gleich | `pattern` (Pflicht), `with`, `capture`, `flags` |

Zwei Betriebsarten. Ohne `capture` wird ersetzt, mit `capture` wird
herausgeloest — dann liefert die Operation genau die angegebene Klammergruppe,
und ein nicht passender Wert wird beanstandet. `flags` versteht `i`
(Gross/Klein egal) und `g` (alle Vorkommen); `u` ist immer gesetzt.

```jsonc
// Ersetzen: mehrfache Leerzeichen zusammenziehen
{ "op": "regex", "pattern": "\\s{2,}", "with": " ", "flags": "g" }

// Herausloesen: Jahreszahl aus "Deutschland 1935 (Erstauff.)"
{ "op": "regex", "pattern": "(\\d{4})", "capture": 1 }   // -> "1935"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `only` | any → gleich | `pattern` (Pflicht), `negate`, `capture`, `flags` |

Der Waechter. Er laesst den Wert durch oder macht ihn leer — und weil leere
Ergebnisse ohnehin wegfallen, waehlt er damit einen Zweig aus. Mit `negate`
kehrt sich die Bedingung um, mit `capture` wird zugleich eine Klammergruppe
herausgeloest. Beides zusammen ist widerspruechlich und wird beanstandet: Was
nicht passt, hat keine Gruppe.

Ein nicht passender Wert wird **nicht** beanstandet. Das ist der Unterschied
zu `regex` mit `capture`, und er ist beabsichtigt: In einem Zweigpaar passt
eine Seite naturgemaess nie. Sichtbar wird die Aufteilung stattdessen als
Bilanz im Pruefbericht (siehe unten). Ein leerer Wert bleibt leer, auch beim
umgekehrten Waechter — sonst zoege der jede leere Zelle in seinen Zweig.

```jsonc
{ "op": "only", "pattern": "^\\[(.*)\\]$", "capture": 1 }   // "[Titel]" -> "Titel", sonst leer
{ "op": "only", "pattern": "^\\[.*\\]$", "negate": true }   // "[Titel]" -> leer, sonst unveraendert
```

### Eine Spalte, zwei Bedeutungen

Der Anlass war eine Titelspalte, in der eingeklammerte Werte Archivtitel sind
und alle uebrigen Haupttitel. Beide Ziele liegen auf `has_primary_title`, und
das ist einwertig: Bekaemen beide denselben Wert, verschwaende einer davon.

```jsonc
"Titel": {
  "pre": [ { "op": "trim" } ],
  "targets": [
    { "target": "work.title.primary",
      "post": [ { "op": "only", "pattern": "^\\[[^\\[\\]]*\\]$", "negate": true } ] },
    { "target": "work.title.supplied",
      "post": [ { "op": "only", "pattern": "^\\[([^\\[\\]]*)\\]$", "capture": 1 } ] }
  ]
}
```

Beide Zweige tragen dasselbe Muster, einer davon umgekehrt — nur so sind sie
komplementaer. Der Archivtitel-Zweig loest zugleich die Klammergruppe heraus
und schneidet die Klammern damit ab; warum das hier steht und nicht im Code,
sagt der naechste Abschnitt.

Je Zeile liefert genau ein Zweig etwas. Es gibt bewusst kein `if`-`then`-`else`
im Profil: Die Verzweigung liegt weiterhin in `targets`, jeder Zweig bleibt
eine gerade Schrittfolge, und der Editor kann den Ausgangstyp einer Kette
weiterhin bestimmen, ohne sie auszufuehren.

### Eckige Klammern am Titel

Das Abschneiden steht im Profil, nicht im Code, und das hat einen Grund. Ob
eine Klammer Kennzeichnung oder Titelbestandteil ist, ist keine Konvention,
sondern eine Entscheidung:

* Liest jemand den Wert als **Archivtitel**, hat die Klammer ihren Zweck
  erfuellt — der Typ `SuppliedDevisedTitle` sagt dasselbe — und gehoert weg.
* Bleibt der Wert ein **Haupttitel**, sagt derjenige damit „das sind keine
  Archivtitel". Dann war die Klammer nie Kennzeichnung, sondern ein Zeichen im
  Titel, und sie zu entfernen veraenderte Daten.

Im Zweigpaar stellt sich die Frage gar nicht: Der Haupttitel-Zweig bekommt nur
die nicht eingeklammerten Werte. Sichtbar wird der Unterschied nur, wenn jemand
den Vorschlag ablehnt und die Spalte beim Haupttitel laesst — dann bleiben die
Klammern stehen, und genau so ist es gemeint.

Das Muster laesst innen keine weiteren Klammern zu: `^\[[^\[\]]*\]$`. Sonst
zerlegte das gierige `.*` einen Wert wie `[a] und [b]` beim Abschneiden zu
`a] und [b`. Weil Erkennung, Waechter und Abschneiden dasselbe Muster
verwenden, faellt ein solcher Wert einheitlich durch: Er gilt nicht als
Klammertitel, der Waechter des Haupttitel-Zweigs laesst ihn durch, und er
behaelt seine Klammern.

Zwei Dinge, auf die es dabei ankommt. Die Muster muessen **komplementaer**
sein, sonst faellt eine Zeile durch beide Zweige und steht hinterher nirgends;
genau dafuer gibt es die Zweigbilanz. Und sie sollten **verankert** sein:
`^\[.*\]$` trifft `[ohne Titel]`, aber nicht `Der blaue Engel [Fragment]` —
der ist ein Haupttitel mit einem Zusatz, kein Archivtitel.

Sobald eine Spalte mehrere Ziele hat und mindestens eine Kette einen Waechter
traegt, nennt der Pruefbericht die Aufteilung im Klartext:

    Aufteilung der Spalte in den 55 betrachteten Zeilen:
    Haupttitel: 43, Archivtitel: 12. Jede davon wurde einem Zweig zugeordnet.

Die letzte Angabe ist die eigentliche Pruefung. Steht dort stattdessen, dass
Zeilen keinen Zweig getroffen haben, decken die Muster nicht alles ab.

| `op` | herein → heraus | Parameter |
|---|---|---|
| `prefix` | any → gleich | `value` (Pflicht) |
| `suffix` | any → gleich | `value` (Pflicht) |

Beide lassen leere Werte unberuehrt; aus nichts wird kein Praefix.

```jsonc
{ "op": "prefix", "value": "Signatur " }   // "3000040K" -> "Signatur 3000040K"
{ "op": "suffix", "value": " m" }          // "120"      -> "120 m"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `default` | any → gleich | `value` (Pflicht) |

Setzt einen Wert, wenn der Eingang leer ist. Bei Listen zaehlt die leere Liste
als leer.

```jsonc
{ "op": "default", "value": "Unbekannt" }   // "" -> "Unbekannt", "Farbe" -> "Farbe"
```

### Struktur

| `op` | herein → heraus | Parameter |
|---|---|---|
| `split` | text → **list** | `sep` (Vorgabe `;`), `unique` (optional) |

Trennt, trimmt jedes Stueck und wirft leere Stuecke weg. `unique` entfernt
Doppelte unter Beibehaltung der Reihenfolge.

```jsonc
{ "op": "split", "sep": ";" }
// "Selpin; Harlan ; Selpin" -> ["Selpin","Harlan","Selpin"]

{ "op": "split", "sep": ";", "unique": true }
// "Selpin; Harlan ; Selpin" -> ["Selpin","Harlan"]
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `join` | list → **text** | `sep` (Vorgabe `"; "`) |

```jsonc
{ "op": "join", "sep": " / " }   // ["a","b"] -> "a / b"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `take` | list → **text** | `index` (Pflicht) |

Position ab 1. Negative Werte zaehlen von hinten, `-1` ist das letzte Element.
Greift der Index ins Leere, kommt ein leerer Wert heraus.

```jsonc
{ "op": "take", "index": 1 }    // ["Selpin","Harlan"] -> "Selpin"
{ "op": "take", "index": -1 }   // ["Selpin","Harlan"] -> "Harlan"
```

`take` und `join` sind die beiden Wege, eine Liste in ein einwertiges Ziel zu
bekommen. Fehlt beides, blockiert der Editor das Speichern — hier wird nicht
gewarnt, sondern verhindert, weil das Ergebnis strukturell nicht passt.

### Typen

| `op` | herein → heraus | Parameter |
|---|---|---|
| `number` | text → **number** | `decimal` (Vorgabe `,`) |

Wirft alles weg, was keine Ziffer, kein Minus und kein Dezimalzeichen ist, und
beanstandet einen nicht leeren Wert, aus dem sich keine Zahl ergibt.

```jsonc
{ "op": "number" }                      // "1.234,5 m" -> 12345 ... siehe Hinweis
{ "op": "number", "decimal": "," }      // "120,5"     -> 120.5
```

Hinweis: Tausendertrennzeichen werden nicht erkannt. Steht in der Quelle
`1.234,5`, wird der Punkt entfernt und `1234,5` gelesen — das stimmt fuer die
deutsche Schreibweise. Bei englischer Schreibweise `1,234.5` ist
`{"op":"number","decimal":"."}` richtig.

| `op` | herein → heraus | Parameter |
|---|---|---|
| `boolean` | text → text | `whenTrue` (Vorgabe `true`), `whenFalse` (Vorgabe `false`) |

Erkennt `ja`, `j`, `yes`, `y`, `true`, `wahr`, `1`, `x`, `✓`, `vorhanden` als Ja
und `nein`, `n`, `no`, `false`, `falsch`, `0`, `-`, `keine`, `nicht vorhanden`
als Nein. Ein leerer Wert bleibt leer, alles andere wird beanstandet.

```jsonc
{ "op": "boolean", "whenTrue": "Sound", "whenFalse": "Silent" }
// "ja" -> "Sound", "nein" -> "Silent"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `date` | text → text | `from` (optional) |

Ergebnis ist ISO: `JJJJ`, `JJJJ-MM` oder `JJJJ-MM-TT` — zugleich EDTF-konform.
Ohne `from` werden der Reihe nach erkannt: bereits ISO, `T.M.JJJJ`, `M.JJJJ`,
`M/T/JJJJ` und zuletzt eine vierstellige Jahreszahl irgendwo im Text. Mit `from`
wird ein festes Quellformat gelesen; die Buchstaben folgen der PHP-Schreibweise
und sind `d`, `j`, `m`, `n`, `Y`, `y`.

```jsonc
{ "op": "date" }                      // "14.03.1935" -> "1935-03-14"
                                      // "um 1935"    -> "1935"
{ "op": "date", "from": "d.m.Y" }     // "03.14.1935" wird NICHT gelesen
{ "op": "date", "from": "m/d/Y" }     // "03/14/1935" -> "1935-03-14"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `duration` | text → text | `unit`: `minutes`, `seconds`, `hours`, `auto` |

Das AVefi-Schema verlangt genau `PT[hh]H[mm]M[ss]S` mit mindestens
zweistelligen Werten; einstellige Angaben sind nicht schemakonform. Die
Operation normalisiert entsprechend. `hh:mm:ss` und `mm:ss` werden ohne `unit`
erkannt; eine nackte Zahl wird nach `unit` gedeutet, `auto` nimmt Minuten, weil
das in Filmlisten der Normalfall ist.

```jsonc
{ "op": "duration", "unit": "minutes" }   // "20"       -> "PT00H20M00S"
{ "op": "duration", "unit": "seconds" }   // "1245"     -> "PT00H20M45S"
{ "op": "duration" }                      // "1:20:45"  -> "PT01H20M45S"
                                          // "PT1H5M0S" -> "PT01H05M00S"
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `country` | any → gleich | `unknown`: `keep`, `drop`, `error` |

Fuehrt Schreibweisen zusammen: `DE`, `DEU`, `D`, `BRD` und `Deutschland` ergeben
denselben Namen. Die GND-ID des Landes wandert ueber den Anreicherungskanal mit
(siehe unten), der Wert selbst bleibt der Name.

```jsonc
{ "op": "country", "unknown": "keep" }    // "BRD" -> "Deutschland" (+ GND-ID)
{ "op": "country", "unknown": "error" }   // "Xyz" -> leer, mit Beanstandung
```

| `op` | herein → heraus | Parameter |
|---|---|---|
| `language` | any → gleich | `unknown`: `keep`, `drop`, `error` |

Nach ISO 639-2/B. Eine eingebaute Rueckfalltabelle deckt ab, was in deutschen
Filmlisten vorkommt; alles weitere kommt aus der vollstaendigen Tabelle.

```jsonc
{ "op": "language" }        // "Deutsch" -> "ger", "en" -> "eng", "stumm" -> "zxx"
```

### Vokabular und Normdaten

| `op` | herein → heraus | Parameter |
|---|---|---|
| `map` | any → gleich | `map` (Pflicht), `ci` (optional), `fallback` |

Bildet Quellwerte auf Vokabularwerte ab. `ci` macht Gross- und Kleinschreibung
egal. `fallback` bestimmt, was mit einem unbekannten Wert geschieht:

* `keep_note` (Vorgabe): der Wert wird als Notiz gerettet statt weggeworfen,
* `drop`: verwerfen,
* `keep`: unveraendert uebernehmen,
* `error`: beanstanden.

```jsonc
{
  "op": "map",
  "map": { "Farbe": "Colour", "s/w": "BlackAndWhite", "koloriert": "Colour" },
  "ci": true,
  "fallback": "keep_note"
}
// "FARBE" -> "Colour"; "Sepia" -> leer, wandert als Notiz mit
```

Der Kurzname `valuemap` wird als Alias von `map` weiterhin gelesen. Steht die
Zuordnung im Feld `valuemap` der Spalte, benutzt der Editor sie fuer die
Vokabularansicht.

| `op` | herein → heraus | Parameter |
|---|---|---|
| `authority` | any → gleich (langsam) | `source`: `gnd`, `wikidata`, `viaf`; `kind`: `person`, `corporate`, `place`, `subject` |

**Anreichern ist keine Umwandlung.** Der Konverter aendert den Wert nicht,
sondern meldet den Treffer ueber einen Nebenkanal; der Builder haengt ihn als
`same_as` an die erzeugte Entitaet. Vorher wurde der Name mit der ID
ueberschrieben — bei einem Regie-Feld stand dann die GND-Nummer im Namen.

Eine im Feld `authorities` der Spalte bestaetigte Zuordnung schlaegt die
Automatik — aber nur die zu **derselben Quelle**. Ein bestaetigter GND-Treffer
laesst eine VIAF-Abfrage im selben Zweig unberuehrt. Ein bestaetigter Eintrag
mit leerer `id` heisst „bewusst offen gelassen" und unterbindet die
automatische Suche fuer diese Quelle.

**Mehrere Normdatenquellen duerfen im selben Zweig stehen.** Jede meldet ihren
Treffer eigenstaendig, und der Builder haengt alle als `same_as` an — soweit das
Schema die Ressourcenart am Ziel zulaesst. Getrennte Zweige braucht es dafuer
nicht. Bis zum 31.08.2026 kam trotzdem nur die erste Quelle im Export an: Der
Bedarf wurde je Kette nur fuer den ersten `authority`-Schritt gesammelt, die
zweite Quelle wurde also nie gefragt.

Die Oberflaeche prueft ausserdem, ob `kind` zum Ziel passt. Ein GND-Abgleich mit
`kind: person` auf einem Ortsziel findet nie etwas und sah bisher aus wie „nichts
gefunden".

**Reihenfolge:** Nachschlagende Konverter (`authority`, `country`, `language`,
`map`) gehoeren ans Ende der Normalisierung. Steht hinter ihnen noch ein `trim`
oder ein `split`, sucht die Abfrage den unfertigen Wert, waehrend die Kette am
Ende einen anderen liefert. Der Editor fuegt neue Konverter an der empfohlenen
Stelle ein und warnt bei dieser Anordnung; erzwungen wird sie nicht — `trim`
NACH `split` ist richtig und wirkt dann auf jedes Element.

```jsonc
{ "op": "authority", "source": "gnd", "kind": "person" }
// "Herbert Selpin" bleibt "Herbert Selpin";
// zusaetzlich entsteht same_as -> avefi:GNDResource 118613766
```

Die Anreicherung ist standardmaessig ausgeschaltet (`AUTHORITY_ENABLED`) und
vertraglich nicht geschuldet.

### Altlasten

Diese Operationen stammen aus der PHP-Version. Sie werden weiterhin ausgefuehrt,
damit alte Profile nicht brechen, erscheinen im Editorkatalog aber nicht mehr.

| `op` | Nachfolger | Parameter |
|---|---|---|
| `template` | `prefix` / `suffix` | `pattern` mit Platzhalter `{value}` |
| `year` | `regex` mit `capture` | keine |
| `substring` | kein Nachfolger | `start`, `length` (optional, negativ erlaubt) |

```jsonc
{ "op": "template", "pattern": "Sig. {value}" }   // "40K" -> "Sig. 40K"
{ "op": "year" }                                  // "um 1935" -> "1935"
{ "op": "substring", "start": 0, "length": 4 }    // "3000040K" -> "3000"
```

`concat` („Spalten verbinden") stand bis zum 30.09.2026 ebenfalls hier. Er ist
wieder im Editorkatalog, weil ihn eine Tabelle mit Artikel und Titel in zwei
Spalten braucht:

```jsonc
{ "op": "concat", "columns": ["Titel"], "sep": " " }   // an der Spalte "Artikel": "Die" -> "Die Kinder des Olymp"
```

Der eigene Wert kommt zuerst, dahinter die genannten Spalten; leere Teile
entfallen samt Trennzeichen. `concat` ist die einzige Operation, die die ganze
Quellzeile braucht; alle anderen sehen nur ihren Wert.

Zwei aeltere Namen werden zur Laufzeit uebersetzt: `ucfirst` wird zu
`titlecase`, `valuemap` zu `map`.

## `dismissed` — abgelehnte Vorschlaege

Die Vorschau meldet Hinweise, die sich erst an den Daten zeigen. Der haeufigste
ist der Aufteilungs-Vorschlag: Die Werte einer Spalte tragen ein Trennzeichen,
und das Ziel nimmt mehrere Werte auf. Der Hinweis wird angeboten, nie von
selbst angewandt.

Wer ihn ablehnt, trifft eine Entscheidung ueber das Mapping, und die steht
deshalb im Profil:

```json
"Inhalt": {
  "targets": [ { "target": "item.note", "post": [] } ],
  "dismissed": [
    { "code": "data.separator", "target": "item.note", "sep": ";" }
  ]
}
```

`code` nennt den Hinweis, `target` das Ziel, auf das er sich bezog, `sep` bei
Aufteilungs-Vorschlaegen das vorgeschlagene Trennzeichen. Die Ablehnung gilt
genau fuer diese Kombination: Steht in derselben Spalte ein anderes
Trennzeichen zur Debatte, wird wieder gefragt.

Die Angabe wandert mit dem Profil — wer es exportiert und woanders einliest,
bekommt die Entscheidung mit, wie bei bestaetigten Normdaten auch. Sie ist
nicht ergebnisrelevant: Dieselbe Datei mit demselben Profil erzeugt dasselbe
AVefi-JSON, ob der Hinweis nun abgelehnt wurde oder nicht. Deshalb bleibt die
Profilformat-Version bei 1; aeltere Leser ueberspringen das Feld, ohne dass
sich am erzeugten Ergebnis etwas aendert.

Die Oberflaeche fuehrt die abgelehnten Vorschlaege unter der Pruefleiste auf
und laesst sie zurueckholen. Ein spurlos verschwundener Vorschlag waere spaeter
nicht mehr von einem zu unterscheiden, der nie kam.

## `defaults`

Festwerte, die fuer jede Zeile gelten, unabhaengig von den Spalten. Sie sind
dafuer da, was in der Tabelle nirgends steht — das eigene Haus, ein
Zugangsstatus, eine Werkart, die fuer die ganze Lieferung gilt.

```jsonc
"defaults": [
  { "target": "work.type", "value": "Monographic" },
  { "target": "item.access_status", "value": "OnSiteAccess" }
]
```

Ein Festwert auf ein unbekanntes Ziel ist ein Fehler und blockiert das
Speichern. Ist kein Ziel `work.title.primary` belegt — weder durch eine Spalte
noch durch einen Festwert — warnt der Editor; ersatzweise wird der Titel der
Manifestation oder des Exemplars uebernommen.

## `row.represents`

Sagt, was **eine Zeile** darstellt: `item`, `manifestation` oder `work`.

Der haeufige Fall ist `item`: Eine Zeile einer Archivliste ist ein physisches
Exemplar. Aus ihr entstehen dann trotzdem drei Knoten — Werk, Manifestation und
Exemplar —, weil das AVefi-Schema diese Kette verlangt; Werk und Manifestation werden
aus den Angaben der Zeile abgeleitet und ueber lokale Kennungen
(`r<n>_work`, `r<n>_manifestation`) miteinander verbunden.

## `grouping`

Fasst mehrere Zeilen zu einem Werk beziehungsweise einer Manifestation zusammen. Eine
leere Liste heisst: keine Zusammenfassung, jede Zeile ergibt ein eigenes Werk.
Das ist die Vorgabe.

```jsonc
"grouping": {
  "work": { "by": [ "target:work.title.primary", "target:work.production.date" ] },
  "manifestation": { "by": [] }
}
```

Zwei Schluesselformen sind moeglich:

* `target:<Zielschluessel>` — der **gemappte** Wert,
* `column:<Spaltenname>` — der Rohwert der Spalte.

Bevorzugt wird `target:`. Der Grund ist die Normalisierung: Nach `trim` und
Kleinschreibung fallen `"Die Wilden Kerle "` und `"die wilden kerle"` zusammen,
auf dem Rohwert nicht. Der Schluessel wird als MD5 ueber die verketteten,
getrimmten und kleingeschriebenen Teile gebildet und gilt nur innerhalb eines
Imports.

Sind alle Teile leer, wird nicht zusammengefasst — sonst landeten alle Zeilen
ohne Titel in einem gemeinsamen Werk.

Der Pruefbericht nennt die verwendete Regel im Klartext, etwa
`"grouping": "Haupttitel"` oder
`"keine Zusammenfassung — jede Zeile ein eigenes Werk"`.

## Zielschluessel

Die Ziele stammen aus einem kuratierten Katalog
(`server/lib/mapping/targets.ts`), nicht aus freien Pfadausdruecken. AVefi ist
tief verschachtelt: Eine Regie-Spalte landet unter `has_event` →
`ProductionEvent` → `has_activity` → `DirectingActivity` → `has_agent` →
`has_name`. Das laesst sich nicht zuverlaessig tippen, und jeder Tippfehler
erzeugt schemawidriges JSON. Der Katalog nennt stattdessen
„Werk > Beteiligte > Regie" und weiss selbst, wie der Knoten entsteht.

Die Schluessel folgen dem Muster `<ebene>.<gruppe>.<name>`:

| Ebene | Beispiele |
|---|---|
| `work.` | `work.title.primary`, `work.title.supplied`, `work.title.alternative`, `work.type`, `work.form`, `work.genre`, `work.production.date`, `work.production.place`, `work.activity.director`, `work.subject.topic`, `work.identifier.local`, `work.same_as.gnd` |
| `manifestation.` | `manifestation.title.primary`, `manifestation.publication.date`, `manifestation.note`, `manifestation.webresource`, `manifestation.identifier.local` |
| `item.` | `item.identifier.local`, `item.element_type`, `item.colour_type`, `item.sound_type`, `item.frame_rate`, `item.access_status`, `item.duration`, `item.extent.metre`, `item.language.spoken`, `item.language.subtitles`, `item.note` |

### Titel

`TitleTypeEnum` kennt dreizehn Typen (FIAF Moving Image Cataloguing Manual
A.2). Sie verteilen sich auf zwei Schemaplaetze, und der Unterschied ist
wichtig.

`has_primary_title` ist einwertig und am Werk Pflicht. Dorthin fuehren je
Ebene genau zwei Ziele: der ebenentypische Titel (`work.title.primary` mit
`PreferredTitle`, an Manifestation und Exemplar `TitleProper`) und
`*.title.supplied` mit `SuppliedDevisedTitle` — der Archivtitel, den das
Schema ausdruecklich fuer den Fall vorsieht, dass ein Film keinen eigenen
Titel traegt.

Formal erzwungen ist diese Beschraenkung nicht; `has_primary_title` ist im
Schema schlicht ein `Title`, und `efi-conv check` liesse auch einen
Arbeitstitel durch. Der Katalog haelt sie trotzdem ein, und zwar aus einem
praktischen Grund: Auf dem einwertigen Platz gewinnt der erste Wert, spaetere
werden nicht uebernommen. Dreizehn Ziele auf einem Platz hiessen zwoelf
moegliche Verluste, deren Ausgang an der Reihenfolge im Profil haengt. Kommt
es dort trotzdem zum Zusammenstoss, nennt der Pruefbericht ihn.

Die uebrigen zehn Typen sind mehrwertig und fuehren auf
`has_alternative_title`: `alternative`, `series`, `working`, `translated`,
`transliterated`, `abbreviated`, `acquisition`, `corrected`, `prerelease`,
`search`. Sie gibt es auf allen drei Ebenen.

Jeder Eintrag traegt Bezeichnung, Ebene, Gruppe, Typ, ob er mehrwertig ist, und
den vollstaendigen Schemapfad; den zeigt der Editor an, wie es der Vertrag
verlangt. Enums und Muster stammen aus dem geladenen Schemamodell, damit der
Katalog dem echten `av-efi-schema` folgt und nicht daneben altert. Die
vollstaendige Liste liefert `GET /api/records/config`.

## Stichprobe (`sample`)

```jsonc
"sample": {
  "columns": ["Titel", "Signatur", "Länge"],
  "rows": [ ["Sicherheit im Haushalt", "3200161", "10"] ],
  // Je Spalte die verschiedenen gefuellten Werte mit Haeufigkeit —
  // Grundlage der Vokabularansicht im Editor.
  "values": { "Color": [ { "value": "Farbe", "count": 61 }, { "value": "s/w", "count": 16 } ] },
  // Belegung je Spalte: gefuellt in X von Y Zeilen.
  "coverage": { "Regie": { "filled": 12, "total": 77 } }
}
```

Ohne Stichprobe verweigert der Editor den Dienst: Er kann dann keine Vorschau
rechnen, und eine Zuordnung, deren Wirkung man nicht sieht, ist geraten. In der
PHP-Version fehlte die Stichprobe in aelteren Exporten, und ein eingelesenes
Profil liess sich nicht mehr bearbeiten. Fuer solche Faelle gibt es
`POST /api/mappings/:id/sample`, womit sich Beispieldaten nachreichen lassen;
die Kopfzeile muss dabei zum Profil passen.

## Export und Wiedereinlesen

`GET /api/mappings/:id/export` liefert eine Datei mit Kopf:

```jsonc
{
  "origin": {
    "application": "avefi-importer",
    "exportedAt": "2026-08-25T18:00:00.000Z",
    "profileName": "Testperson 1 UPB",
    "profileVersion": 40,
    "institution": "Deutsches Filminstitut"
  },
  "profileFormatVersion": 1,
  "avefiSchemaVersion": "https://www.av-efi.net/av-efi-schema/model",
  "baseFormat": "csv",
  // md5 ueber normalisierte, sortierte Spaltennamen plus Basisformat.
  // Damit findet der Importer zu einer neuen Datei das passende Profil.
  "headerHash": "42b7983ba6…",
  "mapping": { /* MappingJson wie oben */ },
  "sample": { /* ProfileSample, muss mit */ }
}
```

`POST /api/mappings` liest eine solche Datei wieder ein. Fremde Dokumente werden
abgewiesen; geprueft werden `origin.application`, `profileFormatVersion` und die
Struktur des Mappings. Unbekannte Operationen und unbekannte Ziele werden
gemeldet, nicht stillschweigend uebergangen.

Der `headerHash` ist der Anker: Beim Erkennen einer Datei berechnet der Importer
denselben Hash und schlaegt das passende Profil vor. Ein Profil der eigenen
Institution wird dabei bevorzugt.

## Versionen

Jedes Speichern erzeugt eine neue Version; die alte bleibt in
`mapping_profile_versions` erhalten und laesst sich mit
`POST /api/mappings/:id/restore` zurueckholen. Wiederherstellen loescht nichts —
der aktuelle Stand wird vorher selbst als Version abgelegt.

Ein Import merkt sich in `mapping_profile_id` und `mapping_version`, mit welchem
Stand er entstanden ist. Aendert sich das Profil, aendern sich bestehende
Importe **nicht**; wer das will, konvertiert mit
`POST /api/imports/:id/reconvert` neu. Umbenennen erzeugt keine neue Version,
weil der Name keine Zuordnung ist.
