import { describe, expect, it, beforeEach } from 'vitest';
import {
  suggestAccountForFeed,
  defaultCategorizationRules,
  applySuggestionsToFeeds,
  templateBankSpend,
  templateBankDeposit,
  makeJe,
  resetAfStore,
  ingestLiveFeedTxns,
  categorizeAndPostFeedTxn,
  excludeFeedTxn,
  confirmFeedAsBillPay,
  autoPostHighConfidenceFeeds,
  postManualJournal,
  postDraftJournal,
  getAfStore,
  runCategorizationRules,
} from '@/lib/af';

describe('CoA categorization rules', () => {
  it('suggests Technology for AWS spend', () => {
    const s = suggestAccountForFeed(
      {
        description: 'AWS.AMAZON.COM',
        amount: -42.5,
        entityCode: 'TVC',
      },
      defaultCategorizationRules(),
    );
    expect(s?.account).toBe('6500');
    expect(s!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('suggests Marketing for Google Ads', () => {
    const s = suggestAccountForFeed(
      {
        description: 'GOOGLE ADS CAMPAIGN',
        amount: -200,
        entityCode: 'R619',
      },
      defaultCategorizationRules(),
    );
    expect(s?.account).toBe('6100');
  });

  it('persists suggestedAccount on feed rows', () => {
    const { feedTxns, updated } = applySuggestionsToFeeds(
      [
        {
          id: 'T1',
          bankAccountId: 'BA-TVC-OP',
          entityCode: 'TVC',
          amount: -10,
          date: '2026-07-01',
          description: 'VERCEL INC',
          status: 'Unmatched',
        },
      ],
      defaultCategorizationRules(),
    );
    expect(updated).toBe(1);
    expect(feedTxns[0].suggestedAccount).toBe('6500');
  });
});

describe('bank spend / deposit JE templates', () => {
  it('posts balanced Dr Expense / Cr Cash', () => {
    const lines = templateBankSpend(50, '6500');
    const je = makeJe({
      id: 'JE-1',
      entityCode: 'TVC',
      date: '2026-07-01',
      sourceModule: 'BANK',
      sourceId: 'T1',
      memo: 'test',
      lines,
    });
    expect(je.status).toBe('posted');
    expect(lines.find((l) => l.account === '6500')?.debit).toBe(50);
    expect(lines.find((l) => l.account === '1000')?.credit).toBe(50);
  });

  it('posts balanced Dr Cash / Cr Revenue', () => {
    const lines = templateBankDeposit(100, '4900');
    expect(lines.find((l) => l.account === '1000')?.debit).toBe(100);
    expect(lines.find((l) => l.account === '4900')?.credit).toBe(100);
  });
});

describe('reconcile store ops', () => {
  beforeEach(() => {
    resetAfStore();
  });

  it('categorizes unmatched spend and posts BANK JE', () => {
    ingestLiveFeedTxns('BA-TVC-OP', 'TVC', [
      {
        id: 'PLAID-AWS-1',
        amount: -25,
        date: '2026-07-15',
        description: 'Amazon Web Services',
      },
    ]);
    runCategorizationRules();
    const store = getAfStore();
    const txn = store.feedTxns.find((t) => t.id === 'PLAID-AWS-1');
    expect(txn?.suggestedAccount).toBe('6500');

    const result = categorizeAndPostFeedTxn({
      feedTxnId: 'PLAID-AWS-1',
      account: '6500',
    });
    expect(result.txn.status).toBe('Matched');
    expect(result.journal.sourceModule).toBe('BANK');
    expect(result.journal.lines.some((l) => l.account === '6500')).toBe(true);
  });

  it('excludes a feed txn', () => {
    ingestLiveFeedTxns('BA-TVC-OP', 'TVC', [
      {
        id: 'PLAID-XFER-1',
        amount: -100,
        date: '2026-07-15',
        description: 'Transfer to savings',
      },
    ]);
    const txn = excludeFeedTxn('PLAID-XFER-1', 'Internal transfer');
    expect(txn.status).toBe('Excluded');
  });

  it('confirms PATH B bill pay from feed', () => {
    const s = getAfStore();
    s.bills.push({
      id: 'BILL-TEST-1',
      entityCode: 'TVC',
      vendorId: 'V1',
      vendorName: 'Acme Legal',
      number: 'AL-99',
      status: 'Approved',
      amount: 500,
      amountPaid: 0,
      dueDate: '2026-07-20',
      expenseAccount: '6400',
    });
    ingestLiveFeedTxns('BA-TVC-OP', 'TVC', [
      {
        id: 'PLAID-BILL-1',
        amount: -500,
        date: '2026-07-18',
        description: 'Acme Legal AL-99',
        ref: 'ACH-AL-99',
      },
    ]);
    const result = confirmFeedAsBillPay({
      feedTxnId: 'PLAID-BILL-1',
      billId: 'BILL-TEST-1',
    });
    expect(result.bill.status).toBe('Paid');
    expect(result.txn.status).toBe('Matched');
    expect(result.payment.feedMatched).toBe(true);
    expect(result.journal.lines.some((l) => l.account === '2000')).toBe(true);
  });

  it('auto-posts high confidence suggestions', () => {
    ingestLiveFeedTxns('BA-TVC-OP', 'TVC', [
      {
        id: 'PLAID-AUTO-1',
        amount: -12,
        date: '2026-07-15',
        description: 'GITHUB INC',
      },
    ]);
    const r = autoPostHighConfidenceFeeds(0.8);
    expect(r.posted).toBeGreaterThanOrEqual(1);
    expect(
      getAfStore().feedTxns.find((t) => t.id === 'PLAID-AUTO-1')?.status,
    ).toBe('Matched');
  });

  it('drafts and posts manual JE', () => {
    const draft = postManualJournal({
      entityCode: 'TVC',
      date: '2026-07-20',
      memo: 'Accrual test',
      status: 'draft',
      lines: [
        { account: '6900', debit: 40, credit: 0 },
        { account: '2000', debit: 0, credit: 40 },
      ],
    });
    expect(draft.status).toBe('draft');
    const posted = postDraftJournal(draft.id);
    expect(posted.status).toBe('posted');
  });
});
