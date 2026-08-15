/**
 * Plain-text extraction for Think Tank thread documents (PDF/Word/Excel/TXT/…).
 * Portable twin — copy with the rest of `src/lib/platform/think-tank/`.
 *
 * TXT/HTML/CSV are exact. DOCX/XLSX are read from the OOXML zip. PDFs use
 * unpdf (serverless PDF.js) so compressed / object-stream files actually
 * yield a text layer — the old FlateDecode scrape missed most real PDFs.
 * Legacy .doc/.xls get a text dump. Spreadsheets cap sheets/rows; PDFs cap
 * pages so tokens stay bounded. Image-only scans get a no-text-layer note.
 */
import { inflateRawSync } from 'node:zlib';
import { extractText } from 'unpdf';

const MAX_CHARS = 40_000;
const MAX_SHEETS = 8;
const MAX_ROWS = 200;
const MAX_COLS = 40;
const MAX_PDF_PAGES = 20;
const MIN_PDF_LETTERS = 12;
const PDF_EXTRACT_MS = 20_000;
const MAX_ZIP_ENTRY = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL = 32 * 1024 * 1024;
const MAX_ZIP_FILES = 256;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidy(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const scanFloor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return files;

  const entryCount = Math.min(buf.readUInt16LE(eocd + 10), MAX_ZIP_FILES);
  let ptr = buf.readUInt32LE(eocd + 16);
  let total = 0;

  for (let n = 0; n < entryCount; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) continue;
    if (localOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, Math.min(buf.length, start + compressedSize));
    let out: Buffer | null = null;
    if (method === 0) {
      out = Buffer.from(data.subarray(0, MAX_ZIP_ENTRY));
    } else if (method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: MAX_ZIP_ENTRY });
      } catch {
        out = null;
      }
    }
    if (!out) continue;
    total += out.length;
    if (total > MAX_ZIP_TOTAL) break;
    files.set(name, out);
  }
  return files;
}

function readZipEntry(buf: Buffer, wanted: string): Buffer | null {
  return unzip(buf).get(wanted) ?? null;
}

function decodeXmlEntities(xml: string): string {
  return xml
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function zipJoin(baseDir: string, target: string): string {
  const raw = target.replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.startsWith('xl/')) return raw;
  const parts = `${baseDir.replace(/\/+$/, '')}/${raw}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function extractDocxText(bytes: Uint8Array): string | null {
  const xml = readZipEntry(Buffer.from(bytes), 'word/document.xml');
  if (xml) {
    const text = tidy(
      xml
        .toString('utf8')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:br\s*\/?>/g, '\n')
        .replace(/<w:tab\s*\/?>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
    if (text.length >= 20) return text.slice(0, MAX_CHARS);
  }

  const asLatin = Buffer.from(bytes).toString('binary');
  const chunks = asLatin.match(/<w:t[^>]*>[^<]+<\/w:t>/g);
  if (chunks && chunks.length > 0) {
    const joined = chunks
      .map((t) => t.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined.length >= 20) return joined.slice(0, MAX_CHARS);
  }
  return null;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml)) !== null) {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((t) =>
      decodeXmlEntities(t[1]).replace(/\s+/g, ' ').trim(),
    );
    out.push(texts.filter(Boolean).join(' '));
  }
  return out;
}

function parseWorkbookSheets(xml: string): { name: string; rid: string }[] {
  const sheets: { name: string; rid: string }[] = [];
  const re = /<sheet\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const attrs = match[1];
    const name = attrs.match(/\bname="([^"]*)"/i)?.[1] ?? '';
    const rid =
      attrs.match(/\br:id="([^"]*)"/i)?.[1] ?? attrs.match(/\bid="([^"]*)"/i)?.[1] ?? '';
    sheets.push({ name: decodeXmlEntities(name) || `Sheet${sheets.length + 1}`, rid });
  }
  return sheets;
}

function parseWorkbookRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<Relationship\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const attrs = match[1];
    const id = attrs.match(/\bId="([^"]*)"/i)?.[1];
    const target = attrs.match(/\bTarget="([^"]*)"/i)?.[1];
    if (id && target) map.set(id, target.replace(/\\/g, '/'));
  }
  return map;
}

function cellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

function parseWorksheetGrid(xml: string, shared: string[]): string[][] {
  const rows = new Map<number, Map<number, string>>();
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(xml)) !== null) {
    const attrs = match[1] ?? match[3] ?? '';
    const body = match[2] ?? '';
    const ref = attrs.match(/\br="([^"]+)"/)?.[1];
    if (!ref) continue;
    const pos = cellRef(ref);
    if (!pos || pos.row < 1 || pos.col < 1 || pos.col > MAX_COLS || pos.row > MAX_ROWS) {
      continue;
    }
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
    let value = '';
    if (type === 's') {
      const idx = Number(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '');
      value = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
    } else if (type === 'inlineStr' || type === 'str') {
      const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((t) =>
        decodeXmlEntities(t[1]),
      );
      value = texts.join('') || decodeXmlEntities(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '');
    } else if (type === 'b') {
      value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1]?.trim() === '1' ? 'TRUE' : 'FALSE';
    } else {
      value = decodeXmlEntities(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '').trim();
    }
    if (!value) continue;
    let row = rows.get(pos.row);
    if (!row) {
      row = new Map();
      rows.set(pos.row, row);
    }
    row.set(pos.col, value.replace(/\s+/g, ' ').trim());
  }

  const out: string[][] = [];
  const ordered = [...rows.keys()].sort((a, b) => a - b);
  for (const r of ordered) {
    const cols = rows.get(r)!;
    const maxCol = Math.min(MAX_COLS, Math.max(...cols.keys()));
    const line: string[] = [];
    for (let c = 1; c <= maxCol; c++) line.push(cols.get(c) ?? '');
    out.push(line);
  }
  return out;
}

function formatSheetDump(name: string, grid: string[][], truncatedRows: boolean): string {
  const lines = grid.map((row) => row.join('\t').replace(/[ \t]+$/g, ''));
  const body = lines.join('\n').trim();
  const note = truncatedRows ? '\n[truncated: first 200 rows, 40 columns]' : '';
  return `## Sheet: ${name}\n${body || '(empty)'}${note}`;
}

