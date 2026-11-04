---
# 5 · Benutzerverwaltung (Admin)

Administrator:innen öffnen die Verwaltung über das **Avatar-Menü** (oben rechts) →
**Nutzer verwalten** (`/users`). Oben stehen die Konten, darunter die Institutionen.

## Konto anlegen

Formular „Neues Konto anlegen": E-Mail, Name, Institution, optional
Administrator-Rolle. Das Passwort ist wahlweise:

- **vom Server erzeugt** (Voreinstellung) — es erscheint genau einmal in einem
  Fenster und ist danach nirgends mehr im Klartext zu sehen, oder
- **selbst vergeben**, mindestens 12 Zeichen.

Doppelte E-Mail-Adressen werden abgelehnt.

## Konto bearbeiten

**„Bearbeiten"** öffnet die Detailseite:

- **Stammdaten**: Name, Institution, Administrator-Rolle, Aktiv-Status (Login erlaubt).
- **Passwort zurücksetzen**: neues Passwort setzen (mindestens 12 Zeichen) oder eines
  erzeugen lassen.

## Sperren / Entsperren / Löschen

In der Liste je Konto:

- **Sperren / Entsperren** — deaktiviert bzw. reaktiviert den Login (gesperrte Konten
  können sich nicht anmelden).
- **🗑 Löschen** — Konto endgültig entfernen (mit Rückfrage).

## Selbstschutz

Das eigene Konto lässt sich **nicht** sperren, entmachten oder löschen, und die letzte
aktive Administratorin lässt sich nicht löschen — so kann sich niemand versehentlich
aussperren.

## Institutionen

Jedes Konto gehört zu einer Institution und sieht nur die Importe dieser Institution.
Zuordnungsprofile sind für alle sichtbar, die eigenen stehen zuerst. Ein Konto ohne
Institution kann nichts importieren.

Die Karte **„Institutionen"** unter den Konten zeigt je Institution, wie viele Konten,
Importe und Zuordnungsprofile an ihr hängen.

- **Anlegen** — Name eingeben, „Anlegen". Ein Name, den es schon gibt (auch anders groß
  oder klein geschrieben), wird abgelehnt. Die neue Institution steht danach sofort in
  der Auswahl des Kontoformulars.
- **Umbenennen** — „Umbenennen", neuen Namen eingeben, mit Enter speichern oder mit Esc
  abbrechen. Konten, Importe und Profile bleiben, wo sie sind.
- **🗑 Löschen** — nur bei einer Institution, an der **nichts** hängt: keine Konten,
  keine Importe, keine Zuordnungsprofile. Bei allen anderen fehlt der Knopf. Eine
  belegte Institution lässt sich auch nicht über Umwege löschen; der Server prüft das
  beim Löschen noch einmal.

Arbeitet eine Institution nicht mehr mit, **sperrst du ihre Konten**. Archivieren gibt
es nicht.

> Passwörter werden mit **Argon2id** gehasht gespeichert; im Klartext existieren sie
> nur bei der Eingabe. In der Datenbank (Adminer) ist nur der Hash sichtbar.
