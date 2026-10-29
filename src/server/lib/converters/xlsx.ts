/*
 * XLSX-Arbeitsmappen lesen, ohne Fremdbibliothek fuer das Format selbst.
 *
 * Bis zum 29.10.2026 las der Importer mit exceljs. exceljs wird nicht mehr
 * gepflegt (letzte Version 4.4.0) und zieht Pakete nach, vor denen npm bei
 * jedem Bau warnt (fstream, rimraf 2, glob 7, inflight, lodash.isequal). Eine
 * gepflegte Alternative, die im Datenstrom liest und das Zahlenformat jeder
 * Zelle herausgibt, gibt es im npm-Register nicht. Das Zahlenformat brauchen
 * wir: Ohne es wird aus einem Datum eine Seriennummer und aus „00123" eine 123.
 *
 * Eine XLSX-Datei ist ein ZIP-Archiv mit XML-Teilen. Gelesen wird nur, was fuer
 * Werte noetig ist:
 *
 *   _rels/.rels                 wo die Mappe liegt
 *   xl/workbook.xml             Blattnamen, Reihenfolge, 1904-Datumssystem
 *   xl/_rels/workbook.xml.rels  welches Blatt in welcher Datei steht
 *   xl/sharedStrings.xml        gemeinsame Zeichenketten
 *   xl/styles.xml               Zahlenformat je Zellstil (cellXfs)
 *   xl/worksheets/sheetN.xml    die Zellen, im Datenstrom
 *
 * Entpackt wird mit yauzl (Zugriff auf einzelne Archiveintraege, also keine
 * Zwischendateien), das XML liest sax im Datenstrom. Beide sind gepflegt und
 * haben keine veralteten Abhaengigkeiten.
 *
 * Herausgegeben wird je Zelle dieselbe Form, die exceljs lieferte und die
 * `excelValue.ts` formatiert: `{ value, numFmt }`, mit `value` als Zeichenkette,
 * Zahl, Wahrheitswert, Date (Datumsformat) oder `{ error }`. Dadurch bleibt die
 * Ausgabe gleich. Geprueft am 29.10.2026 mit einem Vergleichslauf gegen
 * exceljs ueber alle echten Lieferungen auf dem Testserver; wo sie abweicht,
 * hatte exceljs einen Fehler (siehe CHANGELOG, 29.10.2026).
 */
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import yauzl from 'yauzl'
import sax from 'sax'
import { isDateFormat, type RawCell } from './excelValue'

/** Ein Tabellenblatt der Mappe, in der Reihenfolge der Registerkarten. */
export interface XlsxSheet {
  /** `sheetId` aus workbook.xml. */
  id: number
  name: string
  /** Pfad des Blatts im Archiv. */
  part: string
}

/** Eine Zeile als Zellen nach Spalte; Index 0 ist Spalte A. Luecken bleiben leer. */
export type XlsxRow = Array<RawCell | undefined>

export interface XlsxWorkbook {
  readonly sheets: readonly XlsxSheet[]
  /** Zeilen eines Blatts im Datenstrom. Bricht der Aufrufer ab, wird der Strom geschlossen. */
  rows(sheet: XlsxSheet): AsyncGenerator<XlsxRow>
  close(): void
}

/** Fehler beim Lesen, mit einem Satz, der in der Oberflaeche stehen kann. */
export class XlsxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'XlsxError'
  }
}

const REL_WORKSHEET = /\/worksheet$/
const REL_SHARED_STRINGS = /\/sharedStrings$/
const REL_STYLES = /\/styles$/
const REL_OFFICE_DOCUMENT = /\/officeDocument$/

/**
 * Eingebaute Zahlenformate (ECMA-376 Teil 1, 18.8.30), soweit sie nicht vom
 * Gebietsschema abhaengen. Dieselbe Tabelle hatte exceljs; Formate 27–36 und
 * 50–58 sind landesabhaengig und bleiben wie dort ohne Code.
 */
const BUILTIN_FORMATS: Readonly<Record<number, string>> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy "h":mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00 ;(#,##0.00)',
  40: '#,##0.00 ;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@'
}