function extractXlsxText(bytes: Uint8Array): string | null {
  const files = unzip(Buffer.from(bytes));
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) return null;

  const sharedXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheets = parseWorkbookSheets(workbook.toString('utf8'));
  const rels = parseWorkbookRels(files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '');

  const parts: string[] = [];
  let truncatedSheets = false;
  const list = sheets.length > 0 ? sheets : [{ name: 'Sheet1', rid: '' }];
  if (list.length > MAX_SHEETS) truncatedSheets = true;

  for (const sheet of list.slice(0, MAX_SHEETS)) {
    const target = sheet.rid ? rels.get(sheet.rid) : undefined;
    const path = target
      ? zipJoin('xl', target)
      : `xl/worksheets/sheet${parts.length + 1}.xml`;
    const xml = files.get(path)?.toString('utf8');
    if (!xml) continue;
    const rowCount = (xml.match(/<row\b/gi) ?? []).length;
    const grid = parseWorksheetGrid(xml, shared);
    parts.push(formatSheetDump(sheet.name, grid, rowCount > MAX_ROWS));
    if (parts.join('\n\n').length >= MAX_CHARS) break;
  }

  if (parts.length === 0) {
    const fallbackSheets = [...files.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort();
    if (fallbackSheets.length > MAX_SHEETS) truncatedSheets = true;
    for (const path of fallbackSheets.slice(0, MAX_SHEETS)) {
      const xml = files.get(path)?.toString('utf8') ?? '';
      const name = path.match(/sheet(\d+)/i)?.[0] ?? path;
      const rowCount = (xml.match(/<row\b/gi) ?? []).length;
      parts.push(formatSheetDump(name, parseWorksheetGrid(xml, shared), rowCount > MAX_ROWS));
    }
  }

  let text = tidy(parts.join('\n\n'));
  if (!text) return null;
  if (truncatedSheets) {
    text += `\n\n[truncated: showing first ${MAX_SHEETS} sheets]`;
  }
  return text.slice(0, MAX_CHARS);
}

function harvestUtf16leStrings(buf: Buffer): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let i = 0;
  while (i + 5 < buf.length) {
    const code = buf.readUInt16LE(i);
    if (code < 32 || code > 126) {
      i += 2;
      continue;
    }
    let j = i;
    let chars = '';
    while (j + 1 < buf.length) {
      const c = buf.readUInt16LE(j);
      if (c === 0 || c < 32 || c > 126) break;
      chars += String.fromCharCode(c);
      j += 2;
      if (chars.length > 240) break;
    }
    const trimmed = chars.trim();
    if (trimmed.length >= 3 && /[A-Za-z0-9]/.test(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
    i = j > i ? j : i + 2;
  }
  return tidy(out.join('\n'));
}

function extractXlsText(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes);
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    return extractXlsxText(bytes);
  }
  const unicode = harvestUtf16leStrings(buf);
  const ascii = tidy(
    buf
      .toString('latin1')
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 3 && /[A-Za-z0-9]/.test(line))
      .join('\n'),
  );
  const text = unicode.length >= ascii.length ? unicode : ascii;
  if (text.length < 20) return null;
  return `[Excel .xls text dump — layout may be approximate]\n${text}`.slice(0, MAX_CHARS);
}

