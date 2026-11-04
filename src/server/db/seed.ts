/**
 * Erstausstattung: eine Institution und ein Verwaltungskonto.
 *
 * Ohne diesen Schritt hat ein frisch aufgesetztes System kein Konto, mit dem
 * man sich anmelden koennte. Aufruf: npm run seed
 * Das Passwort kommt aus SEED_PASSWORD; fehlt es, wird eines erzeugt und
 * einmalig ausgegeben. Ein vorhandenes Konto wird nicht ueberschrieben, es sei
 * denn SEED_FORCE=1 ist gesetzt.
 */
import { randomBytes } from 'node:crypto'
import { hash as argonHash } from '@node-rs/argon2'
import { standaloneDb } from './config.js'
import { institutionAnlegen, kurzname } from '../lib/institutionen.js'

const email = process.env.SEED_EMAIL || 'admin@av-efi.net'
const institution = process.env.SEED_INSTITUTION || 'AVefi Testinstitution'
const force = process.env.SEED_FORCE === '1'
const password = process.env.SEED_PASSWORD || randomBytes(9).toString('base64url')
const generated = !process.env.SEED_PASSWORD

const sql = standaloneDb()

try {
  // Bestehende Institution finden, nicht umbenennen (#43): Wer sie in der
  // Oberflaeche umbenannt hat, behaelt den Namen, auch wenn der Seed spaeter
  // noch einmal laeuft. Gesucht wird ueber den Namen und ueber den Kurznamen in
  // neuer und in alter Schreibweise; die alte warf Umlaute weg.
  const alterKurzname = institution.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'institution'
  const [gefunden] = await sql<{ id: number }[]>`
    SELECT id FROM institutions
     WHERE lower(name) = lower(${institution}) OR slug IN (${kurzname(institution)}, ${alterKurzname})
     ORDER BY id LIMIT 1`
  const inst = gefunden ?? { id: await institutionAnlegen(sql, institution) }

  const existing = await sql<{ id: number }[]>`SELECT id FROM users WHERE lower(email) = lower(${email})`
  const hash = await argonHash(password, { memoryCost: 65536, timeCost: 4, parallelism: 1 })

  if (existing[0] && !force) {
    console.log(`[seed] Konto ${email} besteht bereits (#${existing[0].id}). Unveraendert.`)
    console.log('[seed] Zum Ueberschreiben SEED_FORCE=1 setzen.')
  } else if (existing[0]) {
    await sql`UPDATE users SET password_hash = ${hash}, active = true, institution_id = ${inst.id} WHERE id = ${existing[0].id}`
    console.log(`[seed] Konto ${email} (#${existing[0].id}) zurueckgesetzt.`)
    if (generated) console.log(`[seed] Passwort: ${password}`)
  } else {
    const [u] = await sql<{ id: number }[]>`
      INSERT INTO users (institution_id, email, password_hash, name, is_admin, active)
      VALUES (${inst.id}, ${email}, ${hash}, 'Administrator', true, true) RETURNING id`
    console.log(`[seed] Konto angelegt: ${email} (#${u!.id}), Institution „${institution}" (#${inst.id}).`)
    console.log(`[seed] Passwort: ${password}`)
  }
  if (generated) console.log('[seed] Dieses Passwort wird nicht erneut angezeigt.')
} catch (e) {
  console.error('[seed] Fehlgeschlagen:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await sql.end()
}
