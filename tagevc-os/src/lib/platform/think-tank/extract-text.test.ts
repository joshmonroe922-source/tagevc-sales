import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

import { extractDocumentText } from './extract-text';
import { isThinkTankAllowedFile, THINK_TANK_FILE_ACCEPT } from './types';

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

function makeTextPdf(pages: string[], opts?: { flate?: boolean }): Uint8Array {
  const escape = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const contentIds = pages.map((_, i) => 4 + i * 2);
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const maxId = 3 + pages.length * 2;
  const objs = new Map<number, string>();
  objs.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objs.set(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  objs.set(fontId, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  for (let i = 0; i < pages.length; i++) {
    const raw = `BT /F1 18 Tf 72 720 Td (${escape(pages[i] || ' ')}) Tj ET`;
    if (opts?.flate) {
      const compressed = deflateSync(Buffer.from(raw, 'latin1'));
      objs.set(
        contentIds[i],
        `<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed.toString('latin1')}\nendstream`,
      );
    } else {
      objs.set(contentIds[i], `<< /Length ${raw.length} >>\nstream\n${raw}\nendstream`);
    }
    objs.set(
      pageIds[i],
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
  }
  let body = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  for (let id = 1; id <= maxId; id++) {
    offsets.set(id, Buffer.byteLength(body, 'latin1'));
    body += `${id} 0 obj\n${objs.get(id)}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${maxId + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let id = 1; id <= maxId; id++) {
    body += `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('isThinkTankAllowedFile', () => {
  it('requires an allowed extension and an allowed or generic MIME', () => {
    assert.equal(
      isThinkTankAllowedFile(
        'model.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
      true,
    );
    assert.equal(isThinkTankAllowedFile('legacy.xls', 'application/vnd.ms-excel'), true);
    assert.equal(isThinkTankAllowedFile('brief.docx', ''), true);
    assert.equal(isThinkTankAllowedFile('memo.doc', 'application/msword'), true);
    assert.equal(isThinkTankAllowedFile('grid.csv', 'text/csv'), true);
    assert.equal(isThinkTankAllowedFile('grid.csv', 'text/plain'), true);
    assert.equal(isThinkTankAllowedFile('notes.exe', 'application/pdf'), false);
    assert.equal(isThinkTankAllowedFile('model.xlsx', 'image/png'), false);
    assert.equal(isThinkTankAllowedFile('brief.pdf', 'application/pdf'), true);
    assert.match(THINK_TANK_FILE_ACCEPT, /\.pdf/);
    assert.match(THINK_TANK_FILE_ACCEPT, /\.xlsx/);
    assert.match(THINK_TANK_FILE_ACCEPT, /\.xls/);
    assert.match(THINK_TANK_FILE_ACCEPT, /\.doc/);
  });
});

describe('extractDocumentText', () => {
  it('extracts sheet names and cells from xlsx', async () => {
    const result = await extractDocumentText({ fileName: 'model.xlsx', bytes: sampleXlsx() });
    assert.equal(result.method, 'xlsx-ooxml');
    assert.match(result.text ?? '', /## Sheet: Revenue/);
    assert.match(result.text ?? '', /Acme Corp/);
    assert.match(result.text ?? '', /1500/);
    assert.match(result.text ?? '', /## Sheet: Notes/);
    assert.match(result.text ?? '', /Note 2/);
  });

  it('caps extra sheets and notes truncation', async () => {
    const result = await extractDocumentText({ fileName: 'wide.xlsx', bytes: sampleXlsx(10) });
    assert.match(result.text ?? '', /\[truncated: showing first 8 sheets\]/);
    assert.equal((result.text ?? '').includes('Extra9'), false);
  });

  it('caps csv rows', async () => {
    const rows = ['h1,h2', ...Array.from({ length: 250 }, (_, i) => `${i},x`)];
    const result = await extractDocumentText({
      fileName: 'dump.csv',
      bytes: new TextEncoder().encode(rows.join('\n')),
    });
    assert.equal(result.method, 'csv');
    assert.match(result.text ?? '', /\[truncated: first 200 rows\]/);
    assert.match(result.text ?? '', /h1,h2/);
  });

  it('reads docx document.xml', async () => {
    const bytes = makeStoredZip({
      'word/document.xml': `<w:document><w:body><w:p><w:t>Hello Think Tank</w:t></w:p><w:p><w:t>Second paragraph</w:t></w:p></w:body></w:document>`,
    });
    const result = await extractDocumentText({ fileName: 'brief.docx', bytes });
    assert.equal(result.method, 'docx-ooxml');
    assert.match(result.text ?? '', /Hello Think Tank/);
    assert.match(result.text ?? '', /Second paragraph/);
  });

  it('dumps readable ascii from legacy xls', async () => {
    const payload = Buffer.concat([
      Buffer.from('not-a-zip'),
      Buffer.from('Q1 Revenue\nAcme 1500\nBeta 900\n'),
    ]);
    const result = await extractDocumentText({ fileName: 'legacy.xls', bytes: payload });
    assert.equal(result.method, 'xls-dump');
    assert.match(result.text ?? '', /Acme 1500/);
    assert.match(result.text ?? '', /layout may be approximate/);
  });

  it('extracts a text layer from a PDF', async () => {
    const result = await extractDocumentText({
      fileName: 'brief.pdf',
      bytes: makeTextPdf(['Hello Think Tank page 1 unique phrase']),
    });
    assert.equal(result.method, 'pdf-unpdf');
    assert.match(result.text ?? '', /## Page 1/);
    assert.match(result.text ?? '', /Hello Think Tank page 1 unique phrase/);
  });

  it('caps extra PDF pages', async () => {
    const pages = Array.from({ length: 25 }, (_, i) => `Page body ${i + 1} with enough letters`);
    const result = await extractDocumentText({
      fileName: 'long.pdf',
      bytes: makeTextPdf(pages),
    });
    assert.match(result.text ?? '', /## Page 1/);
    assert.match(result.text ?? '', /Page body 1/);
    assert.match(result.text ?? '', /\[truncated: first 20 of 25 pages\]/);
    assert.equal((result.text ?? '').includes('Page body 21'), false);
  });

  it('notes when a PDF has no text layer', async () => {
    const result = await extractDocumentText({
      fileName: 'scan.pdf',
      bytes: makeTextPdf(['']),
    });
    assert.equal(result.method, 'pdf-unpdf');
    assert.equal(result.text, null);
    assert.match(result.error ?? '', /no extractable text layer/i);
  });
});
