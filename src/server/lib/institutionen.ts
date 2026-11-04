/*
 * Institutionen anlegen, umbenennen und leere loeschen (#43, 04.11.2026).
 *
 * Bis dahin entstanden Institutionen nur ueber `npm run seed` oder SQL. Die
 * Verwaltung kann bewusst nicht mehr als anlegen, umbenennen und loeschen —
 * und loeschen nur, solange nichts an der Institution haengt: Importe und
 * Zuordnungsprofile sind mit ON DELETE CASCADE angebunden, eine geloeschte
 * Institution naehme sie still mit. Archivieren gibt es nicht; wer nicht mehr
 * mitarbeitet, dessen Konten werden gesperrt.
 *
 * Die Logik liegt hier und nicht in server/api, damit sie ohne h3 testbar ist.
 * Fehler kommen als {@link InstitutionFehler}; die Schnittstelle uebersetzt sie.
 */
import type { Sql } from 'postgres'
import type { InstitutionMitBelegung } from '#shared/types/domain'

/** Ein fachlicher Fehler mit HTTP-Status, Meldungscode und Parametern. */
export class InstitutionFehler extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params: Record<string, unknown> = {},
    meldung = code
  ) {
    super(meldung)
    this.name = 'InstitutionFehler'
  }
}

export const MAX_NAME_LAENGE = 200

/**
 * Jede Tabelle, die auf eine Institution verweist.
 *
 * Danach entscheidet sich, ob eine Institution leer ist. Der Waechter
 * tests/betrieb/institutionen.test.ts liest alle `REFERENCES institutions` aus
 * db/schema.sql und verlangt, dass jede hier steht: Eine kuenftige Tabelle
 * darf nicht an der Leer-Pruefung vorbei per Kaskade mitgeloescht werden.
 */
export const INSTITUTION_VERWEISE = [
  { tabelle: 'users', schluessel: 'konten' },
  { tabelle: 'imports', schluessel: 'importe' },
  { tabelle: 'mapping_profiles', schluessel: 'profile' }
] as const

export type Belegung = Record<(typeof INSTITUTION_VERWEISE)[number]['schluessel'], number>

export type { InstitutionMitBelegung }

const UMSCHRIFT: Readonly<Record<string, string>> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', ø: 'oe', œ: 'oe', å: 'aa'
}

/**
 * Kurzname einer Institution: klein, nur a-z, 0-9 und Bindestrich.
 *
 * Umlaute werden umgeschrieben, andere Akzente entfernt. Der Seed warf sie bis
 * zum 04.11.2026 weg, aus „Filmmuseum Düsseldorf“ wurde
 * `filmmuseum-d-sseldorf`. Bestehende Kurznamen bleiben, wie sie sind.
 */
export function kurzname(name: string): string {
  const umgeschrieben = name
    .toLowerCase()
    .replace(/[äöüßæøœå]/g, (z) => UMSCHRIFT[z] ?? z)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  const kurz = umgeschrieben.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return kurz === '' ? 'institution' : kurz.slice(0, 80).replace(/-+$/, '')
}

/** Name pruefen: nicht leer, Leerraum zusammengezogen, nicht zu lang. */
export function pruefeName(wert: unknown): string {
  const name = typeof wert === 'string' ? wert.replace(/\s+/g, ' ').trim() : ''
  if (name === '') throw new InstitutionFehler(400, 'institution_name_missing', {}, 'Kein Name angegeben.')
  if (name.length > MAX_NAME_LAENGE) {
    throw new InstitutionFehler(400, 'institution_name_long', { max: MAX_NAME_LAENGE }, 'Name zu lang.')
  }
  return name
}

function leereBelegung(): Belegung {
  return { konten: 0, importe: 0, profile: 0 }
}

/** Alle Institutionen mit der Zahl der Konten, Importe und Profile, nach Name. */
export async function listeMitBelegung(sql: Sql): Promise<InstitutionMitBelegung[]> {
  const zeilen = await sql<Array<{ id: number; name: string; slug: string; created_at: string }>>`
    SELECT id, name, slug, created_at FROM institutions ORDER BY lower(name), id`
  const belegung = new Map<number, Belegung>(zeilen.map((z) => [z.id, leereBelegung()]))
  for (const { tabelle, schluessel } of INSTITUTION_VERWEISE) {
    const zaehlung = await sql<Array<{ institution_id: number; n: number }>>`
      SELECT institution_id, count(*)::int AS n FROM ${sql(tabelle)}
       WHERE institution_id IS NOT NULL GROUP BY institution_id`
    for (const { institution_id, n } of zaehlung) {
      const b = belegung.get(institution_id)
      if (b !== undefined) b[schluessel] = n
    }
  }
  return zeilen.map((z) => {
    const b = belegung.get(z.id) ?? leereBelegung()
    return { ...z, belegung: b, leer: Object.values(b).every((n) => n === 0) }
  })
}

