/*
 * Der eigene XLSX-Leser (server/lib/converters/xlsx.ts).
 *
 * Bis zum 29.10.2026 las der Importer mit exceljs. Beim Wechsel wurde der neue
 * Leser gegen exceljs und gegen openpyxl ueber alle echten Lieferungen auf dem
 * Testserver verglichen. Die Faelle unten halten fest, was dabei auffiel —
 * vor allem die Stellen, an denen exceljs falsch lag.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cellText } from '../../server/lib/converters/excelValue'
import { columnIndex, decodeEscapes, openWorkbook, XlsxError, type XlsxRow } from '../../server/lib/converters/xlsx'
import { extractSheet, listSheets } from '../../server/lib/converters/spreadsheet'
import { mappeTeile, schreibeMappe, zip, type Mappe } from './xlsxBau'

let dir = ''
let n = 0
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'avefi-xlsx-leser-')) })
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

async function mappe(m: Mappe): Promise<string> {
  const p = join(dir, `m${n++}.xlsx`)
  schreibeMappe(p, m)
  return p
}

/** Alle Zeilen eines Blatts als Text, wie sie in die CSV gehen. */
async function texte(path: string, sheet = 0): Promise<string[][]> {
  const wb = await openWorkbook(path)
  try {
    const out: string[][] = []
    for await (const row of wb.rows(wb.sheets[sheet]!)) out.push(Array.from(row, (c) => (c ? cellText(c) : '')))
    return out
  } finally {
    wb.close()
  }
}

async function zeilen(path: string, sheet = 0): Promise<XlsxRow[]> {
  const wb = await openWorkbook(path)
  try {
    const out: XlsxRow[] = []
    for await (const row of wb.rows(wb.sheets[sheet]!)) out.push(row)
    return out
  } finally {
    wb.close()
  }
}

describe('Hilfsfunktionen', () => {
  it('rechnet Spaltenbuchstaben um', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnIndex('AD7')).toBe(29)
    expect(columnIndex('XFD1048576')).toBe(16383)
  })

  it('loest _xHHHH_ auf, auch den maskierten Unterstrich', () => {
    expect(decodeEscapes('a_x000D_b')).toBe('a\rb')
    expect(decodeEscapes('_x005F_x000D_ bleibt')).toBe('_x000D_ bleibt')
    expect(decodeEscapes('kein_x_Muster')).toBe('kein_x_Muster')
  })
})

