/*
 * Zellwerte einer Arbeitsmappe als Text lesen — formatiert, nicht roh.
 *
 * Excel legt ein Datum als Zahl ab. Ungeformatiert kaeme aus einem Drehdatum
 * "22371" statt "12.03.1961". In PhpSpreadsheet hiess der richtige Weg
 * getFormattedValue(); in exceljs, mit dem bis zum 29.10.2026 gelesen wurde,
 * gab es kein Gegenstueck: cell.text lieferte bei Formelzellen "[object Object]"
 * und bei Datumszellen die JS-Darstellung in der ORTSZEIT des Prozesses.
 *
 * Genau daran haengt der bekannte Fehler: Der Leser (xlsx.ts, wie zuvor
 * exceljs) setzt den Zeitpunkt auf UTC
 * (Excel-Serie 0 = 1899-12-30T00:00:00Z). Wer ihn mit getDate()/getFullYear()
 * ausliest, bekommt in einer Zeitzone westlich von UTC den Vortag — aus dem
 * 12.03.1961 wird der 11.03.1961. Nachgemessen mit
 * Erschliessungsdaten_Expofilme_bearbeitet.xlsx, Blatt "Global Dialogue", F2:
 * unter TZ=America/Los_Angeles verschiebt sich das Datum um einen Tag.
 *
 * Deshalb wird hier ausschliesslich mit den UTC-Anteilen gerechnet.
 */

