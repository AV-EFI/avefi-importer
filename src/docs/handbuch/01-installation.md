# 1 · Installation & Start

Dieses Kapitel beschrieb die PHP-Version und ist überholt. Es nannte drei
Container statt fünf, rief `php app/bot.php -t seed` auf und verwies auf
Port 8080.

Für die aktuelle Version gilt **[`src/docs/deployment.md`](../src/docs/deployment.md)**.
Dort stehen Installation, Initialisierung, Start, Bau, Tests, alle
Umgebungsvariablen und die fünf Container (`web`, `worker`, `efi-conv`, `db`,
`adminer`).

Kurzfassung für Ungeduldige:

```bash
git clone https://github.com/AV-EFI/avefi-importer.git
cd avefi-importer/src
cp .env.example .env          # mindestens DB_PASS und SESSION_SECRET setzen
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec web npm run migrate
docker compose -f docker-compose.dev.yml exec web npm run seed
```

`seed` legt Institution und Verwaltungskonto an und gibt das Passwort einmalig
aus. Mit `SEED_PASSWORD` lässt es sich vorgeben.

Die Compose-Datei liegt im Repository und enthält keine Zugangsdaten: Was
geheim ist oder nur auf einem bestimmten Server gilt — Passwörter, Domain,
Reverse Proxy —, kommt aus `.env`, und die bleibt draussen. `src/.env.example`
zeigt, welche Variablen es gibt. Ohne `DB_PASS` und `SESSION_SECRET` startet
Compose gar nicht erst, sondern sagt, welche Variable fehlt.

Eine eigene Auslieferung, die mehr ändert als diese Variablen, gehört in eine
Kopie namens `docker-compose.local.yml`; die bleibt ebenfalls draussen.

## Vor dem ersten Produktivstart

Für einen Testaufbau reicht das oben. Für eine Installation, die von aussen
erreichbar ist, sind vorher drei Werte zu ändern: das Sitzungsgeheimnis, das
Datenbankpasswort und das Passwort des ersten Kontos. Die Liste mit Fundstellen
und Prüfbefehl steht in [`../deployment.md`](../deployment.md), Abschnitt „Vor
dem ersten Produktivstart".

Die Anwendung prüft das beim Start selbst. Steht noch ein Vorgabewert in
Gebrauch, meldet sie es im Protokoll, und angemeldete Administratoren sehen
einen Hinweisstreifen über der Kopfzeile. Ist `NODE_ENV=production` gesetzt und
das Sitzungsgeheimnis noch der Vorgabewert, startet sie nicht.

Die Kapitel 2 bis 5 und 7 beschreiben die Bedienung, und die hat sich mit der
Neufassung nicht geändert.