/** Excel-Seriennummer als Zeitpunkt in UTC, wie exceljs es tat. */
export function excelSerialToDate(serial: number, date1904: boolean): Date {
  return new Date(Math.round((serial - 25569 + (date1904 ? 1462 : 0)) * 86400000))
}

/** Spaltenbuchstaben einer Zellreferenz als Index ab 0: „AD7" → 29. */
export function columnIndex(ref: string): number {
  let col = 0
  for (const ch of ref) {
    const code = ch.toUpperCase().charCodeAt(0)
    if (code < 65 || code > 90) break
    col = col * 26 + (code - 64)
  }
  return col - 1
}

/**
 * `_xHHHH_` in Zeichenketten. So kodiert Excel Steuerzeichen, etwa `_x000D_`
 * fuer einen Wagenruecklauf; `_x005F_` steht fuer einen Unterstrich, der sonst
 * als Beginn einer solchen Folge gelesen wuerde. exceljs liess beides stehen.
 */
export function decodeEscapes(text: string): string {
  if (!text.includes('_x')) return text
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

// --- ZIP --------------------------------------------------------------------

interface Archive {
  zip: yauzl.ZipFile
  /** Eintraege nach Pfad in Kleinbuchstaben. */
  entries: Map<string, yauzl.Entry>
}

function openArchive(path: string): Promise<Archive> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, zip) => {
      if (err || !zip) {
        reject(new XlsxError('Die Datei ist keine lesbare XLSX-Arbeitsmappe (kein gueltiges ZIP-Archiv).', { cause: err }))
        return
      }
      const entries = new Map<string, yauzl.Entry>()
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName.toLowerCase(), entry)
        zip.readEntry()
      })
      zip.once('end', () => resolve({ zip, entries }))
      zip.once('error', (e: unknown) => {
        zip.close()
        reject(new XlsxError('Die Datei ist keine lesbare XLSX-Arbeitsmappe.', { cause: e }))
      })
      zip.readEntry()
    })
  })
}

function openStream(archive: Archive, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    archive.zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(new XlsxError(`Teil ${entry.fileName} laesst sich nicht entpacken.`, { cause: err }))
      else resolve(stream)
    })
  })
}

/**
 * Text eines Archiveintrags, Block fuer Block, so wie ein XML-Parser ihn sehen
 * muss.
 *
 * Zwei Dinge erledigt sax nicht selbst:
 *  - Ein Zeichen in UTF-8 kann ueber zwei Bloecke des Datenstroms reichen.
 *    `chunk.toString()` zerschnitte es; der StringDecoder haelt den Rest zurueck.
 *  - Zeilenenden: Nach dem XML-Standard (2.11) wird `\r\n` und ein einzelnes
 *    `\r` vor dem Parsen zu `\n`. Excel schreibt Zeilenumbrueche in Zellen oft
 *    als `\r\n`; exceljs (ueber saxes) lieferte `\n`. Ein `\r` am Blockende
 *    wartet auf den naechsten Block, sonst wuerde aus `\r|\n` ein doppelter
 *    Umbruch. Ein ausdruecklich kodiertes `&#13;` bleibt ein `\r`.
 */
async function* xmlText(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let text = carry + decoder.write(chunk)
    carry = ''
    if (text.endsWith('\r')) {
      carry = '\r'
      text = text.slice(0, -1)
    }
    if (text !== '') yield text.replace(/\r\n?/g, '\n')
  }
  const rest = carry + decoder.end()
  if (rest !== '') yield rest.replace(/\r\n?/g, '\n')
}

/** sax im Datenstrom ueber einen Archiveintrag. */
async function parse(archive: Archive, entry: yauzl.Entry, handler: (p: sax.SAXParser) => void): Promise<void> {
  const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false, position: false })
  let failure: unknown = null
  parser.onerror = (e) => { failure = e }
  handler(parser)
  const stream = await openStream(archive, entry)
  for await (const text of xmlText(stream)) {
    parser.write(text)
    if (failure) break
  }
  if (!failure) parser.close()
  if (failure) throw new XlsxError(`Teil ${entry.fileName} ist kein gueltiges XML.`, { cause: failure })
}

