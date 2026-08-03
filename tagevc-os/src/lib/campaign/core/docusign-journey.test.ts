import { describe, expect, it } from 'vitest';
import { validateJourneyGraph, getStarterPack } from './journey-graph';

describe('phase 5b journey DocuSign packs', () => {
  it('Signent + Instant NDA packs include send_envelope', () => {
    for (const id of ['signent_onboarding', 'inda_nda_chase'] as const) {
      const pack = getStarterPack(id);
      expect(pack).toBeTruthy();
      const v = validateJourneyGraph(pack!.graph);
      expect(v.ok).toBe(true);
      expect(pack!.graph.nodes.some((n) => n.type === 'send_envelope')).toBe(true);
      expect(pack!.graph.nodes.some((n) => n.type === 'goal')).toBe(true);
    }
  });
});
