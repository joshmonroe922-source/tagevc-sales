import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Tage OS first-paint speed', () => {
  it('caches session and avoids select * on profiles', () => {
    const src = read('src/lib/rbac/session.ts');
    assert.match(src, /from 'react'/);
    assert.match(src, /export const getSessionContext = cache\(/);
    assert.match(src, /export const getRealProfile = cache\(/);
    assert.match(src, /PROFILE_SESSION_COLUMNS/);
    assert.match(src, /\.select\(PROFILE_SESSION_COLUMNS\)/);
    assert.doesNotMatch(src, /\.select\('\*'\)/);
  });

  it('does not block the app shell on domain-store hydrate or chrome counts', () => {
    const src = read('src/app/(app)/layout.tsx');
    assert.match(src, /from 'next\/server'/);
    assert.match(src, /after\(/);
    assert.match(src, /bootstrapDomainStores/);
    assert.match(src, /AppChromeTopBar/);
    assert.match(src, /<Suspense/);
    assert.doesNotMatch(src, /await bootstrapDomainStores\(\)/);
    const page = src.slice(src.indexOf('export default async function AppShellLayout'));
    assert.doesNotMatch(page, /countMyUnreadNotifications\(\)/);
    assert.doesNotMatch(page, /countPendingSuggestions\(\)/);
  });

  it('Home paints the welcome shell before Grok briefing', () => {
    const src = read('src/app/(app)/home/page.tsx');
    assert.match(src, /<ThinkTankClient/);
    assert.match(src, /<Suspense fallback=\{<HomeBriefingSkeleton/);
    assert.match(src, /<HomeBriefingDeferred/);
    const page = src.slice(src.indexOf('export default async function HomePage'));
    assert.doesNotMatch(page, /generateHomeBriefing/);
  });

  it('Home briefing uses LLM timeout and short cache (R619 pattern)', () => {
    const src = read('src/lib/home/briefing.ts');
    assert.match(src, /BRIEFING_LLM_MS/);
    assert.match(src, /BRIEFING_CACHE_TTL_MS/);
    assert.match(src, /briefingCache/);
    assert.match(src, /withTimeout/);
  });

  it('content frame stays full-width for all non-bleed pages', () => {
    const frame = read('src/components/layout/app-content-frame.tsx');
    assert.match(frame, /w-full max-w-none/);
    assert.doesNotMatch(frame, /mx-auto max-w-6xl/);
  });

  it('Think Tank context skips a forced ticket SQL rehydrate', () => {
    const src = read('src/lib/think-tank/context.ts');
    assert.match(src, /listScopedTickets\(\{ forceSql: false \}\)/);
    assert.match(src, /Promise\.all\(/);
  });

  it('hub pages stream workspace after the header', () => {
    const dashboard = read('src/app/(app)/dashboard/page.tsx');
    assert.match(dashboard, /<Suspense fallback=\{<PageSkeleton/);
    assert.match(dashboard, /<DashboardWorkspace/);
    const dashPage = dashboard.slice(
      dashboard.indexOf('export default async function DashboardPage'),
    );
    assert.doesNotMatch(dashPage, /listActivePortfolioCompanies/);
    assert.doesNotMatch(dashPage, /getIesFinanceReport/);

    const command = read('src/app/(app)/command-center/page.tsx');
    assert.match(command, /<CommandCenterWorkspace/);
    const cmdPage = command.slice(
      command.indexOf('export default async function CommandCenterPage'),
    );
    assert.doesNotMatch(cmdPage, /getCommandCenterSnapshot/);

    const firm = read('src/app/(app)/firm/page.tsx');
    assert.match(firm, /<FirmSnapshot/);
    const firmPage = firm.slice(firm.indexOf('export default async function FirmPage'));
    assert.doesNotMatch(firmPage, /getFirmHomeSnapshot/);

    const dealFlow = read('src/app/(app)/deal-flow/page.tsx');
    assert.match(dealFlow, /<DealFlowTracks/);
    assert.doesNotMatch(
      dealFlow.slice(dealFlow.indexOf('export default function DealFlowHubPage')),
      /listScopedActiveLeads/,
    );
  });
});