/** Lokaler Name ohne Namensraumpraefix: „x:sheet" → „sheet". */
function local(name: string): string {
  const i = name.indexOf(':')
  return i < 0 ? name : name.slice(i + 1)
}

/**
 * Ein Attribut nach lokalem Namen. Fast immer steht es ohne Praefix da; nur
 * dann wird gesucht. Das Blatt hat je Zelle zwei bis drei Attribute, und bei
 * hunderttausend Zeilen zaehlt jeder Umweg.
 */
function attr(node: sax.Tag, name: string): string | undefined {
  const direct = node.attributes[name]
  if (direct !== undefined) return direct
  for (const k in node.attributes) {
    if (local(k) === name) return node.attributes[k]
  }
  return undefined
}

// --- Beziehungen, Mappe, Stile, gemeinsame Zeichenketten ----------------------

interface Rel { id: string; type: string; target: string }

/** Liest eine .rels-Datei; Ziele relativ zum Verzeichnis des Teils aufgeloest. */
async function readRels(archive: Archive, partPath: string): Promise<Rel[]> {
  const dir = posix.dirname(partPath)
  const relsPath = posix.join(dir === '.' ? '' : dir, '_rels', `${posix.basename(partPath)}.rels`)
  const entry = archive.entries.get(relsPath.toLowerCase())
  if (!entry) return []
  const rels: Rel[] = []
  await parse(archive, entry, (p) => {
    p.onopentag = (node) => {
      if (local(node.name) !== 'Relationship') return
      const node2 = node as sax.Tag
      if (attr(node2, 'TargetMode') === 'External') return
      const target = attr(node2, 'Target') ?? ''
      const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(dir === '.' ? '' : dir, target))
      rels.push({ id: attr(node2, 'Id') ?? '', type: attr(node2, 'Type') ?? '', target: resolved })
    }
  })
  return rels
}

interface WorkbookInfo { sheets: Array<{ id: number; name: string; rid: string }>; date1904: boolean }

async function readWorkbook(archive: Archive, part: string): Promise<WorkbookInfo> {
  const entry = archive.entries.get(part.toLowerCase())
  if (!entry) throw new XlsxError('Die Arbeitsmappe enthaelt kein Inhaltsverzeichnis (workbook.xml).')
  const info: WorkbookInfo = { sheets: [], date1904: false }
  await parse(archive, entry, (p) => {
    p.onopentag = (n) => {
      const node = n as sax.Tag
      switch (local(node.name)) {
        case 'sheet':
          info.sheets.push({
            id: Number(attr(node, 'sheetId') ?? info.sheets.length + 1),
            name: attr(node, 'name') ?? `Blatt ${info.sheets.length + 1}`,
            rid: attr(node, 'id') ?? ''
          })
          break
        case 'workbookPr': {
          const v = (attr(node, 'date1904') ?? '').toLowerCase()
          info.date1904 = v === '1' || v === 'true'
          break
        }
      }
    }
  })
  return info
}

/** Zahlenformat je Zellstil (Index in cellXfs); undefined heisst „Standard". */
async function readStyles(archive: Archive, part: string | undefined): Promise<Array<string | undefined>> {
  const entry = part ? archive.entries.get(part.toLowerCase()) : undefined
  if (!entry) return []
  const custom = new Map<number, string>()
  const xfFormats: number[] = []
  let inCellXfs = false
  let depth = 0
  await parse(archive, entry, (p) => {
    p.onopentag = (n) => {
      const node = n as sax.Tag
      const name = local(node.name)
      if (name === 'numFmt') {
        custom.set(Number(attr(node, 'numFmtId')), attr(node, 'formatCode') ?? '')
      } else if (name === 'cellXfs') {
        inCellXfs = true
        depth = 0
      } else if (inCellXfs) {
        depth++
        // Nur die unmittelbaren xf-Kinder von cellXfs, nicht cellStyleXfs.
        if (name === 'xf' && depth === 1) xfFormats.push(Number(attr(node, 'numFmtId') ?? 0))
      }
    }
    p.onclosetag = (tag) => {
      const name = local(tag)
      if (name === 'cellXfs') inCellXfs = false
      else if (inCellXfs) depth--
    }
  })
  return xfFormats.map((id) => (id ? custom.get(id) ?? BUILTIN_FORMATS[id] : undefined))
}

