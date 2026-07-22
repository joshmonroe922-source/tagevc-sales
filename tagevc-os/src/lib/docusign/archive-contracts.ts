import { createHash } from 'crypto';

export const DOCUSIGN_COMBINED_ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUSIGN_CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024;

export function describeArchiveBytes(buffer: Buffer): {
  contentLength: number;
  contentSha256: string;
} {
  return {
    contentLength: buffer.byteLength,
    contentSha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function readBoundedResponseBuffer(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared) {
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} byte limit`);
    }
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(`${label} exceeded byte limit`);
        throw new Error(`${label} exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function assertPdfPayload(
  buffer: Buffer,
  contentType: string | null,
  label: string,
): void {
  if (!contentType?.toLowerCase().startsWith('application/pdf')) {
    throw new Error(`${label} returned non-PDF content type`);
  }
  if (buffer.byteLength < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`${label} returned invalid PDF bytes`);
  }
}

export function decodeBoundedBase64(
  value: string,
  maxBytes: number,
  label: string,
): Buffer {
  const normalized = value.trim();
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (
    !normalized ||
    normalized.length > maxEncodedLength ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error(`${label} is invalid or exceeds ${maxBytes} byte limit`);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (
    buffer.byteLength > maxBytes ||
    buffer.toString('base64') !== normalized
  ) {
    throw new Error(`${label} is invalid or exceeds ${maxBytes} byte limit`);
  }
  return buffer;
}
