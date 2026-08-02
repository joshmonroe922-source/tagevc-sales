import { describe, expect, it } from 'vitest';
import { resolveEntityFromInvoiceAddress } from '@/lib/af/ap/invoice-inbox';
import {
  buildW9RequestEmail,
  reviewW9DocumentYear,
} from '@/lib/af/ap/w9-campaign';
import {
  buildExpenseTimeline,
  buildCashFlowShell,
} from '@/lib/af/ap/expense-forecast';

describe('AP invoice inbox parse', () => {
  it('parses plus-tags', () => {
    expect(resolveEntityFromInvoiceAddress('ap+r619@tagevc.com')).toBe('R619');
    expect(resolveEntityFromInvoiceAddress('ap+signent@tagevc.com')).toBe(
      'SHR',
    );
  });
});

describe('W-9 campaign', () => {
  it('builds request email', () => {
    const mail = buildW9RequestEmail({
      vendorName: 'Acme',
      taxYear: 2026,
      entityLabel: 'R619',
      replyToInbox: 'ap+r619@tagevc.com',
    });
    expect(mail.subject).toContain('2026');
    expect(mail.body).toContain('Acme');
  });

  it('flags year mismatch', () => {
    const r = reviewW9DocumentYear({
      taxYear: 2026,
      fileName: 'w9-2024.pdf',
    });
    expect(r.status).toBe('ai_exception');
  });
});

describe('expense forecast shell', () => {
  it('projects months', () => {
    const series = buildExpenseTimeline({
      entityCode: 'TVC',
      openBillAmountsByMonth: { '2026-08': 500 },
      horizonMonths: 3,
      start: new Date(2026, 7, 1),
    });
    expect(series.points).toHaveLength(3);
    expect(series.points[0]?.amount).toBe(500);
    const cash = buildCashFlowShell({
      openingCash: 10000,
      expenseSeries: series,
    });
    expect(cash[0]?.cash).toBe(9500);
  });
});
