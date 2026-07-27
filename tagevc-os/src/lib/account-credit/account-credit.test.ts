import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  riskBandFromBureauBag,
  suggestTermsFromRisk,
  ACCOUNT_CREDIT_THRESHOLDS,
} from './rules';
import {
  canRunAccountCreditCheck,
  DEFAULT_PAYMENT_TERMS_POSTURE,
  DUR_POLICY_COPY,
  isIndaAccountCreditCheckEnabled,
} from './types';
import { isAccountCreditApiEnabled } from './api-stubs';

describe('account credit rules', () => {
  it('maps strong PAYDEX to low risk and net_30 ceiling', () => {
    const { risk_band, thin_file } = riskBandFromBureauBag({
      paydex: ACCOUNT_CREDIT_THRESHOLDS.paydexLowMin,
    });
    assert.equal(risk_band, 'low');
    assert.equal(thin_file, false);
    const terms = suggestTermsFromRisk(risk_band);
    assert.equal(terms.starting_posture, DEFAULT_PAYMENT_TERMS_POSTURE);
    assert.equal(terms.suggested_terms, 'net_30');
  });

  it('maps thin / unknown to DUR or prepaid', () => {
    const { risk_band, thin_file } = riskBandFromBureauBag({});
    assert.equal(risk_band, 'unknown');
    assert.equal(thin_file, true);
    const terms = suggestTermsFromRisk(risk_band, { thinFile: true });
    assert.equal(terms.suggested_terms, 'due_upon_receipt');
  });

  it('flags bankruptcy as high', () => {
    const { risk_band } = riskBandFromBureauBag({
      paydex: 80,
      risk_flags: ['bankruptcy_mentioned'],
    });
    assert.equal(risk_band, 'high');
    assert.equal(suggestTermsFromRisk(risk_band).suggested_terms, 'prepaid');
  });
});

describe('account credit permissions + flags', () => {
  it('allows manager+ roles and denies associate', () => {
    assert.equal(canRunAccountCreditCheck('sub_lead'), true);
    assert.equal(canRunAccountCreditCheck('visionary'), true);
    assert.equal(canRunAccountCreditCheck('associate'), false);
    assert.equal(canRunAccountCreditCheck('re_sourcer'), false);
  });

  it('keeps INDA feature flag fail-closed', () => {
    assert.equal(isIndaAccountCreditCheckEnabled(), false);
  });

  it('keeps bureau API stubs fail-closed', () => {
    assert.equal(isAccountCreditApiEnabled('dnb_api'), false);
  });

  it('DUR policy copy is present', () => {
    assert.match(DUR_POLICY_COPY, /Due Upon Receipt/);
  });
});

describe('phase78 sql safety', () => {
  it('is additive and does not drop os_store_snapshots', () => {
    const body = readFileSync(
      join(process.cwd(), 'supabase/phase78_account_credit_checks.sql'),
      'utf8',
    );
    assert.doesNotMatch(body, /drop\s+table\s+.*os_store_snapshots/i);
    assert.match(body, /os_account_credit_checks/);
    assert.match(body, /can_run_account_credit_check/);
    assert.match(body, /instantnda_customer/);
    assert.match(body, /signent_client/);
  });
});
