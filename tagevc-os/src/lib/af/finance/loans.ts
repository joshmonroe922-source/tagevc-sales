/**
 * Loan amortization + extra-payment simulator — Spec - Forecast & Loans / Blueprint §3.
 */

export type LoanInput = {
  id: string;
  entityCode: string;
  name: string;
  loanType: string;
  principal: number;
  annualRate: number;
  termMonths: number;
  startDate: string;
  extraPayment?: number;
  paymentFrequency?: 'monthly' | 'quarterly';
};

export type AmortRow = {
  period: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  extra: number;
  balance: number;
};

export type AmortSchedule = {
  loan: LoanInput;
  payment: number;
  schedule: AmortRow[];
  totalInterest: number;
  totalPaid: number;
  payoffDate: string;
  periods: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Standard amortization payment for rate + term. */
export function calcPayment(
  principal: number,
  annualRate: number,
  termMonths: number,
  frequency: 'monthly' | 'quarterly' = 'monthly',
): number {
  const periodsPerYear = frequency === 'quarterly' ? 4 : 12;
  const n = frequency === 'quarterly' ? Math.ceil(termMonths / 3) : termMonths;
  const r = annualRate / periodsPerYear;
  if (r === 0) return round2(principal / n);
  const pmt = (principal * r) / (1 - Math.pow(1 + r, -n));
  return round2(pmt);
}

export function buildAmortization(loan: LoanInput): AmortSchedule {
  const freq = loan.paymentFrequency ?? 'monthly';
  const step = freq === 'quarterly' ? 3 : 1;
  const periodsPerYear = freq === 'quarterly' ? 4 : 12;
  const r = loan.annualRate / periodsPerYear;
  const basePayment = calcPayment(
    loan.principal,
    loan.annualRate,
    loan.termMonths,
    freq,
  );
  const extra = Math.max(loan.extraPayment ?? 0, 0);

  let balance = loan.principal;
  const schedule: AmortRow[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let period = 0;
  const maxPeriods = freq === 'quarterly' ? 200 : 600;

  while (balance > 0.01 && period < maxPeriods) {
    period += 1;
    const interest = round2(balance * r);
    let principalPay = round2(basePayment - interest);
    let extraPay = extra;
    if (principalPay + extraPay > balance) {
      extraPay = Math.max(round2(balance - principalPay), 0);
      if (principalPay > balance) {
        principalPay = balance;
        extraPay = 0;
      }
    }
    const payment = round2(principalPay + interest + extraPay);
    balance = round2(Math.max(balance - principalPay - extraPay, 0));
    totalInterest = round2(totalInterest + interest);
    totalPaid = round2(totalPaid + payment);
    schedule.push({
      period,
      date: addMonths(loan.startDate, (period - 1) * step),
      payment,
      principal: principalPay,
      interest,
      extra: extraPay,
      balance,
    });
  }

  return {
    loan,
    payment: basePayment,
    schedule,
    totalInterest,
    totalPaid,
    payoffDate: schedule[schedule.length - 1]?.date ?? loan.startDate,
    periods: schedule.length,
  };
}

/** Compare base vs extra payment — interactive impact. */
export function compareExtraPayment(
  loan: LoanInput,
  extraPayment: number,
): {
  base: AmortSchedule;
  withExtra: AmortSchedule;
  interestSaved: number;
  monthsSaved: number;
  newPayoffDate: string;
} {
  const base = buildAmortization({ ...loan, extraPayment: 0 });
  const withExtra = buildAmortization({ ...loan, extraPayment });
  return {
    base,
    withExtra,
    interestSaved: round2(base.totalInterest - withExtra.totalInterest),
    monthsSaved: base.periods - withExtra.periods,
    newPayoffDate: withExtra.payoffDate,
  };
}

export const SEED_LOANS: LoanInput[] = [
  {
    id: 'LOAN-TVC-01',
    entityCode: 'TVC',
    name: 'Acquisition facility',
    loanType: 'Term',
    principal: 500000,
    annualRate: 0.0725,
    termMonths: 60,
    startDate: '2025-01-01',
  },
  {
    id: 'LOAN-R619-01',
    entityCode: 'R619',
    name: 'Working capital LOC',
    loanType: 'Line of Credit',
    principal: 75000,
    annualRate: 0.095,
    termMonths: 36,
    startDate: '2025-06-01',
    extraPayment: 500,
  },
  {
    id: 'LOAN-INDA-01',
    entityCode: 'INDA',
    name: 'Software capitalization note',
    loanType: 'Related-Party',
    principal: 14000,
    annualRate: 0.05,
    termMonths: 24,
    startDate: '2026-01-01',
  },
];
