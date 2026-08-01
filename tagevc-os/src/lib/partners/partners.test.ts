import { describe, expect, it } from 'vitest';

import {
  PARTNER_CATALOG,
  defaultEnabledForEntity,
  marketingPresencePartners,
} from '@/lib/partners/catalog';
import { calculateCommissionCents } from '@/lib/partners/commissions';
import { runPartnerLifecycleHook } from '@/lib/partners/adapters';
import { mergePartnerLifecycleItems } from '@/lib/partners/lifecycle-hooks';
import { buildPartnerSpineProvisionPlan } from '@/lib/partners/provision';
import { partnerAdminHref } from '@/lib/partners/registry';

describe('partner spine catalog', () => {
  it('includes marketing presence partners for all entities', () => {
    const keys = PARTNER_CATALOG.map((p) => p.key);
    expect(keys).toContain('google_business');
    expect(keys).toContain('google_analytics');
    expect(keys).toContain('linkedin_company');
    expect(keys).toContain('dialpad');
    expect(keys).toContain('mybasepay');
    expect(keys).toContain('appcast');
  });

  it('routes marketing presence to Marketing SS UI', () => {
    for (const p of marketingPresencePartners()) {
      expect(partnerAdminHref(p)).toBe('/shared-services/marketing/presence');
      expect(p.ownerSs).toBe('Marketing');
    }
  });

  it('enables MyBasePay for Recruit 619 only by default', () => {
    expect(defaultEnabledForEntity('mybasepay', 'ENT-R619')).toBe(true);
    expect(defaultEnabledForEntity('mybasepay', 'ENT-FIRM')).toBe(false);
  });

  it('provisions marketing presence slots per entity', () => {
    const plan = buildPartnerSpineProvisionPlan('ENT-SIGNENT', 'Signent HR');
    expect(plan.marketing_presence).toHaveLength(3);
    expect(plan.marketing_presence.map((p) => p.kind).sort()).toEqual([
      'google_analytics',
      'google_business',
      'linkedin_company',
    ]);
    expect(plan.enablements.length).toBe(PARTNER_CATALOG.length);
  });

  it('merges partner hooks into joiner checklist', () => {
    const merged = mergePartnerLifecycleItems(
      [{ id: 'profile_create', label: 'Create', status: 'pending' }],
      'joiner',
      'ENT-FIRM',
    );
    expect(merged.some((i) => i.id.includes('marketing_presence'))).toBe(true);
    expect(merged.some((i) => i.id.includes('gusto'))).toBe(true);
  });

  it('calculates commission bps', () => {
    expect(
      calculateCommissionCents({ invoiceAmountCents: 100_000, rateBps: 1000 }),
    ).toBe(10_000);
  });

  it('runs lifecycle adapter hooks as dry-run stubs', async () => {
    const dialpad = await runPartnerLifecycleHook('dialpad_user_stub_if_phone', {
      entityId: 'ENT-FIRM',
      email: 'ops@tagevc.com',
    });
    expect(dialpad.ok).toBe(true);
    if (dialpad.ok) expect(dialpad.dryRun).toBe(true);

    const revoke = await runPartnerLifecycleHook('partner_dialpad_revoke_stub', {
      entityId: 'ENT-FIRM',
    });
    expect(revoke.ok).toBe(true);
  });
});
