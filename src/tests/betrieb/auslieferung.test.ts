/*
 * Waechter fuer Abbilder, Compose-Datei und Anleitung.
 *
 * Anlass am 27.10.2026 (Sven Bingert, GWDG): In einem frischen Klon schlugen
 * der dokumentierte Testbefehl und der Compose-Aufbau fehl. Auf dem Testserver
 * fiel beides nie auf, weil dort ein altes node_modules im Arbeitsverzeichnis
 * lag und den fehlenden Schritt verdeckte. Kein Test hat das gemerkt, weil
 * keiner einen frischen Klon kennt.
 *
 * Dieser Test prueft nicht, ob die Abbilder bauen — das macht die CI und der
 * Durchgang von Hand in docs/deployment.md. Er haelt die Stellen fest, deren
 * Verlust still ist: Nichts schlaegt fehl, solange irgendwo noch ein altes
 * node_modules liegt.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wurzel = fileURLToPath(new URL('../..', import.meta.url))
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

/** Inhalt einer Dockerfile-Stufe bis zur naechsten FROM-Zeile. */
function stufe(dockerfile: string, name: string): string {
  const zeilen = dockerfile.split('\n')
  const start = zeilen.findIndex((z) => new RegExp(`^FROM .* AS ${name}\\s*$`, 'i').test(z))
  expect(start, `Stufe ${name}`).toBeGreaterThanOrEqual(0)
  const ende = zeilen.findIndex((z, i) => i > start && /^FROM /i.test(z))
  return zeilen.slice(start, ende === -1 ? undefined : ende).join('\n')
}

/** Eintraege unter `volumes:` je Dienst, grob gelesen. */
function volumesJeDienst(compose: string): Map<string, string[]> {
  const dienste = new Map<string, string[]>()
  let dienst: string | null = null
  let inVolumes = false
  for (const zeile of compose.split('\n')) {
    const kopf = /^ {2}([a-z][\w-]*):\s*$/.exec(zeile)
    if (kopf) { dienst = kopf[1]!; inVolumes = false; dienste.set(dienst, []); continue }
    if (/^\S/.test(zeile)) { dienst = null; inVolumes = false; continue }
    if (dienst === null) continue
    if (/^ {4}volumes:\s*$/.test(zeile)) { inVolumes = true; continue }
    if (/^ {4}\S/.test(zeile)) { inVolumes = false; continue }
    const eintrag = /^ {6}- (\S+)/.exec(zeile)
    if (inVolumes && eintrag) dienste.get(dienst)!.push(eintrag[1]!)
  }
  return dienste
}

describe('.dockerignore', () => {
  const eintraege = lies('.dockerignore').split('\n').map((z) => z.trim())

  it('haelt Zugangsdaten und Host-Abhaengigkeiten aus dem Abbild', () => {
    for (const muss of ['.env', 'node_modules', '.nuxt', '.output', 'docker-compose.local.yml']) {
      expect(eintraege, muss).toContain(muss)
    }
  })

  it('laesst die Beispielkonfiguration durch', () => {
    expect(eintraege).toContain('!.env.example')
  })
})

describe('Dockerfile', () => {
  const dockerfile = lies('Dockerfile')

  it('bereitet in base die Nuxt-Typen vor', () => {
    // Ohne `nuxt prepare` fehlt .nuxt/tsconfig.json: alle Testdateien
    // scheitern an der tsconfig, und der Worker findet `#shared/*` nicht.
    expect(stufe(dockerfile, 'base')).toMatch(/RUN npx nuxt prepare/)
  })

  it('hat eine Stufe worker, die von selbst den Worker startet', () => {
    const worker = stufe(dockerfile, 'worker')
    expect(worker).toMatch(/npm ci --omit=dev/)
    expect(worker).toMatch(/ENV WORKER_MAX_UPTIME=0/)
    expect(worker).toMatch(/CMD \["npm", "run", "worker"\]/)
    for (const pfad of ['/app/server', '/app/shared', '/app/db', '/app/.nuxt/tsconfig.json']) {
      expect(worker, pfad).toContain(pfad)
    }
  })

  it('laesst die Weboberflaeche bei node .output/server/index.mjs', () => {
    expect(stufe(dockerfile, 'production')).toMatch(/CMD \["node", "\.output\/server\/index\.mjs"\]/)
  })

  it('bricht den Bau ab, wenn tini fehlt', () => {
    for (const name of ['base', 'production', 'worker']) {
      expect(stufe(dockerfile, name), name).toMatch(/test -x \/sbin\/tini/)
    }
  })
})

describe('docker-compose.dev.yml', () => {
  const dienste = volumesJeDienst(lies('docker-compose.dev.yml'))

  it('verdeckt node_modules und .nuxt aus dem Abbild nicht', () => {
    const mitCode = [...dienste].filter(([, v]) => v.some((e) => e.startsWith('./:/app')))
    expect(mitCode.map(([d]) => d).sort()).toEqual(['web', 'worker'])
    for (const [dienst, volumes] of mitCode) {
      expect(volumes, dienst).toContain('/app/node_modules')
      expect(volumes, dienst).toContain('/app/.nuxt')
    }
  })
})

describe('Anleitung', () => {
  // Die README liegt ausserhalb von src/ und damit nicht im Abbild `base`.
  // Im Checkout und in der CI ist sie da und wird mitgeprueft.
  const dateien = ['../README.md', 'docs/deployment.md', 'docs/handbuch/01-installation.md']
    .filter((d) => d.startsWith('docs/') || existsSync(join(wurzel, d)))

  it('fuehrt keine Tests in einem eingehaengten Klon ohne Installation aus', () => {
    // Der Befehl vom 27.10.: `npx` holte sich ein fremdes vitest, und
    // `vitest/config` liess sich nicht aufloesen.
    for (const datei of dateien) {
      expect(lies(datei), datei).not.toMatch(/-v "\$PWD":\/app[^\n]*npx vitest/)
    }
  })

  it('verlangt die NUXT_-Schreibweise nicht mehr', () => {
    for (const datei of [...dateien, '.env.example']) {
      expect(lies(datei), datei).not.toMatch(/muessen mit dem Praefix\s+`?NUXT_/)
    }
  })
})
