import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sparklineBars } from './trends';
import { formatEvidenceNote, evidenceFreshnessIso } from './evidence';
import { SSC_PHASE67_CONTRACT } from './cadence-runner';

describe('SSC Phase 67 cadence automation', () => {
  it('SQL is additive and never mentions retired snapshot table', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/phase67_ssc_cadence_automation.sql'),
      'utf8',
    );
    expect(sql).not.toContain('os_store_snapshots');
    expect(sql).toContain('os_ssc_cadence_runs');
    expect(sql).toContain('os_ssc_period_trends');
    expect(sql).toContain('os_ssc_completion_packages');
    expect(sql).toContain('os_ssc_ops_alerts');
  });

  it('vercel.json schedules cadence worker', () => {
    const raw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
    const json = JSON.parse(raw) as { crons: Array<{ path: string }> };
    const paths = json.crons.map((c) => c.path);
    expect(paths.some((p) => p.includes('/api/ssc/cadence-worker'))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes('kind=full'))).toBe(true);
    expect(paths.some((p) => p.includes('kind=escalate'))).toBe(true);
  });

  it('sparkline and evidence helpers work', () => {
    expect(sparklineBars([0, 50, 100])).toMatch(/[▁▂▃▄▅▆▇█]+/);
    const note = formatEvidenceNote([
      {
        source: 'tickets',
        note: '2 open tickets',
        freshness_at: '2026-07-24T12:00:00Z',
      },
    ]);
    expect(note).toContain('Auto-evidence');
    expect(note).toContain('Freshness');
    expect(
      evidenceFreshnessIso([
        { source: 'a', note: 'x', freshness_at: '2026-01-01T00:00:00Z' },
        { source: 'b', note: 'y', freshness_at: '2026-07-01T00:00:00Z' },
      ]),
    ).toBe('2026-07-01T00:00:00Z');
  });

  it('exports phase67 contract', () => {
    expect(SSC_PHASE67_CONTRACT).toContain('phase67');
  });
});