describe('Zeichenketten', () => {
  it('liest gemeinsame, formatierte und eingebettete Zeichenketten', async () => {
    const p = await mappe({
      zeichenketten: [
        '<si><t>einfach</t></si>',
        '<si><r><t xml:space="preserve">Der </t></r><r><rPr><b/></rPr><t>Golem</t></r></si>',
        '<si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></si>',
        '<si><t/></si>'
      ],
      blaetter: [{
        name: 'T',
        daten: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>' +
          '<c r="D1" t="inlineStr"><is><r><t>ein</t></r><r><t>gebettet</t></r></is></c>' +
          '<c r="E1" t="str"><v>Text &amp; Zeichen</v></c><c r="F1" t="s"><v>3</v></c></row>'
      }]
    })
    // exceljs: Lautschrift statt Wert („かんじ“) und bei eingebettetem Text nur der letzte Lauf („gebettet“).
    expect(await texte(p)).toEqual([['einfach', 'Der Golem', '漢字', 'eingebettet', 'Text & Zeichen', '']])
  })

  it('macht aus \\r\\n einen Umbruch wie der XML-Standard, laesst &#13; aber stehen', async () => {
    const p = await mappe({
      zeichenketten: ['<si><t>Zeile 1\r\nZeile 2\rZeile 3</t></si>', '<si><t>mit&#13;Absicht</t></si>'],
      blaetter: [{ name: 'T', daten: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' }]
    })
    expect(await texte(p)).toEqual([['Zeile 1\nZeile 2\nZeile 3', 'mit\rAbsicht']])
  })

  it('zerbricht kein UTF-8-Zeichen an der Grenze zweier Bloecke', async () => {
    // exceljs machte aus „Tänzerinnen“ in einer echten Lieferung „T��nzerinnen“,
    // weil es jeden Block einzeln in Text umwandelte. Mit genug Umlauten liegt
    // sicher einer auf einer Blockgrenze.
    const lang = 'Tänzerinnen ÄÖÜ äöü ß € 漢字 '.repeat(4000)
    const p = await mappe({ zeichenketten: [`<si><t>${lang}</t></si>`], blaetter: [{ name: 'T', daten: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }] })
    const [[wert]] = await texte(p)
    expect(wert).toBe(lang)
    expect(wert).not.toContain('�')
  })

  it('loest _x000D_ in Zeichenketten auf', async () => {
    const p = await mappe({
      zeichenketten: ['<si><t>a_x000D_b</t></si>'],
      blaetter: [{ name: 'T', daten: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>_x005F_x000D_</t></is></c></row>' }]
    })
    expect(await texte(p)).toEqual([['a\rb', '_x000D_']])
  })
})

describe('Zahlen, Datum, Formeln', () => {
  const formate = { 164: 'dd.mm.yyyy', 165: '#,##0.00\\ "€"', 166: '00000' }
  // Stile: 1 Datum (eigen), 2 Waehrung (eigen), 3 fuehrende Nullen (eigen), 4 eingebaut 14, 5 eingebaut 10
  const stile = [164, 165, 166, 14, 10]

  it('liefert das Zahlenformat aus cellXfs und erkennt Datumsformate', async () => {
    const p = await mappe({
      formate, stile,
      blaetter: [{
        name: 'Z',
        daten: '<row r="1"><c r="A1" s="1"><v>22352</v></c><c r="B1" s="2"><v>1234.5</v></c>' +
          '<c r="C1" s="3"><v>123</v></c><c r="D1" s="4"><v>22352</v></c><c r="E1" s="5"><v>0.125</v></c><c r="F1"><v>3200201</v></c></row>'
      }]
    })
    const [row] = await zeilen(p)
    expect(row![0]!.value).toBeInstanceOf(Date)
    expect(row![0]!.numFmt).toBe('dd.mm.yyyy')
    expect(row![1]!.numFmt).toBe('#,##0.00\\ "€"')
    expect(row![3]!.numFmt).toBe('mm-dd-yy')
    expect(row![5]!.numFmt).toBeUndefined()
    // „00000“ fuellt excelValue.ts nicht mit Nullen auf; das war mit exceljs genauso.
    expect(await texte(p)).toEqual([['12.03.1961', '1.234,50', '123', '03-12-61', '12,50 %', '3200201']])
  })

  it('liest Formelergebnisse in jeder Art', async () => {
    const p = await mappe({
      formate, stile,
      blaetter: [{
        name: 'F',
        daten: '<row r="1">' +
          '<c r="A1"><f>B1-B1</f><v>0</v></c>' + // exceljs: leer
          '<c r="B1" t="e"><f>1/0</f><v>#DIV/0!</v></c>' + // exceljs: leer
          '<c r="C1" s="1"><f>D1+30</f><v>22382</v></c>' + // exceljs: Seriennummer 22382
          '<c r="D1" t="b"><f>1&gt;0</f><v>1</v></c>' + // exceljs: 1
          '<c r="E1" t="str"><f>A1&amp;"x"</f><v>0x</v></c>' +
          '<c r="F1"><f>NICHTGERECHNET()</f></c>' + // ohne gespeichertes Ergebnis
          '<c r="G1"><f t="shared" si="0"/><v>7</v></c>' +
          '</row>'
      }]
    })
    expect(await texte(p)).toEqual([['0', '#DIV/0!', '11.04.1961', 'true', '0x', '', '7']])
  })

  it('liest Wahrheitswerte, Fehler und ISO-Datum ohne Formel', async () => {
    const p = await mappe({
      formate, stile,
      blaetter: [{
        name: 'W',
        daten: '<row r="1"><c r="A1" t="b"><v>0</v></c><c r="B1" t="e"><v>#N/A</v></c><c r="C1" t="d" s="1"><v>1961-03-12</v></c><c r="D1"><v>-0.5</v></c></row>'
      }]
    })
    expect(await texte(p)).toEqual([['false', '#N/A', '12.03.1961', '-0.5']])
  })

  it('rechnet im 1904-Datumssystem', async () => {
    // 35063 ist im 1904-System der 31.12.1999, im 1900-System der 29.12.1995.
    const p = await mappe({ date1904: true, formate, stile, blaetter: [{ name: 'D', daten: '<row r="1"><c r="A1" s="1"><v>35063</v></c></row>' }] })
    expect(await texte(p)).toEqual([['31.12.1999']])
  })

  it('gibt Zellstil 0 kein Zahlenformat, auch wenn cellXfs[0] eines hat', async () => {
    const teile = mappeTeile({ blaetter: [{ name: 'S', daten: '<row r="1"><c r="A1"><v>22352</v></c><c r="B1" s="0"><v>5</v></c></row>' }] })
    teile['xl/styles.xml'] = '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>'
    const p = join(dir, 'stil0.xlsx')
    await writeFile(p, zip(teile))
    expect(await texte(p)).toEqual([['22352', '5']])
  })
})

describe('Zeilen und Spalten', () => {
  it('setzt Zellen nach ihrer Adresse und laesst Luecken leer', async () => {
    const p = await mappe({ blaetter: [{ name: 'L', daten: '<row r="1"><c r="A1"><v>1</v></c><c r="D1"><v>4</v></c></row><row r="7"><c r="AD7"><v>30</v></c></row>' }] })
    const rows = await texte(p)
    expect(rows[0]).toEqual(['1', '', '', '4'])
    expect(rows[1]!.length).toBe(30)
    expect(rows[1]![29]).toBe('30')
  })

  it('zaehlt Zellen ohne Adresse fortlaufend', async () => {
    const p = await mappe({ blaetter: [{ name: 'O', daten: '<row><c><v>1</v></c><c><v>2</v></c><c r="E1"><v>5</v></c><c><v>6</v></c></row>' }] })
    expect(await texte(p)).toEqual([['1', '2', '', '', '5', '6']])
  })

  it('bricht beim Abbruch des Aufrufers sauber ab', async () => {
    const daten = Array.from({ length: 2000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('')
    const p = await mappe({ blaetter: [{ name: 'G', daten }] })
    const wb = await openWorkbook(p)
    let gelesen = 0
    for await (const _ of wb.rows(wb.sheets[0]!)) { if (++gelesen === 3) break }
    wb.close()
    expect(gelesen).toBe(3)
  })
})

describe('Mappe', () => {
  it('liefert die Blaetter in der Reihenfolge der Registerkarten, nicht nach sheetId', async () => {
    const p = await mappe({
      blaetter: [
        { name: 'Drittes', sheetId: 3, daten: '<row r="1"><c r="A1"><v>3</v></c></row>' },
        { name: 'Erstes', sheetId: 1, daten: '<row r="1"><c r="A1"><v>1</v></c></row>' }
      ]
    })
    const sheets = await listSheets(p)
    expect(sheets.map((s) => [s.name, s.index])).toEqual([['Drittes', 3], ['Erstes', 1]])
  })

  it('kommt ohne sharedStrings.xml und styles.xml aus', async () => {
    const teile = mappeTeile({ blaetter: [{ name: 'Nackt', daten: '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1"><v>2</v></c></row>' }] })
    delete teile['xl/sharedStrings.xml']
    delete teile['xl/styles.xml']
    const p = join(dir, 'nackt.xlsx')
    await writeFile(p, zip(teile))
    expect(await texte(p)).toEqual([['x', '2']])
  })

  it('ueberspringt Diagrammblaetter', async () => {
    const teile = mappeTeile({ blaetter: [{ name: 'Daten', daten: '<row r="1"><c r="A1"><v>1</v></c></row>' }] })
    teile['xl/workbook.xml'] = (teile['xl/workbook.xml'] as string).replace('</sheets>', '<sheet name="Diagramm" sheetId="9" r:id="rC"/></sheets>')
    teile['xl/_rels/workbook.xml.rels'] = (teile['xl/_rels/workbook.xml.rels'] as string).replace(
      '</Relationships>',
      '<Relationship Id="rC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>'
    )
    teile['xl/chartsheets/sheet1.xml'] = '<chartsheet/>'
    const p = join(dir, 'diagramm.xlsx')
    await writeFile(p, zip(teile))
    expect((await listSheets(p)).map((s) => s.name)).toEqual(['Daten'])
  })

  it('findet die Mappe ueber _rels/.rels, auch unter anderem Namen', async () => {
    const teile = mappeTeile({ blaetter: [{ name: 'A', daten: '<row r="1"><c r="A1"><v>1</v></c></row>' }] })
    teile['_rels/.rels'] = (teile['_rels/.rels'] as string).replace('xl/workbook.xml', 'xl/workbook2.xml')
    teile['xl/workbook2.xml'] = teile['xl/workbook.xml']!
    teile['xl/_rels/workbook2.xml.rels'] = teile['xl/_rels/workbook.xml.rels']!
    delete teile['xl/workbook.xml']
    delete teile['xl/_rels/workbook.xml.rels']
    const p = join(dir, 'anders.xlsx')
    await writeFile(p, zip(teile))
    expect(await texte(p)).toEqual([['1']])
  })

  it('meldet eine Datei, die kein ZIP-Archiv ist, verstaendlich', async () => {
    const p = join(dir, 'kaputt.xlsx')
    await writeFile(p, 'das ist keine Arbeitsmappe')
    await expect(openWorkbook(p)).rejects.toBeInstanceOf(XlsxError)
    await expect(listSheets(p)).rejects.toThrow(/keine lesbare XLSX-Arbeitsmappe/)
  })

  it('meldet kaputtes XML in einem Blatt', async () => {
    const p = await mappe({ blaetter: [{ name: 'X', daten: '<row r="1"><c r="A1"><v>1</v></row>' }] })
    await expect(listSheets(p)).rejects.toThrow(/kein gueltiges XML/)
  })

  it('liest beim Herausloesen nur das gewuenschte Blatt', async () => {
    const p = await mappe({
      blaetter: [
        { name: 'Kaputt', daten: '<row r="1"><c r="A1"><v>1</v></row>' },
        { name: 'Gut', daten: '<row r="1"><c r="A1" t="inlineStr"><is><t>Kopf</t></is></c><c r="B1" t="inlineStr"><is><t>B</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row>' }
      ]
    })
    // exceljs musste die ganze Mappe durchlaufen und waere am ersten Blatt gescheitert.
    const info = await extractSheet(p, 'Gut', join(dir, 'gut.csv'))
    expect(info).toEqual({ rows: 1, cols: 2, skippedEmpty: 0 })
  })
})
