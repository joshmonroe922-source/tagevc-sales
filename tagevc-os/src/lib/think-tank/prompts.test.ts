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

describe('home nav (tage)', () => {
  it('puts Home first; SSC Task List under Shared Services; Help Desk / Think Tank off left nav', () => {
    const flat = flattenNavItems(MAIN_NAV);
    expect(flat[0]?.href).toBe('/home');
    expect(flat.some((n) => n.href === '/dashboard')).toBe(true);
    expect(flat.some((n) => n.href === '/to-do' && n.label === 'SSC Task List')).toBe(
      true,
    );
    expect(flat.some((n) => n.href === '/help-desk')).toBe(false);
    // Messaging is the sidebar brand-header control, not a left-nav item.
    expect(flat.some((n) => n.href === '/messages')).toBe(false);
    expect(flat.some((n) => n.href === '/think-tank')).toBe(false);
  });
});
