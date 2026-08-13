/**
 * Plain-text extraction for Think Tank thread documents (PDF/DOCX/TXT/…).
 * Portable twin — copy with the rest of `src/lib/platform/think-tank/`.
 *
 * TXT/HTML are exact. DOCX is read from the OOXML zip; PDF content streams
 * are inflated before scanning. Scanned/image-only PDFs still need OCR.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';

const MAX_CHARS = 40_000;

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

function readZipEntry(buf: Buffer, wanted: string): Buffer | null {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const scanFloor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < entryCount; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    if (name === wanted) {
      if (localOffset + 30 > buf.length) return null;
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        try {
          return inflateRawSync(data);
        } catch {
          return null;
        }
      }
      return null;
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return null;
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

function decodePdfLiteral(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = src[++i];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && src[i + 1] >= '0' && src[i + 1] <= '7') {
        oct += src[++i];
      }
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case '\n':
        break;
      default:
        out += next;
    }
  }
  return out;
}

function textFromContentStream(content: string): string {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];

    if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      let literal = '';
      while (j < content.length && depth > 0) {
        const c = content[j];
        if (c === '\\') {
          literal += c + (content[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
        literal += c;
        j++;
      }
      out += decodePdfLiteral(literal);
      i = j + 1;
      continue;
    }

    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end > i) {
        const hex = content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
        if (hex.length >= 4) {
          for (let h = 0; h + 1 < hex.length; h += 2) {
            const code = parseInt(hex.slice(h, h + 2), 16);
            if (code >= 32 || code === 10 || code === 9) {
              out += String.fromCharCode(code);
            }
          }
        }
        i = end + 1;
        continue;
      }
    }

    if (
      (ch === 'T' &&
        (content[i + 1] === 'd' || content[i + 1] === 'D' || content[i + 1] === '*')) ||
      (ch === 'E' && content[i + 1] === 'T')
    ) {
      out += '\n';
      i += 2;
      continue;
    }
    i++;
  }
  return out;
}

function extractPdfText(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes);
  const latin = buf.toString('latin1');
  let collected = '';

  const streamRe = /stream\r?\n?/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    streamRe.lastIndex = end;

    const slice = buf.subarray(start, end);
    const dict = latin.slice(Math.max(0, match.index - 400), match.index);
    let data: Buffer | null = null;

    if (/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(slice);
      } catch {
        try {
          data = inflateRawSync(slice);
        } catch {
          data = null;
        }
      }
    } else if (
      !/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|ASCII85Decode|LZWDecode/.test(
        dict,
      )
    ) {
      data = Buffer.from(slice);
    }
    if (!data) continue;

    const content = data.toString('latin1');
    if (!/\bTj\b|\bTJ\b|\bTd\b|\bTf\b/.test(content)) continue;
    collected += `${textFromContentStream(content)}\n`;
  }

  const text = tidy(collected);
  return text.length >= 40 ? text.slice(0, MAX_CHARS) : null;
}

export function extractDocumentText(input: {
  fileName: string;
  bytes: Uint8Array;
}): { text: string | null; method: string; error?: string } {
  const name = input.fileName.toLowerCase();

  try {
    if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
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
      const text = extractPdfText(input.bytes);
      return text
        ? { text, method: 'pdf-stream' }
        : {
            text: null,
            method: 'pdf-stream',
            error:
              'Could not extract PDF text — this looks like a scanned/image PDF. Upload a text PDF, DOCX, or .txt export.',
          };
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
