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
import {
  extractVerifiedFirstOrderId,
  placeVerifiedFirstOrder,
  resolveVerifiedFirstCredentials,
  VERIFIED_FIRST_DEFAULT_API_BASE,
} from './vendor';
import {
  normalizeVerifiedFirstWebhookBody,
  resolveVerifiedFirstRawStatus,
} from './webhook-payload';

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

describe('Verified First Basic Auth credentials', () => {
  it('defaults API base to api1 external path', () => {
    assert.match(VERIFIED_FIRST_DEFAULT_API_BASE, /api1\.verifiedfirst\.com/);
    assert.match(VERIFIED_FIRST_DEFAULT_API_BASE, /external\/verified-first/);
  });

  it('resolves username+password env pair', () => {
    const prevUser = process.env.VERIFIED_FIRST_API_USERNAME;
    const prevPass = process.env.VERIFIED_FIRST_API_PASSWORD;
    const prevKey = process.env.VERIFIED_FIRST_API_KEY;
    try {
      delete process.env.VERIFIED_FIRST_API_KEY;
      process.env.VERIFIED_FIRST_API_USERNAME = 'vf-user';
      process.env.VERIFIED_FIRST_API_PASSWORD = 'vf-pass';
      assert.deepEqual(resolveVerifiedFirstCredentials(), {
        username: 'vf-user',
        password: 'vf-pass',
      });
    } finally {
      if (prevUser === undefined) delete process.env.VERIFIED_FIRST_API_USERNAME;
      else process.env.VERIFIED_FIRST_API_USERNAME = prevUser;
      if (prevPass === undefined) delete process.env.VERIFIED_FIRST_API_PASSWORD;
      else process.env.VERIFIED_FIRST_API_PASSWORD = prevPass;
      if (prevKey === undefined) delete process.env.VERIFIED_FIRST_API_KEY;
      else process.env.VERIFIED_FIRST_API_KEY = prevKey;
    }
  });

  it('resolves legacy API_KEY as username:password', () => {
    const prevUser = process.env.VERIFIED_FIRST_API_USERNAME;
    const prevPass = process.env.VERIFIED_FIRST_API_PASSWORD;
    const prevKey = process.env.VERIFIED_FIRST_API_KEY;
    try {
      delete process.env.VERIFIED_FIRST_API_USERNAME;
      delete process.env.VERIFIED_FIRST_API_PASSWORD;
      process.env.VERIFIED_FIRST_API_KEY = 'legacy-user:legacy-pass';
      assert.deepEqual(resolveVerifiedFirstCredentials(), {
        username: 'legacy-user',
        password: 'legacy-pass',
      });
    } finally {
      if (prevUser === undefined) delete process.env.VERIFIED_FIRST_API_USERNAME;
      else process.env.VERIFIED_FIRST_API_USERNAME = prevUser;
      if (prevPass === undefined) delete process.env.VERIFIED_FIRST_API_PASSWORD;
      else process.env.VERIFIED_FIRST_API_PASSWORD = prevPass;
      if (prevKey === undefined) delete process.env.VERIFIED_FIRST_API_KEY;
      else process.env.VERIFIED_FIRST_API_KEY = prevKey;
    }
  });

  it('extracts order_id from VF create envelope', () => {
    assert.equal(
      extractVerifiedFirstOrderId({
        type: 'background order',
        order: { order_id: '31990ab0-fbc0-11ee-824b-ab1e02a1dc5e' },
      }),
      '31990ab0-fbc0-11ee-824b-ab1e02a1dc5e',
    );
  });
});

describe('status mapping', () => {
  it('maps vendor clear/fail/review', () => {
    assert.equal(mapVendorStatusToSpine('Clear'), 'clear');
    assert.equal(mapVendorStatusToSpine('in_progress'), 'in_progress');
    assert.equal(mapVendorStatusToSpine('adverse'), 'failed');
    assert.equal(mapVendorStatusToSpine('needs_review'), 'review');
    assert.equal(mapVendorStatusToSpine('File Ordered'), 'ordered');
    assert.equal(mapVendorStatusToSpine('Complete'), 'clear');
    assert.equal(mapVendorStatusToSpine('Applicant Declined'), 'failed');
  });

  it('gate helpers', () => {
    assert.equal(screeningSatisfiesGate('clear'), true);
    assert.equal(screeningSatisfiesGate('waived'), true);
    assert.equal(screeningSatisfiesGate('pending'), false);
    assert.equal(spineStatusToBgScreen('clear'), 'clear');
    assert.equal(spineStatusToBgScreen('ordered'), 'pending');
  });
});

describe('webhook payload normalize', () => {
  it('accepts spine test shape', () => {
    const n = normalizeVerifiedFirstWebhookBody({
      spine_order_id: 'ord-1',
      status: 'clear',
    });
    assert.ok(!('error' in n));
    if (!('error' in n)) {
      assert.equal(n.orderId, 'ord-1');
      assert.equal(n.rawStatus, 'clear');
    }
  });

  it('accepts VF POST-back envelope + adjudication→review', () => {
    const n = normalizeVerifiedFirstWebhookBody({
      type: 'background status',
      status_update: {
        order_id: 'b06a10e0-vf',
        status: 'Complete',
        adjudication: 'In Need of Review',
        url: 'https://portal.verifiedfirst.com/#/report-results/x',
      },
    });
    assert.ok(!('error' in n));
    if (!('error' in n)) {
      assert.equal(n.externalOrderId, 'b06a10e0-vf');
      assert.equal(n.rawStatus, 'needs_review');
      assert.equal(
        n.reportStoragePath,
        'https://portal.verifiedfirst.com/#/report-results/x',
      );
      assert.equal(mapVendorStatusToSpine(n.rawStatus), 'review');
    }
  });

  it('resolveVerifiedFirstRawStatus keeps clear when adjudication empty', () => {
    assert.equal(resolveVerifiedFirstRawStatus('Complete', null), 'Complete');
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
