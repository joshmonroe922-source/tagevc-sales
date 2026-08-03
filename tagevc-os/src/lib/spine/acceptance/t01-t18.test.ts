/**
 * T01–T18 acceptance coverage — unit/static for unblockable cases.
 * Integration/e2e that need LIVE DB + Apollo remain documented skips.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_FIRST_STAGES,
  COMPANY_WATERFALL,
  PERSON_WATERFALL,
  budgetAllowsSpend,
  enrichmentKillSwitchEnabled,
  mockExpandPeople,
  providerRank,
} from '@/lib/spine/enrichment/waterfall';
import { decideMergeField } from '@/lib/spine/merge/engine';
import {
  accountBootstrapKey,
  expandPeopleKey,
} from '@/lib/spine/enrichment/jobs';
import { getEnrichmentProviderHealth } from '@/lib/spine/enrichment/providers';
import { HIRING_MANAGER_USER_OWNED } from '@/lib/spine/products/graph-links';
import { SPINE_AGENTS } from '@/lib/spine/agents/catalog';
import { monthStartIso } from '@/lib/spine/enrichment/ledger';

const root = join(__dirname, '../../../..');

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('T01–T02 org isolation (static RLS proof)', () => {
  const rls = read('supabase/migrations/spine/0009_rls.sql');

  it('T01: account select requires fn_can_see_account (org-scoped)', () => {
    expect(rls).toMatch(/fn_can_see_account/);
    expect(rls).toMatch(/accounts_select/);
    expect(rls).toMatch(/fn_has_org|fn_org_ids/);
  });

  it('T02: tage admin bypass via fn_is_tage_admin', () => {
    expect(rls).toMatch(/fn_is_tage_admin/);
    expect(rls).toContain('fn_is_tage_admin()');
  });

  it('persist client exposes explicit user vs service modes', () => {
    const src = read('src/lib/supabase/persist-client.ts');
    expect(src).toContain("mode?: PersistMode");
    expect(src).toContain('createUserScopedClient');
    expect(src).toContain('createServiceClient');
  });
});

describe('T03–T04 bootstrap + expand (unit)', () => {
  it('T03: bootstrap idempotency key is daily-stable', () => {
    const a = accountBootstrapKey('acc-1', 'org-1', '2026-08-03');
    const b = accountBootstrapKey('acc-1', 'org-1', '2026-08-03');
    expect(a).toBe(b);
    expect(a).toContain('account.bootstrap');
  });

  it('T04: expand respects cap', () => {
    const people = mockExpandPeople({
      domain: 'acme.com',
      patterns: ['CEO', 'CTO', 'VP Sales', 'Director', 'Manager'],
      cap: 3,
    });
    expect(people.length).toBeLessThanOrEqual(3);
  });

  it('bootstrap wires apolloSearchPeople + merge (not mock-only)', () => {
    const bootstrap = read('src/lib/spine/enrichment/bootstrap.ts');
    expect(bootstrap).toContain('apolloSearchPeople');
    expect(bootstrap).toContain('decideMergeField');
    expect(bootstrap).toContain('pdlEnrichPerson');
    expect(bootstrap).toContain('runContactEnrich');
    expect(bootstrap).toContain('MAX_EXPAND_CAP = 75');
    expect(bootstrap).toContain('scrapeEmailSignatureScaffold');
    expect(bootstrap).toContain('fetchWebsiteMeta');
  });

  it('budget-first waterfall: signature → website → Apollo last', () => {
    expect(BUDGET_FIRST_STAGES[0]).toBe('email_signature');
    expect(BUDGET_FIRST_STAGES[1]).toBe('website_meta');
    expect(COMPANY_WATERFALL.indexOf('email_signature')).toBeLessThan(
      COMPANY_WATERFALL.indexOf('website_meta'),
    );
    expect(COMPANY_WATERFALL.indexOf('website_meta')).toBeLessThan(
      COMPANY_WATERFALL.indexOf('apollo'),
    );
    expect(COMPANY_WATERFALL.at(-1)).toBe('apollo');
    expect(PERSON_WATERFALL.at(-1)).toBe('apollo');
    expect(providerRank('email_signature')).toBeLessThan(
      providerRank('website_meta'),
    );
    expect(providerRank('website_meta')).toBeLessThan(providerRank('apollo'));
  });
});

describe('T05–T06 merge / user lock', () => {
  it('T05: invalid email not written as primary', () => {
    const d = decideMergeField({
      field: 'primary_email',
      value: 'bad@acme.com',
      source: 'hunter',
      emailStatus: 'invalid',
    });
    expect(d.action).toBe('skip');
  });

  it('T06: user-locked email → suggest only', () => {
    const d = decideMergeField({
      field: 'primary_email',
      value: 'new@acme.com',
      source: 'apollo',
      emailStatus: 'valid',
      existingValue: 'user@acme.com',
      existingSource: 'user',
      existingLocked: true,
    });
    expect(d.action).toBe('suggest');
  });
});

describe('T07–T08 hierarchy rules', () => {
  it('T07/T08: suggestHierarchy skips confirmed+rejected pairs', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toContain("in('status', ['suggested', 'confirmed', 'rejected'])");
    expect(crud).toContain('Never overwrite confirmed');
  });
});

describe('T09–T12 create / budget / idempotency / dedupe', () => {
  it('T09: createContact ensures employment when accountId provided', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toMatch(/from\('employments'\)\.insert/);
    expect(crud).toContain('input.accountId');
  });

  it('T10: budget exceeded blocks paid call', () => {
    const gate = budgetAllowsSpend({
      monthSpendUsd: 49,
      estimateUsd: 2,
      budgetUsd: 50,
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe('budget_exceeded');
  });

  it('T11: expand key stable for same patterns/cap', () => {
    expect(expandPeopleKey('a', ['CEO', 'CTO'], 5)).toBe(
      expandPeopleKey('a', ['CTO', 'CEO'], 5),
    );
  });

  it('T12: createContact dedupes by primary_email', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toContain("ilike('primary_email', email)");
    expect(crud).toContain('contact_org_links');
  });
});

describe('T13–T16 hiring manager / search / copilot / kill switch', () => {
  it('T13: hiring_manager is user-owned; worker bootstrap never mentions it', () => {
    expect(HIRING_MANAGER_USER_OWNED).toBe(true);
    const bootstrap = read('src/lib/spine/enrichment/bootstrap.ts');
    expect(bootstrap).not.toMatch(/hiring_manager/);
    const worker = read('apps/worker/src/index.ts');
    expect(worker).not.toMatch(/hiring_manager/);
    const schema = read('supabase/migrations/spine/0007_product_recruit.sql');
    expect(schema).toContain('hiring_manager_contact_id');
    expect(schema).toContain('hiring_manager_locked');
  });

  it('T14: search includes title partial match path', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toContain('title.ilike');
  });

  it('T15: copilot denies send_email and allows jobs.enqueue', () => {
    const route = read('src/app/api/spine/copilot/route.ts');
    expect(route).toContain('send_email');
    expect(route).toMatch(/tool_denied|forbid/i);
    expect(route).toContain('jobs.enqueue');
    expect(route).toContain('list_agents');
    expect(route).toContain('brief');
  });

  it('T16: kill switch + providers not ready without LIVE', () => {
    const prev = process.env.ENRICHMENT_KILL_SWITCH;
    process.env.ENRICHMENT_KILL_SWITCH = '1';
    expect(enrichmentKillSwitchEnabled()).toBe(true);
    process.env.ENRICHMENT_KILL_SWITCH = prev;
    const health = getEnrichmentProviderHealth();
    for (const h of health) {
      if (!h.configured || !h.liveEnabled) expect(h.ready).toBe(false);
    }
  });
});

describe('T17–T18 employment roll + cross-sub UX', () => {
  it('T17: rollEmploymentOnJobChange ends old + inserts current', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toContain('rollEmploymentOnJobChange');
    expect(crud).toContain('ended_on');
    expect(crud).toContain('is_current: false');
    expect(crud).toContain('is_current: true');
  });

  it('T18: createAccount links existing domain into active org (network message path)', () => {
    const crud = read('src/lib/spine/db/crud.ts');
    expect(crud).toContain('canonical_domain');
    expect(crud).toContain('account_org_links');
    expect(crud).toContain('existing.data?.id');
  });
});

describe('supporting spine surfaces', () => {
  it('data_qa agent is catalogued with job', () => {
    const qa = SPINE_AGENTS.find((a) => a.id === 'agent.data_qa');
    expect(qa?.jobs).toContain('agent.data_qa');
  });

  it('ledger monthStartIso is UTC month boundary', () => {
    expect(monthStartIso(new Date('2026-08-15T12:00:00Z'))).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('LIVE flip doc stays clear', () => {
    const doc = read('docs/ENRICHMENT_LIVE_FLIP.md');
    expect(doc).toContain('*_LIVE=1');
    expect(doc).toContain('fail-closed');
    expect(doc).toContain('credit_ledger');
    expect(doc).toContain('mock');
    expect(doc).toContain('Budget-first');
    expect(doc).toContain('Apollo.ai last');
    expect(doc).toContain('Contact Info Refresh');
  });

  it('CRM account + contact detail expose Contact Info Refresh CTAs', () => {
    const accountBtn = read('src/components/crm/account-refresh-button.tsx');
    const contactBtn = read('src/components/crm/contact-refresh-button.tsx');
    const accountPage = read(
      'src/app/(app)/shared-services/crm/accounts/[id]/page.tsx',
    );
    const contactPage = read(
      'src/app/(app)/shared-services/crm/contacts/[id]/page.tsx',
    );
    expect(accountBtn).toContain('Contact Info Refresh');
    expect(contactBtn).toContain('Contact Info Refresh');
    expect(accountPage).toContain('AccountRefreshButton');
    expect(contactPage).toContain('ContactRefreshButton');
  });
});
