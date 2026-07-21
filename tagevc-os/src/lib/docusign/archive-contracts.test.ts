import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  assertPdfPayload,
  describeArchiveBytes,
  readBoundedResponseBuffer,
} from './archive-contracts';

describe('DocuSign archive byte contracts', () => {
  it('derives length and SHA-256 from the downloaded bytes', () => {
    const bytes = Buffer.from('%PDF-1.7\nactual archive bytes');
    expect(describeArchiveBytes(bytes)).toEqual({
      contentLength: bytes.byteLength,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('rejects declared and streamed bodies over the limit', async () => {
    await expect(
      readBoundedResponseBuffer(
        new Response('small', { headers: { 'content-length': '101' } }),
        100,
        'archive',
      ),
    ).rejects.toThrow('exceeds 100 byte limit');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
        controller.close();
      },
    });
    await expect(
      readBoundedResponseBuffer(new Response(stream), 100, 'archive'),
    ).rejects.toThrow('exceeds 100 byte limit');
  });

  it('accepts only PDF content type with PDF magic bytes', () => {
    const pdf = Buffer.from('%PDF-1.7\nbody');
    expect(() => assertPdfPayload(pdf, 'application/pdf', 'archive')).not.toThrow();
    expect(() => assertPdfPayload(pdf, 'text/html', 'archive')).toThrow(
      'non-PDF',
    );
    expect(() =>
      assertPdfPayload(Buffer.from('<html>'), 'application/pdf', 'archive'),
    ).toThrow('invalid PDF bytes');
  });
});
