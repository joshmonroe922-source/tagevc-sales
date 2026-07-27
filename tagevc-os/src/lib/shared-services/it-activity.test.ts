import { describe, expect, it } from 'vitest';
import { isItOperationalActivity } from '@/lib/shared-services/it-activity';

describe('isItOperationalActivity', () => {
  it('accepts IT-prefixed shared services actions', () => {
    expect(
      isItOperationalActivity({
        module: 'shared_services',
        action: 'it_onboarding_completed',
      }),
    ).toBe(true);
    expect(
      isItOperationalActivity({
        module: 'shared_services',
        action: 'it_renewal_scan',
      }),
    ).toBe(true);
  });

  it('accepts Intune operational actions', () => {
    expect(
      isItOperationalActivity({
        module: 'shared_services',
        action: 'intune_retire',
      }),
    ).toBe(true);
  });

  it('rejects non-IT firm activity', () => {
    expect(
      isItOperationalActivity({
        module: 'shared_services',
        action: 'checklist_completed',
      }),
    ).toBe(false);
    expect(
      isItOperationalActivity({
        module: 'vc',
        action: 'stage_change',
      }),
    ).toBe(false);
    expect(
      isItOperationalActivity({
        module: 'system',
        action: 'live_look_start',
      }),
    ).toBe(false);
  });
});