async function belegungVon(sql: Sql, id: number): Promise<Belegung> {
  const b = leereBelegung()
  for (const { tabelle, schluessel } of INSTITUTION_VERWEISE) {
    const [z] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM ${sql(tabelle)} WHERE institution_id = ${id}`
    b[schluessel] = z?.n ?? 0
  }
  return b
}

async function pruefeNameFrei(sql: Sql, name: string, ausser: number | null): Promise<void> {
  const treffer = ausser === null
    ? await sql<Array<{ id: number }>>`SELECT id FROM institutions WHERE lower(name) = lower(${name})`
    : await sql<Array<{ id: number }>>`
        SELECT id FROM institutions WHERE lower(name) = lower(${name}) AND id <> ${ausser}`
  if (treffer.length > 0) {
    throw new InstitutionFehler(409, 'institution_name_taken', { name }, 'Name bereits vergeben.')
  }
}

/** Freier Kurzname: der aus dem Namen, sonst mit angehaengter Zahl. */
async function freierKurzname(sql: Sql, name: string): Promise<string> {
  const basis = kurzname(name)
  const belegt = new Set(
    (await sql<Array<{ slug: string }>>`
      SELECT slug FROM institutions WHERE slug = ${basis} OR slug LIKE ${`${basis}-%`}`).map((z) => z.slug)
  )
  if (!belegt.has(basis)) return basis
  for (let i = 2; ; i++) {
    const versuch = `${basis}-${i}`
    if (!belegt.has(versuch)) return versuch
  }
}

/*
 * Anlegen und Umbenennen nehmen dieselbe Transaktionssperre: Der Name hat in
 * der Tabelle keinen UNIQUE-Index, und zwei gleichzeitige Anfragen mit
 * demselben Namen kaemen sonst beide durch die Pruefung.
 */
const NAMENSSPERRE = 'institutions:name'

/** Neue Institution. Gleicher Name, gross oder klein geschrieben, ist vergeben. */
export async function institutionAnlegen(sql: Sql, rohName: unknown): Promise<number> {
  const name = pruefeName(rohName)
  return await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await t`SELECT pg_advisory_xact_lock(hashtext(${NAMENSSPERRE}))`
    await pruefeNameFrei(t, name, null)
    const slug = await freierKurzname(t, name)
    const [neu] = await t<Array<{ id: number }>>`
      INSERT INTO institutions (name, slug) VALUES (${name}, ${slug}) RETURNING id`
    if (neu === undefined) throw new InstitutionFehler(500, 'institution_create_failed')
    return neu.id
  }) as number
}

/** Umbenennen. Der Kurzname bleibt, damit Verweise und der Seed ihn wiederfinden. */
export async function institutionUmbenennen(sql: Sql, id: number, rohName: unknown): Promise<void> {
  const name = pruefeName(rohName)
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await t`SELECT pg_advisory_xact_lock(hashtext(${NAMENSSPERRE}))`
    const [vorhanden] = await t<Array<{ id: number }>>`SELECT id FROM institutions WHERE id = ${id} FOR UPDATE`
    if (vorhanden === undefined) {
      throw new InstitutionFehler(404, 'institution_not_found', {}, 'Institution nicht gefunden.')
    }
    await pruefeNameFrei(t, name, id)
    await t`UPDATE institutions SET name = ${name} WHERE id = ${id}`
  })
}

/**
 * Loeschen, aber nur eine leere Institution.
 *
 * Die Zeile wird zuerst gesperrt (FOR UPDATE). Ein gleichzeitig angelegtes
 * Konto oder ein Import, der auf sie verweist, braucht fuer den Fremdschluessel
 * eine Sperre auf genau diese Zeile, wartet also, bis hier entschieden ist, und
 * scheitert danach am fehlenden Ziel. Zwischen Zaehlen und Loeschen kann so
 * nichts dazukommen, das die Kaskade mitnaehme.
 */
export async function institutionLoeschen(sql: Sql, id: number): Promise<{ name: string }> {
  return await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const [vorhanden] = await t<Array<{ name: string }>>`SELECT name FROM institutions WHERE id = ${id} FOR UPDATE`
    if (vorhanden === undefined) {
      throw new InstitutionFehler(404, 'institution_not_found', {}, 'Institution nicht gefunden.')
    }
    const belegung = await belegungVon(t, id)
    if (Object.values(belegung).some((n) => n > 0)) {
      throw new InstitutionFehler(409, 'institution_not_empty', { ...belegung, name: vorhanden.name },
        'Institution ist nicht leer.')
    }
    await t`DELETE FROM institutions WHERE id = ${id}`
    return { name: vorhanden.name }
  }) as { name: string }
}