/**
 * Gemeinsame Zeichenketten. Ein Eintrag ist entweder ein <t> oder eine Folge
 * von Formatlaeufen <r><t>; Lautschrift (<rPh>) gehoert nicht zum Wert.
 */
async function readSharedStrings(archive: Archive, part: string | undefined): Promise<string[]> {
  const entry = part ? archive.entries.get(part.toLowerCase()) : undefined
  if (!entry) return []
  const out: string[] = []
  let current: string | null = null
  let inText = false
  let inPhonetic = 0
  await parse(archive, entry, (p) => {
    p.onopentag = (n) => {
      switch (local(n.name)) {
        case 'si': current = ''; break
        case 'rPh': inPhonetic++; break
        case 't': inText = inPhonetic === 0; break
      }
    }
    p.ontext = (text) => { if (inText && current !== null) current += text }
    p.oncdata = (text) => { if (inText && current !== null) current += text }
    p.onclosetag = (tag) => {
      switch (local(tag)) {
        case 'si': out.push(decodeEscapes(current ?? '')); current = null; break
        case 'rPh': inPhonetic--; break
        case 't': inText = false; break
      }
    }
  })
  return out
}

// --- Blaetter -----------------------------------------------------------------

interface CellState {
  col: number
  style: number
  type: string
  value: string | null
  inline: string | null
  formula: boolean
}

/** Wert einer Zelle in der Form, die excelValue.ts erwartet. */
function cellValue(c: CellState, shared: readonly string[], numFmt: string | undefined, date1904: boolean): unknown {
  const v = c.value
  if (c.formula) {
    // Formeln werden nicht ausgerechnet; gelesen wird das Ergebnis, das die
    // Tabellenkalkulation beim Speichern abgelegt hat.
    if (v === null) return null
    switch (c.type) {
      case 'str': return decodeEscapes(v)
      case 'b': return v.trim() !== '0' && v.trim() !== 'false'
      case 'e': return { error: v }
      default: return numberValue(v, numFmt, date1904)
    }
  }
  switch (c.type) {
    case 's': {
      if (v === null) return null
      return shared[parseInt(v, 10)] ?? null
    }
    case 'inlineStr':
      return c.inline !== null ? decodeEscapes(c.inline) : v !== null ? decodeEscapes(v) : null
    case 'str':
      return v === null ? null : decodeEscapes(v)
    case 'e':
      return v === null ? null : { error: v }
    case 'b':
      return v === null ? null : v.trim() !== '0' && v.trim() !== 'false'
    case 'd': {
      // ISO-Datum (Strict OOXML). Selten, aber erlaubt.
      if (v === null) return null
      const d = new Date(v.endsWith('Z') || /[+-]\d\d:\d\d$/.test(v) || !v.includes('T') ? v : `${v}Z`)
      return Number.isNaN(d.getTime()) ? v : d
    }
    default:
      return v === null ? null : numberValue(v, numFmt, date1904)
  }
}

function numberValue(text: string, numFmt: string | undefined, date1904: boolean): unknown {
  const n = parseFloat(text)
  if (Number.isNaN(n)) return text
  return isDateFormat(numFmt) ? excelSerialToDate(n, date1904) : n
}

