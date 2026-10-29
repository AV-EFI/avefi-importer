/*
 * Kleine XLSX-Dateien fuer Tests, ohne Bibliothek.
 *
 * Bis zum 29.10.2026 baute excelDates.test.ts seine Mappe mit exceljs. Mit
 * exceljs ist auch dieser Weg weg. Eine XLSX-Datei ist ein ZIP-Archiv mit ein
 * paar XML-Teilen; beides laesst sich mit node:zlib in wenigen Zeilen
 * schreiben. Vorteil: Der Test legt genau das XML fest, das er pruefen will,
 * auch Faelle, die kein Programm von selbst schreibt.
 */
import { writeFileSync } from 'node:fs'
import { crc32, deflateRawSync } from 'node:zlib'

/** Ein ZIP-Archiv (Deflate) aus Pfad → Inhalt. */
export function zip(files: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const packed = deflateRawSync(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6) // Dateinamen in UTF-8
    head.writeUInt16LE(8, 8) // Deflate
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    local.push(head, nameBuf, packed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(packed.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)

    offset += head.length + nameBuf.length + packed.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBuf, end])
}

export interface Blatt {
  name: string
  /** Inhalt von <sheetData>, als XML. */
  daten: string
  sheetId?: number
}

export interface Mappe {
  blaetter: Blatt[]
  /** <si>-Eintraege, als XML. */
  zeichenketten?: string[]
  /** Eigene Zahlenformate: numFmtId → formatCode. */
  formate?: Record<number, string>
  /** numFmtId je Zellstil (Index in cellXfs). Stil 0 ist immer General. */
  stile?: number[]
  date1904?: boolean
  /** Weitere Archiveintraege oder Ersatz fuer die erzeugten. */
  extra?: Record<string, string | Buffer>
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Die Teile einer Mappe als Archiv-Eintraege. */
export function mappeTeile(m: Mappe): Record<string, string | Buffer> {
  const teile: Record<string, string | Buffer> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${R}">` +
      (m.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') +
      '<sheets>' +
      m.blaetter.map((b, i) => `<sheet name="${esc(b.name)}" sheetId="${b.sheetId ?? i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PR}">` +
      m.blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rS" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rT" Type="${R}/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/sharedStrings.xml':
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}">${(m.zeichenketten ?? []).join('')}</sst>`,
    'xl/styles.xml':
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}">` +
      `<numFmts>${Object.entries(m.formate ?? {}).map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join('')}</numFmts>` +
      '<cellStyleXfs><xf numFmtId="14"/></cellStyleXfs>' +
      `<cellXfs>${[0, ...(m.stile ?? [])].map((id) => `<xf numFmtId="${id}" fontId="0"><alignment/></xf>`).join('')}</cellXfs>` +
      '</styleSheet>'
  }
  m.blaetter.forEach((b, i) => {
    teile[`xl/worksheets/sheet${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${b.daten}</sheetData></worksheet>`
  })
  return { ...teile, ...(m.extra ?? {}) }
}

/** Schreibt eine Mappe als Datei. */
export function schreibeMappe(path: string, m: Mappe): void {
  writeFileSync(path, zip(mappeTeile(m)))
}