function extractCsvText(bytes: Uint8Array): string | null {
  const raw = tidy(decodeUtf8(bytes));
  if (!raw) return null;
  const lines = raw.split('\n');
  if (lines.length <= MAX_ROWS) return raw.slice(0, MAX_CHARS);
  const kept = lines.slice(0, MAX_ROWS).join('\n');
  return `${kept}\n\n[truncated: first ${MAX_ROWS} rows]`.slice(0, MAX_CHARS);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const NO_TEXT_LAYER =
  'This PDF has no extractable text layer (likely a scan or image). Upload a text PDF, Word, Excel, or .txt export.';

async function extractPdfText(bytes: Uint8Array): Promise<{
  text: string | null;
  error?: string;
}> {
  const data = Uint8Array.from(bytes);
  const extracted = await extractText(data, { mergePages: false });
  const totalPages = Number(extracted.totalPages ?? 0);
  if (totalPages < 1) {
    return { text: null, error: 'Could not read this PDF.' };
  }

  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const pageLimit = Math.min(totalPages, pages.length, MAX_PDF_PAGES);
  const parts: string[] = [];
  let chars = 0;
  let bodyLetters = 0;
  for (let i = 0; i < pageLimit; i++) {
    const pageText = tidy(pages[i] ?? '');
    bodyLetters += (pageText.match(/[A-Za-z0-9]/g) ?? []).length;
    const block = `## Page ${i + 1}\n${pageText || '(empty)'}`;
    parts.push(block);
    chars += block.length;
    if (chars >= MAX_CHARS) break;
  }

  if (bodyLetters < MIN_PDF_LETTERS) {
    return { text: null, error: NO_TEXT_LAYER };
  }

  let text = tidy(parts.join('\n\n'));
  const usedPages = parts.length;
  if (totalPages > usedPages || text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n\n[truncated: first ${usedPages} of ${totalPages} pages]`;
  }
  return { text: text.slice(0, MAX_CHARS) };
}

export async function extractDocumentText(input: {
  fileName: string;
  bytes: Uint8Array;
}): Promise<{ text: string | null; method: string; error?: string }> {
  const name = input.fileName.toLowerCase();

  try {
    if (name.endsWith('.csv')) {
      const text = extractCsvText(input.bytes);
      return text
        ? { text, method: 'csv' }
        : { text: null, method: 'csv', error: 'Empty CSV.' };
    }

    if (name.endsWith('.txt') || name.endsWith('.md')) {
      const text = tidy(decodeUtf8(input.bytes));
      return text
        ? { text: text.slice(0, MAX_CHARS), method: 'utf8' }
        : { text: null, method: 'utf8', error: 'Empty text file.' };
    }

    if (name.endsWith('.html') || name.endsWith('.htm')) {
      const text = stripHtml(decodeUtf8(input.bytes));
      return text
        ? { text: text.slice(0, MAX_CHARS), method: 'html' }
        : { text: null, method: 'html', error: 'Empty HTML.' };
    }

    if (name.endsWith('.docx')) {
      const text = extractDocxText(input.bytes);
      return text
        ? { text, method: 'docx-ooxml' }
        : {
            text: null,
            method: 'docx-ooxml',
            error: 'Could not read this Word file. Try a PDF or .txt copy.',
          };
    }

    if (name.endsWith('.xlsx')) {
      const text = extractXlsxText(input.bytes);
      return text
        ? { text, method: 'xlsx-ooxml' }
        : {
            text: null,
            method: 'xlsx-ooxml',
            error: 'Could not read this Excel workbook. Try CSV or a smaller .xlsx.',
          };
    }

    if (name.endsWith('.xls')) {
      const text = extractXlsText(input.bytes);
      return text
        ? { text, method: text.startsWith('[Excel .xls') ? 'xls-dump' : 'xlsx-ooxml' }
        : {
            text: null,
            method: 'xls-dump',
            error: 'Could not read this Excel .xls file. Prefer .xlsx or CSV.',
          };
    }

    if (name.endsWith('.doc')) {
      const ascii = decodeUtf8(input.bytes)
        .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return ascii.length >= 40
        ? { text: ascii.slice(0, MAX_CHARS), method: 'doc-ascii' }
        : {
            text: null,
            method: 'doc-ascii',
            error: 'Legacy .doc text was unreadable. Prefer PDF or DOCX/TXT.',
          };
    }

    if (name.endsWith('.pdf')) {
      try {
        const pdf = await withTimeout(
          extractPdfText(input.bytes),
          PDF_EXTRACT_MS,
          'PDF extract timed out.',
        );
        return pdf.text
          ? { text: pdf.text, method: 'pdf-unpdf' }
          : {
              text: null,
              method: 'pdf-unpdf',
              error: pdf.error ?? NO_TEXT_LAYER,
            };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not extract PDF text.';
        if (/password|encrypt/i.test(message)) {
          return {
            text: null,
            method: 'pdf-unpdf',
            error: 'This PDF is password-protected. Upload an unlocked copy.',
          };
        }
        return { text: null, method: 'pdf-unpdf', error: message };
      }
    }

    const fallback = tidy(decodeUtf8(input.bytes).replace(/\0/g, ''));
    if (fallback.length >= 40 && /[A-Za-z]{3,}/.test(fallback)) {
      return { text: fallback.slice(0, MAX_CHARS), method: 'utf8-fallback' };
    }
    return {
      text: null,
      method: 'none',
      error: 'Unsupported or unreadable file for Think Tank.',
    };
  } catch (err) {
    return {
      text: null,
      method: 'error',
      error: err instanceof Error ? err.message : 'Could not read this file.',
    };
  }
}
