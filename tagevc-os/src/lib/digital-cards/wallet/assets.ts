/**
 * Pass image buffers — entity logo when available, else solid brand tile.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { getEntityLogo } from '@/lib/entities/logo';
import { TAGE_NAVY } from '@/lib/digital-cards/theme';

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Minimal solid RGBA PNG (PassKit icon/logo fallback). */
export function solidPng(
  size: number,
  rgb: [number, number, number] = [0x3b, 0x45, 0x59],
): Buffer {
  const [r, g, b] = rgb;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    const o = 1 + x * 4;
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
    row[o + 3] = 255;
  }
  const raw = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) {
    row.copy(raw, y * row.length);
  }
  const compressed = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseHexRgb(hex: string | undefined): [number, number, number] {
  const h = (hex || TAGE_NAVY).replace('#', '');
  if (h.length !== 6) return [0x3b, 0x45, 0x59];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

async function tryReadLocalLogo(
  entityId: string,
): Promise<Buffer | null> {
  const logo = getEntityLogo(entityId, 'primary', { surface: 'dark' });
  if (!logo?.localPublicPath) return null;
  const abs = join(process.cwd(), 'public', logo.localPublicPath.replace(/^\//, ''));
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export async function passImageBuffers(
  entityId: string,
  primaryHex?: string,
): Promise<{ icon: Buffer; logo: Buffer }> {
  const rgb = parseHexRgb(primaryHex);
  const fallbackIcon = solidPng(87, rgb);
  const fallbackLogo = solidPng(160, rgb);
  const logoFile = await tryReadLocalLogo(entityId);
  if (!logoFile) {
    return { icon: fallbackIcon, logo: fallbackLogo };
  }
  // PassKit accepts PNG; reuse brand asset for both icon + logo when present.
  return { icon: logoFile, logo: logoFile };
}
