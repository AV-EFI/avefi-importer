/** Verbindungsdaten fuer Prozesse ausserhalb von Nitro (Worker, Migration, Seed). */
import postgres from 'postgres'

type Umgebung = Record<string, string | undefined>

/**
 * Ein Wert aus der Umgebung, zuerst ohne, dann mit Praefix `NUXT_`.
 *
 * Die Oberflaeche nimmt beide Schreibweisen an (`DB_PASS` direkt, `NUXT_DB_PASS`
 * ueber die runtimeConfig). Bis zum 28.10.2026 las der Worker nur `DB_*`. Wer
 * der damaligen Anleitung folgte und nur `NUXT_DB_*` setzte, bekam eine
 * Oberflaeche mit der richtigen Datenbank und einen Worker, der still auf die
 * Vorgaben `avefi`/`avefi` zurueckfiel.
 */
export function umgebungswert(env: Umgebung, name: string): string | undefined {
  return env[name] || env[`NUXT_${name}`] || undefined
}

/** Verbindungsdaten aus der Umgebung, mit den Vorgaben des Entwicklungsaufbaus. */
export function verbindungsdaten(env: Umgebung = process.env) {
  return {
    host: umgebungswert(env, 'DB_HOST') || 'db',
    port: Number(umgebungswert(env, 'DB_PORT') || 5432),
    database: umgebungswert(env, 'DB_NAME') || 'avefi',
    username: umgebungswert(env, 'DB_USER') || 'avefi',
    password: umgebungswert(env, 'DB_PASS') || 'avefi'
  }
}

export function standaloneDb(): postgres.Sql {
  return postgres({
    ...verbindungsdaten(),
    max: 4,
    idle_timeout: 30,
    // Das Schema ist durchgaengig mit IF NOT EXISTS geschrieben. PostgreSQL
    // quittiert jedes uebersprungene Objekt mit einem NOTICE — beim Start
    // sind das ueber achtzig Zeilen, die nichts melden und alles verdecken,
    // was danach kommt.
    onnotice: () => {}
  })
}
