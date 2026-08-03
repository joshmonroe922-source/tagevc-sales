import { describe, expect, it } from 'vitest';
import {
  preferredSendHour,
  stoFanout,
  computeRfm,
  draftAiAssist,
  attributionLite,
  nextBestStep,
  LIFT_EXPERIMENT_FRAMEWORK,
} from './intelligence';

describe('STO', () => {
  it('picks highest hour', () => {
    const hist = Array(24).fill(0);
    hist[9] = 1;
    hist[14] = 5;
    expect(preferredSendHour(hist).hour).toBe(14);
  });

  it('fans out buckets', () => {
    const m = stoFanout([
      { contactId: 'a', preferredHour: 10 },
      { contactId: 'b', preferredHour: null },
    ]);
    expect(m.get(10)?.length).toBe(2);
  });

  it('rfm segments', () => {
    expect(computeRfm({ daysSinceLastEngage: 2, engageCount30d: 6 }).segment).toBe('champions');
  });
});

describe('AI assist never auto-sends', () => {
  it('draft requires human approval', () => {
    const d = draftAiAssist({ subject: 'Hey!!!', body_html: '<p>Hello</p>', tone: 'direct' });
    expect(d.auto_send).toBe(false);
    expect(d.requires_human_approval).toBe(true);
  });
});

describe('attribution + next best', () => {
  it('click→call→sign', () => {
    const r = attributionLite([
      { type: 'click', at: '2026-01-01T10:00:00Z', contactId: 'c1' },
      { type: 'call', at: '2026-01-01T12:00:00Z', contactId: 'c1' },
      { type: 'sign', at: '2026-01-02T09:00:00Z', contactId: 'c1' },
    ]);
    expect(r.clickToSign).toBe(1);
  });

  it('hot contact suggests call', () => {
    expect(nextBestStep({ engagementScore: 5, clickedNoReply: true }).action).toBe('call');
  });

  it('lift framework documented', () => {
    expect(LIFT_EXPERIMENT_FRAMEWORK.arms).toContain('sto_preferred_hour');
  });
});