async function* sheetRows(
  archive: Archive,
  entry: yauzl.Entry,
  shared: readonly string[],
  formats: ReadonlyArray<string | undefined>,
  date1904: boolean
): AsyncGenerator<XlsxRow> {
  const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false, position: false })
  let failure: unknown = null
  const ready: XlsxRow[] = []
  let row: XlsxRow | null = null
  let cell: CellState | null = null
  let nextCol = 0
  let target: 'v' | 'f' | 't' | null = null
  let inInline = false
  let inPhonetic = 0

  parser.onerror = (e) => { failure = e }
  parser.onopentag = (n) => {
    const node = n as sax.Tag
    switch (local(node.name)) {
      case 'row':
        row = []
        nextCol = 0
        break
      case 'c': {
        if (!row) break
        const ref = attr(node, 'r')
        const col = ref ? columnIndex(ref) : nextCol
        cell = {
          col: col >= 0 ? col : nextCol,
          style: parseInt(attr(node, 's') ?? '0', 10) || 0,
          type: attr(node, 't') ?? 'n',
          value: null,
          inline: null,
          formula: false
        }
        break
      }
      case 'v':
        if (cell) { target = 'v'; cell.value = '' }
        break
      case 'f':
        if (cell) { target = 'f'; cell.formula = true }
        break
      case 'is':
        if (cell) { inInline = true; cell.inline = '' }
        break
      case 'rPh':
        inPhonetic++
        break
      case 't':
        if (cell && inInline && inPhonetic === 0) target = 't'
        break
    }
  }
  const onText = (text: string): void => {
    if (!cell) return
    if (target === 'v') cell.value = (cell.value ?? '') + text
    else if (target === 't') cell.inline = (cell.inline ?? '') + text
  }
  parser.ontext = onText
  parser.oncdata = onText
  parser.onclosetag = (tag) => {
    switch (local(tag)) {
      case 'v':
      case 'f':
      case 't':
        target = null
        break
      case 'is':
        inInline = false
        break
      case 'rPh':
        inPhonetic--
        break
      case 'c':
        if (row && cell) {
          // Zellstil 0 traegt wie bei exceljs kein Zahlenformat.
          const numFmt = cell.style ? formats[cell.style] : undefined
          const value = cellValue(cell, shared, numFmt, date1904)
          row[cell.col] = numFmt === undefined ? { value } : { value, numFmt }
          nextCol = cell.col + 1
        }
        cell = null
        break
      case 'row':
        if (row) ready.push(row)
        row = null
        break
    }
  }

  const stream = await openStream(archive, entry)
  try {
    for await (const text of xmlText(stream)) {
      parser.write(text)
      if (failure) break
      while (ready.length > 0) yield ready.shift() as XlsxRow
    }
    if (!failure) parser.close()
    if (failure) throw new XlsxError(`Blatt ${entry.fileName} ist kein gueltiges XML.`, { cause: failure })
    while (ready.length > 0) yield ready.shift() as XlsxRow
  } finally {
    ;(stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.()
  }
}

// --- Oeffentliche Schnittstelle -------------------------------------------------

/** Oeffnet eine Mappe; Blattliste, Zeichenketten und Stile werden sofort gelesen. */
export async function openWorkbook(path: string): Promise<XlsxWorkbook> {
  const archive = await openArchive(path)
  try {
    const rootRels = await readRels(archive, '')
    const workbookPart = rootRels.find((r) => REL_OFFICE_DOCUMENT.test(r.type))?.target ?? 'xl/workbook.xml'
    const wb = await readWorkbook(archive, workbookPart)
    const rels = await readRels(archive, workbookPart)
    const byId = new Map(rels.map((r) => [r.id, r]))

    const shared = await readSharedStrings(archive, rels.find((r) => REL_SHARED_STRINGS.test(r.type))?.target)
    const formats = await readStyles(archive, rels.find((r) => REL_STYLES.test(r.type))?.target)

    // Nur Arbeitsblaetter; Diagrammblaetter haben keine Zellen.
    const sheets: XlsxSheet[] = []
    for (const s of wb.sheets) {
      const rel = byId.get(s.rid)
      if (!rel || !REL_WORKSHEET.test(rel.type)) continue
      if (!archive.entries.has(rel.target.toLowerCase())) continue
      sheets.push({ id: s.id, name: s.name, part: rel.target })
    }

    return {
      sheets,
      rows(sheet: XlsxSheet): AsyncGenerator<XlsxRow> {
        const entry = archive.entries.get(sheet.part.toLowerCase())
        if (!entry) throw new XlsxError(`Das Tabellenblatt „${sheet.name}“ fehlt im Archiv.`)
        return sheetRows(archive, entry, shared, formats, wb.date1904)
      },
      close(): void {
        archive.zip.close()
      }
    }
  } catch (e) {
    archive.zip.close()
    throw e
  }
}
