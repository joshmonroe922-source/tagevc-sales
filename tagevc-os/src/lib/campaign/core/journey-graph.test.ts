import { describe, expect, it } from 'vitest';
import {
  emptyJourneyGraph,
  layoutJourneyGraph,
  validateJourneyGraph,
  newNodeId,
  JOURNEY_STARTER_PACKS,
  starterPacksForEntity,
  getStarterPack,
  normalizeJourneyGraph,
} from './journey-graph';

describe('journey graph', () => {
  it('empty graph has trigger', () => {
    const g = emptyJourneyGraph();
    expect(g.nodes.some((n) => n.type === 'trigger')).toBe(true);
  });

  it('warns on call_vm_email without vm_dropped', () => {
    const v = validateJourneyGraph(
      normalizeJourneyGraph({
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'c', type: 'call_vm_email', config: { send_email_on: ['answered'] } },
          { id: 'g', type: 'goal' },
        ],
        edges: [
          { from: 't', to: 'c' },
          { from: 'c', to: 'g' },
        ],
      }),
    );
    expect(v.warnings.some((w) => /vm_dropped/i.test(w))).toBe(true);
  });

  it('layouts missing positions', () => {
    const g = layoutJourneyGraph({
      nodes: [
        { id: 'a', type: 'trigger' },
        { id: 'b', type: 'email', config: { delivery_plane: 'graph' } },
        { id: 'c', type: 'goal' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    });
    expect(g.nodes.every((n) => n.position)).toBe(true);
  });

  it('newNodeId unique', () => {
    expect(newNodeId('email', ['email_1'])).toBe('email_2');
  });
});

describe('starter packs', () => {
  it('covers verticals', () => {
    expect(JOURNEY_STARTER_PACKS.length).toBeGreaterThanOrEqual(4);
    expect(getStarterPack('r619_candidate_nurture')?.mutex_group).toBe('recruiting_outreach');
  });

  it('entity filter', () => {
    expect(starterPacksForEntity('ENT-R619').some((p) => p.id.startsWith('r619'))).toBe(true);
  });

  it('packs validate without hard errors', () => {
    for (const p of JOURNEY_STARTER_PACKS) {
      const v = validateJourneyGraph(p.graph);
      expect(v.ok, `${p.id}: ${v.errors.join('; ')}`).toBe(true);
    }
  });
});
