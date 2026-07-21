import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectBoundRetirementAudit } from './it-mdm';

const migration = readFileSync(
  new URL('../../../supabase/phase38_intune_ambiguity_governance.sql', import.meta.url),
  'utf8',
);

describe('Intune ambiguity evidence contracts', () => {
  it('selects only exact-device successful retire events', () => {
    expect(
      selectBoundRetirementAudit(
        [
          {
            id: 'wrong-device',
            displayName: 'Retire managed device',
            activityDateTime: '2026-07-20T12:00:00Z',
            activityResult: 'success',
            resources: [{ resourceId: 'other-device' }],
          },
          {
            id: 'failed',
            displayName: 'Retire managed device',
            activityDateTime: '2026-07-20T12:01:00Z',
            activityResult: 'failure',
            resources: [{ resourceId: 'device-1' }],
          },
          {
            id: 'bound-success',
            displayName: 'Retire managed device',
            activityDateTime: '2026-07-20T12:02:00Z',
            activityResult: 'success',
            resources: [{ resourceId: 'device-1' }],
          },
        ],
        'device-1',
      ),
    ).toMatchObject({
      id: 'bound-success',
      resource_id: 'device-1',
      activity_result: 'success',
    });
  });

  it('bounds audit inspection to the requested 100 events', () => {
    const events = Array.from({ length: 101 }, (_, index) => ({
      id: `event-${index}`,
      displayName: index === 100 ? 'Retire managed device' : 'Read device',
      activityDateTime: '2026-07-20T12:00:00Z',
      activityResult: 'success',
      resources: [{ resourceId: 'device-1' }],
    }));
    expect(selectBoundRetirementAudit(events, 'device-1')).toBeNull();
  });

  it('keeps retry and evidence bindings in the rerunnable migration', () => {
    expect(migration).toContain("v_action.dispatch_authorized_at>now()-interval '24 hours'");
    expect(migration).toContain("v_http<>200");
    expect(migration).toContain("v_provider_serial<>v_asset_serial");
    expect(migration).toContain("v_provider_serial<>v_preflight_serial");
    expect(migration).toContain(
      "v_state not in ('managed','retirefailed','retirecanceled')",
    );
    expect(migration).toContain(
      'is distinct from v_resolution.evidence_semantic_sha256',
    );
    expect(migration).toContain("'dispatch_attempt_id',v_attempt.dispatch_attempt_id");
    expect(migration).toContain(
      "'provider_preflight_sha256',v_attempt.provider_preflight_sha256",
    );
    expect(migration).toContain(
      'A dispatched Intune tombstone blocks new root actions',
    );
  });

  it('keeps quarantine and service-role-only review contracts', () => {
    expect(migration).toContain(
      "where status in ('approved','preflighting','dispatch_authorized',",
    );
    expect(migration).not.toContain(
      "where status in ('approved','preflighting','dispatch_authorized',\n    'submitted','verifying','manual_review')",
    );
    expect(migration).toContain(
      'grant execute on function public.propose_it_intune_ambiguity_resolution',
    );
    expect(migration).toContain(
      'revoke insert,update,delete,truncate',
    );
    expect(migration).toContain('Intune ambiguity events are append-only');
  });
});
