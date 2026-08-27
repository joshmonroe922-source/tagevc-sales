import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

/**
 * Structural defaults for the portable shell twin.
 * New entity portals that copy `src/lib/platform/shell/` must keep these.
 */
function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('platform shell — full-width + full-bleed defaults', () => {
  it('defaults authenticated pages to full-width (no max-w-6xl column)', () => {
    const frame = read('src/lib/platform/shell/app-content-frame.tsx');
    assert.match(frame, /w-full max-w-none/);
    assert.match(frame, /data-content-frame=\{fullBleed \? 'full-bleed' : 'full-width'\}/);
    assert.doesNotMatch(frame, /mx-auto max-w-6xl/);
    assert.doesNotMatch(frame, /mx-auto max-w-7xl/);
  });

  it('keeps Messaging on the full-bleed allowlist', () => {
    const routes = read('src/lib/platform/shell/full-bleed-routes.ts');
    assert.match(routes, /FULL_BLEED_PREFIXES/);
    assert.match(routes, /\/messages/);
  });

  it('AppMain wires the portable content frame', () => {
    const main = read('src/lib/platform/shell/app-main.tsx');
    assert.match(main, /ShellAppContentFrame/);
    assert.match(main, /isFullBleedPath/);
  });
});
