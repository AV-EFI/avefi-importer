/*
 * Datenbankverbindung fuer Worker, Seed und Migration.
 *
 * Die Oberflaeche nimmt `DB_*` und `NUXT_DB_*` an. Bis zum 28.10.2026 las der
 * Worker nur `DB_*`: Wer der damaligen Anleitung folgte und nur die
 * `NUXT_`-Form setzte, bekam einen Worker auf `avefi`/`avefi`.
 */
import { describe, expect, it } from 'vitest'
import { umgebungswert, verbindungsdaten } from '../../server/db/config'

describe('verbindungsdaten', () => {
  it('liest die Namen ohne Praefix', () => {
    const v = verbindungsdaten({ DB_HOST: 'h', DB_PORT: '6543', DB_NAME: 'n', DB_USER: 'u', DB_PASS: 'p' })
    expect(v).toEqual({ host: 'h', port: 6543, database: 'n', username: 'u', password: 'p' })
  })

  it('nimmt hilfsweise die NUXT_-Form', () => {
    const v = verbindungsdaten({
      NUXT_DB_HOST: 'h', NUXT_DB_PORT: '6543', NUXT_DB_NAME: 'n', NUXT_DB_USER: 'u', NUXT_DB_PASS: 'p'
    })
    expect(v).toEqual({ host: 'h', port: 6543, database: 'n', username: 'u', password: 'p' })
  })

  it('zieht den Namen ohne Praefix vor, wenn beide gesetzt sind', () => {
    expect(umgebungswert({ DB_PASS: 'ohne', NUXT_DB_PASS: 'mit' }, 'DB_PASS')).toBe('ohne')
  })

  it('behandelt einen leeren Wert wie einen fehlenden', () => {
    expect(umgebungswert({ DB_PASS: '', NUXT_DB_PASS: 'mit' }, 'DB_PASS')).toBe('mit')
  })

  it('faellt ohne Angaben auf die Vorgaben des Entwicklungsaufbaus zurueck', () => {
    expect(verbindungsdaten({})).toEqual({
      host: 'db', port: 5432, database: 'avefi', username: 'avefi', password: 'avefi'
    })
  })
})
