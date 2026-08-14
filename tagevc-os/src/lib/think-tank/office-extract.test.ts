import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { extractDocumentText } from '@/lib/platform/think-tank/extract-text';
import {
  isThinkTankAllowedFile,
  THINK_TANK_FILE_ACCEPT,
} from '@/lib/platform/think-tank/types';

function makeStoredZip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localFull = Buffer.concat([local, nameBuf, data]);
    locals.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += localFull.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(locals.length, 8);
  eocd.writeUInt16LE(locals.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function sampleXlsx(sheetCount = 2): Uint8Array {
  const sheets = Array.from({ length: sheetCount }, (_, i) => i + 1);
  const workbookSheets = sheets
    .map(
      (n) =>
        `<sheet name="${n === 1 ? 'Revenue' : n === 2 ? 'Notes' : `Extra${n}`}" sheetId="${n}" r:id="rId${n}"/>`,
    )
    .join('');
  const rels = sheets
    .map(
      (n) =>
        `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
    )
    .join('');
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Account</t></si><si><t>Amount</t></si><si><t>Acme Corp</t></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c></row></sheetData></worksheet>`,
  };
  for (const n of sheets.slice(1)) {
    files[`xl/worksheets/sheet${n}.xml`] =
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Note ${n}</t></is></c></row></sheetData></worksheet>`;
  }
  return makeStoredZip(files);
}

describe('think-tank office extract (vitest)', () => {
  it('allows Word and Excel by extension + MIME', () => {
    expect(
      isThinkTankAllowedFile(
        'model.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
    expect(isThinkTankAllowedFile('memo.doc', 'application/msword')).toBe(true);
    expect(isThinkTankAllowedFile('notes.exe', 'application/pdf')).toBe(false);
    expect(THINK_TANK_FILE_ACCEPT).toContain('.xlsx');
  });

  it('extracts xlsx sheet names and cells', () => {
    const result = extractDocumentText({ fileName: 'model.xlsx', bytes: sampleXlsx() });
    expect(result.method).toBe('xlsx-ooxml');
    expect(result.text).toContain('## Sheet: Revenue');
    expect(result.text).toContain('Acme Corp');
    expect(result.text).toContain('1500');
  });
});