/** Excel-Serie 0 in Millisekunden seit der Unix-Epoche. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
]
const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function pad(n: number, width: number): string {
  return String(Math.floor(Math.abs(n))).padStart(width, '0')
}

/** Der fuer die Anzeige massgebliche Abschnitt eines Zahlenformats (positiv). */
function firstSection(numFmt: string): string {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  let inBracket = false
  for (const c of numFmt) {
    if (c === '"') inQuote = !inQuote
    if (c === '[' && !inQuote) inBracket = true
    if (c === ']' && !inQuote) inBracket = false
    if (c === ';' && !inQuote && !inBracket) {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  parts.push(current)
  return parts[0] ?? numFmt
}

/** Entfernt Gebietsschema- und Farbangaben wie [$-F400] oder [Rot]. */
function stripDecorations(fmt: string): string {
  return fmt.replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '')
}

/** Enthaelt das Format Datums- oder Zeitangaben? */
export function isDateFormat(numFmt: string | undefined | null): boolean {
  if (!numFmt) return false
  const fmt = stripDecorations(firstSection(numFmt)).replace(/"[^"]*"/g, '').replace(/\\./g, '')
  return /[ymdhs]/i.test(fmt)
}

interface FormatToken {
  type: 'literal' | 'code'
  value: string
}

/** Zerlegt ein Datumsformat in Codes und Literale. */
function tokenizeDateFormat(fmt: string): FormatToken[] {
  const out: FormatToken[] = []
  let i = 0
  while (i < fmt.length) {
    const c = fmt[i] as string
    if (c === '"') {
      const end = fmt.indexOf('"', i + 1)
      out.push({ type: 'literal', value: fmt.slice(i + 1, end < 0 ? fmt.length : end) })
      i = end < 0 ? fmt.length : end + 1
      continue
    }
    if (c === '\\') {
      out.push({ type: 'literal', value: fmt[i + 1] ?? '' })
      i += 2
      continue
    }
    if (c === '[') {
      const end = fmt.indexOf(']', i)
      out.push({ type: 'code', value: fmt.slice(i, end < 0 ? fmt.length : end + 1).toLowerCase() })
      i = end < 0 ? fmt.length : end + 1
      continue
    }
    const ampm = /^(AM\/PM|A\/P)/i.exec(fmt.slice(i))
    if (ampm) {
      out.push({ type: 'code', value: 'am/pm' })
      i += ampm[0].length
      continue
    }
    if (/[ymdhs]/i.test(c)) {
      let run = c
      while (i + run.length < fmt.length && (fmt[i + run.length] as string).toLowerCase() === c.toLowerCase()) {
        run += fmt[i + run.length]
      }
      out.push({ type: 'code', value: run.toLowerCase() })
      i += run.length
      continue
    }
    out.push({ type: 'literal', value: c })
    i++
  }
  return out
}

/**
 * Formatiert einen Zeitpunkt nach einem Excel-Zahlenformat.
 * Gerechnet wird durchgaengig in UTC — siehe Kopf dieser Datei.
 */
export function formatExcelDate(date: Date, numFmt: string | undefined | null): string {
  const ms = date.getTime()
  const fmt = stripDecorations(firstSection(numFmt ?? ''))
  const tokens = tokenizeDateFormat(numFmt ? firstSection(numFmt) : '')

  // Ohne brauchbares Format: ISO. Ein Zeitpunkt am Serientag 0 ist eine Uhrzeit.
  if (!isDateFormat(fmt)) {
    const elapsedMs = ms - EXCEL_EPOCH_MS
    if (elapsedMs >= 0 && elapsedMs < 86400000) return isoTime(date)
    return isoDateTime(date)
  }

  const has12h = tokens.some((t) => t.type === 'code' && t.value === 'am/pm')
  const elapsedMs = ms - EXCEL_EPOCH_MS

  let out = ''
  tokens.forEach((tok, index) => {
    if (tok.type === 'literal') {
      out += tok.value
      return
    }
    const code = tok.value
    switch (code) {
      case 'yyyy':
      case 'yyy':
        out += String(date.getUTCFullYear())
        return
      case 'yy':
        out += pad(date.getUTCFullYear() % 100, 2)
        return
      case 'mmmmm':
        out += (MONTHS_LONG[date.getUTCMonth()] ?? '').slice(0, 1)
        return
      case 'mmmm':
        out += MONTHS_LONG[date.getUTCMonth()] ?? ''
        return
      case 'mmm':
        out += MONTHS_SHORT[date.getUTCMonth()] ?? ''
        return
      case 'dddd':
        out += DAYS_LONG[date.getUTCDay()] ?? ''
        return
      case 'ddd':
        out += DAYS_SHORT[date.getUTCDay()] ?? ''
        return
      case 'dd':
        out += pad(date.getUTCDate(), 2)
        return
      case 'd':
        out += String(date.getUTCDate())
        return
      case 'am/pm':
        out += date.getUTCHours() < 12 ? 'AM' : 'PM'
        return
      default:
        break
    }
    if (code === 'mm' || code === 'm') {
      // "m" ist Monat oder Minute. Minute, wenn direkt eine Stunde davor oder
      // eine Sekunde dahinter steht — dieselbe Regel wie in Excel.
      const prev = previousCode(tokens, index)
      const next = nextCode(tokens, index)
      const isMinute = (prev !== null && /^\[?h/.test(prev)) || (next !== null && /^\[?s/.test(next))
      const v = isMinute ? date.getUTCMinutes() : date.getUTCMonth() + 1
      out += code === 'mm' ? pad(v, 2) : String(v)
      return
    }
    if (code === 'hh' || code === 'h') {
      let h = date.getUTCHours()
      if (has12h) h = h % 12 === 0 ? 12 : h % 12
      out += code === 'hh' ? pad(h, 2) : String(h)
      return
    }
    if (code === 'ss' || code === 's') {
      out += code === 'ss' ? pad(date.getUTCSeconds(), 2) : String(date.getUTCSeconds())
      return
    }
    // Verstrichene Zeit: [h] zaehlt ueber 24 Stunden hinaus.
    if (/^\[h+\]$/.test(code)) {
      out += pad(Math.floor(elapsedMs / 3600000), code.length - 2)
      return
    }
    if (/^\[m+\]$/.test(code)) {
      out += pad(Math.floor(elapsedMs / 60000), code.length - 2)
      return
    }
    if (/^\[s+\]$/.test(code)) {
      out += pad(Math.floor(elapsedMs / 1000), code.length - 2)
      return
    }
    out += ''
  })
  return out.trim()
}

function previousCode(tokens: readonly FormatToken[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const t = tokens[i]
    if (t && t.type === 'code') return t.value
  }
  return null
}

function nextCode(tokens: readonly FormatToken[], index: number): string | null {
  for (let i = index + 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t && t.type === 'code') return t.value
  }
  return null
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
}

export function isoTime(d: Date): string {
  return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`
}

export function isoDateTime(d: Date): string {
  const time = isoTime(d)
  return time === '00:00:00' ? isoDate(d) : `${isoDate(d)} ${time}`
}

/** Formatiert eine Zahl nach dem Zahlenformat (die haeufigen Faelle). */
export function formatExcelNumber(value: number, numFmt: string | undefined | null): string {
  const fmt = stripDecorations(firstSection(numFmt ?? '')).trim()
  if (fmt === '' || /^general$/i.test(fmt)) return plainNumber(value)

  if (fmt.includes('%')) {
    const decimals = decimalPlaces(fmt)
    return `${group(value * 100, decimals, fmt.includes('#,##'))} %`
  }
  if (/[0#]/.test(fmt)) {
    const decimals = decimalPlaces(fmt)
    return group(value, decimals, fmt.includes('#,##'))
  }
  return plainNumber(value)
}

function decimalPlaces(fmt: string): number | null {
  const m = /\.([0#]+)/.exec(fmt)
  return m && m[1] ? m[1].length : null
}

/**
 * Zahlen ohne Format so ausgeben, wie sie dastehen — insbesondere ohne
 * Exponentialschreibweise und ohne Gruppierung. Signaturen und Inventarnummern
 * sind oft Zahlen; aus 3200201 darf nie "3.200.201" oder "3.2e6" werden.
 */
function plainNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(10)))
}

function group(value: number, decimals: number | null, thousands: boolean): string {
  const fixed = decimals === null ? plainNumber(value) : value.toFixed(decimals)
  if (!thousands) return fixed.replace('.', ',')
  const [intPart = '', fracPart] = fixed.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return fracPart === undefined ? grouped : `${grouped},${fracPart}`
}

/**
 * Zellwert, wie der Leser in xlsx.ts ihn liefert (dieselbe Form wie frueher
 * exceljs). Bewusst locker typisiert.
 */
export interface RawCell {
  value: unknown
  numFmt?: string | undefined
}

/**
 * Der formatierte Text einer Zelle. Ersetzt PhpSpreadsheets getFormattedValue().
 * Liefert immer eine Zeichenkette, nie "[object Object]".
 */
export function cellText(cell: RawCell): string {
  return valueText(cell.value, cell.numFmt)
}

function valueText(value: unknown, numFmt: string | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return formatExcelNumber(value, numFmt)
  if (value instanceof Date) return formatExcelDate(value, numFmt)

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Fehlerwert einer Zelle oder einer Formel: #REF!, #DIV/0! …
    if (typeof obj.error === 'string') return obj.error
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => String((p as { text?: unknown }).text ?? '')).join('')
    }
    if ('formula' in obj || 'sharedFormula' in obj) {
      if (obj.result === undefined || obj.result === null) return ''
      return valueText(obj.result, numFmt)
    }
    if ('hyperlink' in obj || 'text' in obj) return String(obj.text ?? obj.hyperlink ?? '')
  }
  return String(value)
}
