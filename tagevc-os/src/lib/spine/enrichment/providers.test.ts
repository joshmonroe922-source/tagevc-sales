import { describe, expect, it } from 'vitest';
import { getEnrichmentProviderHealth } from '@/lib/spine/enrichment/providers';

describe('enrichment provider health', () => {
  it('reports not ready without LIVE flags / keys', () => {
    const health = getEnrichmentProviderHealth();
    expect(health.length).toBeGreaterThanOrEqual(3);
    for (const h of health) {
      if (!h.configured || !h.liveEnabled) {
        expect(h.ready).toBe(false);
      }
    }
  });
});
