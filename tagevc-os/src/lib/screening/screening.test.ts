import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canManageScreening,
  isVerifiedFirstLive,
  mapVendorStatusToSpine,
  screeningSatisfiesGate,
  spineStatusToBgScreen,
} from './types';
import { placeVerifiedFirstOrder } from './vendor';

describe('screening permissions + LIVE fail-closed', () => {
  it('allows manager+ and denies associate', () => {
    assert.equal(canManageScreening('sub_lead'), true);
    assert.equal(canManageScreening('visionary'), true);
    assert.equal(canManageScreening('associate'), false);
  });

  it('VERIFIED_FIRST_LIVE defaults fail-closed', () => {
    assert.equal(isVerifiedFirstLive(), false);
  });

  it('placeVerifiedFirstOrder requires human confirm', async () => {
    const res = await placeVerifiedFirstOrder({
      packageCode: 'vf-basic-bg',
      subject: { fullName: 'Test Subject' },
      consumerRef: {},
      idempotencyKey: 'test-1',
      humanConfirmed: false,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, 'confirm_required');
  });

  it('placeVerifiedFirstOrder blocks when LIVE=0', async () => {
    const res = await placeVerifiedFirstOrder({
      packageCode: 'vf-basic-bg',
      subject: { fullName: 'Test Subject' },
      consumerRef: {},
      idempotencyKey: 'test-2',
      humanConfirmed: true,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, 'live_disabled');
  });
});

describe('status mapping', () => {
  it('maps vendor clear/fail/review', () => {
    assert.equal(mapVendorStatusToSpine('Clear'), 'clear');
    assert.equal(mapVendorStatusToSpine('in_progress'), 'in_progress');
    assert.equal(mapVendorStatusToSpine('adverse'), 'failed');
    assert.equal(mapVendorStatusToSpine('needs_review'), 'review');
  });

  it('gate helpers', () => {
    assert.equal(screeningSatisfiesGate('clear'), true);
    assert.equal(screeningSatisfiesGate('waived'), true);
    assert.equal(screeningSatisfiesGate('pending'), false);
    assert.equal(spineStatusToBgScreen('clear'), 'clear');
    assert.equal(spineStatusToBgScreen('ordered'), 'pending');
  });
});

describe('phase80 sql safety', () => {
  it('is additive and does not drop os_store_snapshots', () => {
    const body = readFileSync(
      join(process.cwd(), 'supabase/phase80_verified_first_screening.sql'),
      'utf8',
    );
    assert.doesNotMatch(body, /drop\s+table\s+.*os_store_snapshots/i);
    assert.match(body, /os_screening_packages/);
    assert.match(body, /os_screening_orders/);
    assert.match(body, /signent_client_employee/);
    assert.match(body, /can_manage_screening/);
    assert.match(body, /verified_first/);
  });
});
