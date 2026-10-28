/**
 * Worker-Daemon: arbeitet die Postgres-Queue ab (worker_jobs).
 *
 * Zwei Lehren aus dem PHP-Stand sind hier eingebaut:
 *  - Der Prozess beendet sich nach WORKER_MAX_UPTIME von selbst. Ein
 *    Dauerprozess haelt geladenen Code im Speicher; ohne Selbstbeendigung
 *    verarbeitet er tagelang alten Code, waehrend die Oberflaeche neuen zeigt.
 *  - Unbekannte Parameter sind ein Fehler, kein stiller Nichteffekt. Ein Flag,
 *    das aussieht wie „einmal durchlaufen" und wirkungslos ist, hat hier schon
 *    einmal sechs Tage lang einen Geisterprozess erzeugt.
 */
import { standaloneDb } from '../db/config'
import { schemaAnwenden, schemaAutomatisch, schemaVonPlatte } from '../db/schema'
import { claim, complete, fail } from './queue'
import { beschreibung, hoechstlaufzeit } from './laufzeit'
import { setStatus } from '../lib/imports'
import * as download from './jobs/download'
import * as detect from './jobs/detect'
import * as convert from './jobs/convert'
import type { JobClass, WorkerJobRow } from '#shared/types/domain'
import type { Sql } from 'postgres'

const KNOWN_FLAGS = new Set(['--once', '--verbose'])

const args = process.argv.slice(2)
const unknown = args.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a))
if (unknown.length) {
  console.error(`Unbekannte Parameter: ${unknown.join(', ')}`)
  process.exit(64)
}
const runOnce = args.includes('--once')
const verbose = args.includes('--verbose')
const uptime = hoechstlaufzeit(process.env.WORKER_MAX_UPTIME)
if (uptime.warnung !== null) console.warn(`[worker] ${uptime.warnung}`)
const maxUptime = uptime.ms
const startedAt = Date.now()

/** classname -> ausfuehrende Funktion. Andere Werte sind ein Fehler, kein Nichtstun. */
const HANDLERS: Record<JobClass, (sql: Sql, payload: Record<string, unknown>) => Promise<void>> = {
  'worker/download': download.run,
  'worker/detect': detect.run,
  'worker/convert': convert.run
}

console.log(`[worker] Start, Node ${process.version}, max uptime ${beschreibung(uptime)}, once=${runOnce}`)

const sql = standaloneDb()

// Schema vor dem ersten Auftrag. Der Hintergrundprozess ist die Stelle, an der
// ein veraltetes Schema zuschlaegt: Am 01.09.2026 brach eine Konvertierung mit
// `column "run_config" of relation "imports" does not exist` ab, weil nach dem
// Ausrollen niemand `npm run migrate` aufgerufen hatte. Die Vorkehrungssperre
// in schemaAnwenden sorgt dafuer, dass Weboberflaeche und Worker sich beim
// gleichzeitigen Start nicht in die Quere kommen.
if (schemaAutomatisch()) {
  try {
    const anzahl = await schemaAnwenden(sql, await schemaVonPlatte())
    console.log(`[worker] Schema angewandt, ${anzahl} Tabellen.`)
  } catch (e) {
    console.error('[worker] Schema fehlgeschlagen, Start abgebrochen:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
}

/** Fuehrt einen Auftrag aus und pflegt seinen Zustand. */
async function process_(job: WorkerJobRow): Promise<void> {
  const handler = HANDLERS[job.classname]
  const payload = (job.payload ?? {}) as Record<string, unknown>
  try {
    if (typeof handler !== 'function') throw new Error(`Unbekannter Auftragstyp: ${job.classname}`)
    if (verbose) console.log(`[worker] #${job.id} ${job.classname} beginnt`)
    await handler(sql, payload)
    await complete(sql, job.id)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await fail(sql, job.id, message)
    const importId = job.import_id ?? (typeof payload.import_id === 'string' ? payload.import_id : null)
    if (importId !== null) {
      // Der Import darf nicht in "converting" haengen bleiben; die Oberflaeche
      // wuerde sonst dauerhaft einen Fortschritt anzeigen, den es nicht gibt.
      await setStatus(sql, importId, 'error').catch(() => undefined)
    }
    console.error(`[worker] Auftrag #${job.id} (${job.classname}) fehlgeschlagen: ${message}`)
  }
}

/** Arbeitet alle gerade faelligen Auftraege ab. */
async function tick(): Promise<number> {
  let handled = 0
  for (;;) {
    const job = await claim(sql)
    if (job === null) break
    await process_(job)
    handled++
    if (Date.now() - startedAt > maxUptime) break
  }
  return handled
}

async function loop() {
  for (;;) {
    let handled = 0
    try {
      handled = await tick()
    } catch (e) {
      console.error('[worker] Fehler im Durchlauf:', e)
    }
    if (runOnce) {
      console.log('[worker] --once: beende nach einem Durchlauf.')
      return
    }
    if (Date.now() - startedAt > maxUptime) {
      console.log('[worker] Hoechstlaufzeit erreicht, beende. Der Neustart bringt aktuellen Code.')
      return
    }
    if (handled === 0) await new Promise((r) => setTimeout(r, 2000))
  }
}

loop()
  .then(async () => {
    await sql.end({ timeout: 5 })
    process.exit(0)
  })
  .catch(async (e) => {
    console.error('[worker] Abbruch:', e)
    await sql.end({ timeout: 5 }).catch(() => undefined)
    process.exit(1)
  })
