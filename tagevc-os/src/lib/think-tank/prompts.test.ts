import { describe, expect, it } from 'vitest';

import {
  buildTageThinkTankSystemPrompt,
  thinkTankRoleBand,
} from '@/lib/think-tank/prompts';
import { flattenNavItems, MAIN_NAV } from '@/lib/nav';

describe('think-tank prompts (tage)', () => {
  it('maps visionary/partner to leadership', () => {
    expect(thinkTankRoleBand('visionary')).toBe('leadership');
    expect(thinkTankRoleBand('partner')).toBe('leadership');
  });

  it('builds firm advisor prompt', () => {
    const prompt = buildTageThinkTankSystemPrompt({
      roleBand: 'operator',
      userName: 'Jordan',
      entityId: 'ENT-FIRM',
      contextJson: '{"openTickets":3}',
    });
    expect(prompt).toMatch(/Tage Venture Capital/);
    expect(prompt).toMatch(/decision-maker/);
    expect(prompt).toMatch(/openTickets/);
  });
});

describe('think-tank nav (tage)', () => {
  it('exposes Think Tank in main nav', () => {
    expect(flattenNavItems(MAIN_NAV).some((n) => n.href === '/think-tank')).toBe(
      true,
    );
  });
});
