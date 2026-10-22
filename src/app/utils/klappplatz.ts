/*
 * Wohin ein Klappmenue passt: unter oder ueber seinem Ausloeser, und wie hoch es
 * dort sein darf.
 *
 * Luca Wollny am 21.10.2026 in #30: Die Konverterauswahl oeffnete sich weit unten
 * auf der Seite nach unten und war nicht vollstaendig erreichbar. Erwartet:
 * „oeffnet sich bei zu wenig Platz nach oben oder wird in der Hoehe begrenzt und
 * ist intern scrollbar". Beides steht hier — einmal, fuer alle drei Klappmenues
 * (Konverterauswahl, Zielauswahl, Zeilenmenue der Importliste).
 *
 * Reine Rechnung ohne DOM, damit sie sich ohne Browser pruefen laesst.
 */

export interface KlappLage {
  /** Nach oben aufklappen statt nach unten. */
  oben: boolean
  /** Hoechstens so hoch darf das Menue auf dieser Seite sein (px). */
  maxHoehe: number
}

export interface KlappOptionen {
  /** Abstand zwischen Ausloeser und Menue. */
  abstand?: number
  /** Abstand zum Fensterrand. */
  rand?: number
  /** Kleiner wird ein Menue nie, auch wenn der Platz fehlt — dann rollt die Seite. */
  mindest?: number
}

/**
 * @param anker  Lage des Ausloesers im Fenster (getBoundingClientRect)
 * @param hoehe  Hoehe, die das Menue ungekuerzt braucht (scrollHeight)
 * @param fenster  Fensterhoehe (innerHeight)
 *
 * Regel: Passt es unten, bleibt es unten — so oeffnen Menues gewohnt. Sonst
 * oeffnet es auf der Seite mit mehr Platz und wird dort auf diesen Platz
 * begrenzt. Nach oben nur dann, wenn oben tatsaechlich mehr Platz ist; ein
 * Menue, das nach oben klappt und dort noch weniger Raum hat, waere schlechter.
 */
export function klappPlatz(
  anker: { top: number; bottom: number },
  hoehe: number,
  fenster: number,
  optionen: KlappOptionen = {}
): KlappLage {
  const abstand = optionen.abstand ?? 6
  const rand = optionen.rand ?? 8
  const mindest = optionen.mindest ?? 160
  const unten = Math.max(0, fenster - anker.bottom - abstand - rand)
  const oben = Math.max(0, anker.top - abstand - rand)
  if (hoehe <= unten) return { oben: false, maxHoehe: Math.max(mindest, Math.floor(unten)) }
  if (oben > unten) return { oben: true, maxHoehe: Math.max(mindest, Math.floor(oben)) }
  return { oben: false, maxHoehe: Math.max(mindest, Math.floor(unten)) }
}
