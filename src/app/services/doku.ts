/*
 * Die Dokumentationsendpunkte.
 *
 * Ein Service je Fachbereich. Er traegt zweierlei: die Adressen und die Form
 * der Antworten. Beides stand bis zum 07.09.2026 in den Seiten selbst — die
 * Uebersicht des Handbuchs und die der Oberflaechenbeschreibungen
 * deklarierten sogar dasselbe Interface zweimal, Wort fuer Woert gleich.
 *
 * Geladen wird nicht hier, sondern in composables/useDoku.ts (#9). Bis zum
 * 23.09.2026 stand an dieser Stelle die Begruendung, warum `useFetch` in der
 * Seite bleiben muesse: In einen Helfer verpackt, teilten sich zwei Seiten
 * einen Zwischenspeicher. Das stimmte fuer Nuxt 4 nicht — der Schluessel wird
 * dort aus Aufrufstelle, Adresse und Abfrage gebildet, verschiedene Adressen
 * bekommen verschiedene Eintraege. Die Composables geben ihren Schluessel
 * trotzdem ausdruecklich an, damit er nicht von dieser Einzelheit abhaengt.
 */

export interface DokuKapitelRef {
  kennung: string
  titel: string
}

export interface DokuUebersicht {
  titel: string
  html: string
  kapitel: DokuKapitelRef[]
}

export interface DokuKapitel {
  kennung: string
  titel: string
  html: string
  vorher: DokuKapitelRef | null
  nachher: DokuKapitelRef | null
  /** Nur bei Oberflaechenbeschreibungen: ob ein Abzug vorliegt. */
  bild?: boolean
}

export function dokuPfade(): {
  handbuch: () => string
  handbuchKapitel: (kennung: string) => string
  oberflaeche: () => string
  oberflaecheSeite: (kennung: string) => string
  oberflaecheBild: (kennung: string) => string
} {
  const api = useApi()
  return {
    handbuch: () => api('/doku/handbuch'),
    handbuchKapitel: (kennung) => api(`/doku/handbuch/${kennung}`),
    oberflaeche: () => api('/doku/oberflaeche'),
    oberflaecheSeite: (kennung) => api(`/doku/oberflaeche/${kennung}`),
    oberflaecheBild: (kennung) => api(`/doku/oberflaeche/bild/${kennung}`)
  }
}
