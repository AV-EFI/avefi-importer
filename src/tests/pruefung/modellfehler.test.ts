/*
 * Seit dem 30.09.2026 laedt der Pruefdienst jeden Satz wie efi-conv als Modell
 * und meldet Ladefehler als `model_invalid`. Ein Werk ohne Werkart oder
 * Haupttitel meldet die eigene Pflichtfeldpruefung schon — genauer und mit
 * Loesungshinweis. Dieselbe Sache zweimal zu melden verlaengert nur die Liste.
 */
import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '#shared/types/domain'
import { doppeltePflichtmeldung } from '../../server/worker/validate'

const ladefehler = (field: string, kind = 'missing', record = 4): ValidationIssue => ({
  severity: 'error',
  code: 'model_invalid',
  message: 'x',
  record,
  params: { kind, field }
})

describe('doppeltePflichtmeldung', () => {
  const gemeldet = new Set([4])

  it('laesst die Werkart und den Haupttitel weg, wenn die eigene Meldung da ist', () => {
    expect(doppeltePflichtmeldung(ladefehler('type'), gemeldet)).toBe(true)
    expect(doppeltePflichtmeldung(ladefehler('has_primary_title'), gemeldet)).toBe(true)
  })

  it('behaelt alles andere', () => {
    expect(doppeltePflichtmeldung(ladefehler('type', 'enum'), gemeldet)).toBe(false)
    expect(doppeltePflichtmeldung(ladefehler('has_note', 'extra_forbidden'), gemeldet)).toBe(false)
    expect(doppeltePflichtmeldung(ladefehler('type', 'missing', 5), gemeldet)).toBe(false)
    expect(doppeltePflichtmeldung({ ...ladefehler('type'), code: 'schema' }, gemeldet)).toBe(false)
  })
})
