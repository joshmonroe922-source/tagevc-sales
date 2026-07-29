/** Tage VC A&F — domain types (SSOT-aligned). */

export type EntityCode = 'TVC' | 'R619' | 'SHR' | 'INDA';
export type BooksId = EntityCode | 'PERS' | 'CONSOL';

export type HealthStatus = 'On Track' | 'Watch' | 'At Risk' | 'Critical';

export type AfEntity = {
  code: EntityCode;
  legalName: string;
  type: string;
  industry: string;
  ownershipPct: number;
  consolidationMethod: string;
  currency: string;
  fiscalYearEnd: string;
  banks: string;
  status: string;
  notes: string;
};

export type BankAccount = {
  id: string;
  entityCode: EntityCode;
  name: string;
  type: string;
  glAccount: string;
  purpose: string;
  feedEnabled: boolean;
  institution: string;
};

export type CoaAccount = {
  number: string;
  name: string;
  type: string;
  category: string;
  notes: string;
  common: string;
};

export type InvoiceAttachmentDefault = {
  id: string;
  entityCode: EntityCode;
  documentType: string;
  displayName: string;
  fileRef: string;
  requiredOnSend: boolean;
  sortOrder: number;
  status: string;
  notes: string;
};

export type FamilyMember = {
  id: string;
  name: string;
  type: string;
  classCode: string;
  visibility: string;
  active: boolean;
  sort: number;
  notes: string;
};

export type WaterfallBucketCode =
  | 'DIR'
  | 'SALES'
  | 'MKT'
  | 'GA'
  | 'TECH'
  | 'COMM'
  | 'MGMT'
  | 'SS'
  | 'CONT'
  | 'PROFIT';

export type AllocationBucket = {
  bucket: WaterfallBucketCode;
  name: string;
  pct: number | null;
  dept: string;
  glHint: string;
  dynamic?: boolean;
  plug?: boolean;
};

export type JeLine = {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
  dimension?: string;
};

export type JournalEntry = {
  id: string;
  entityCode: BooksId;
  date: string;
  period: string;
  sourceModule: string;
  sourceId: string;
  memo: string;
  lines: JeLine[];
  status: 'posted' | 'reversed' | 'draft';
};

export type InvoiceStatus =
  | 'Draft'
  | 'Sent'
  | 'Partially Paid'
  | 'Paid'
  | 'Void'
  | 'Overdue';

export type AfInvoice = {
  id: string;
  entityCode: EntityCode;
  customerId: string;
  customerName: string;
  number: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  amount: number;
  amountPaid: number;
  sku: string;
  revenueAccount: string;
  commissionAmount: number;
  extraAttachmentIds: string[];
};

export type BillStatus =
  | 'Submitted'
  | 'In Approval'
  | 'Approved'
  | 'Scheduled'
  | 'Paid'
  | 'Partial'
  | 'Rejected';

export type AfBill = {
  id: string;
  entityCode: EntityCode;
  vendorId: string;
  vendorName: string;
  number: string;
  status: BillStatus;
  amount: number;
  amountPaid: number;
  dueDate: string;
  expenseAccount: string;
};

export type PaymentRecord = {
  id: string;
  entityCode: EntityCode;
  billIds: string[];
  amount: number;
  bankAccountId: string;
  paymentRef: string;
  paidAt: string;
  glPosted: boolean;
  feedMatched: boolean;
};

export type BankFeedTxn = {
  id: string;
  bankAccountId: string;
  entityCode: EntityCode;
  amount: number;
  date: string;
  description: string;
  ref?: string;
  status: 'Unmatched' | 'Matched' | 'Excluded';
  matchedPaymentId?: string;
};

export type AllocationLedgerRow = {
  id: string;
  entityCode: EntityCode;
  invoiceId: string;
  paidAt: string;
  bucket: WaterfallBucketCode;
  dept: string;
  amount: number;
  profileVersion: string;
  scenarioId: string | null;
};

export type SetupStepStatus =
  | 'Not started'
  | 'In progress'
  | 'Blocked'
  | 'Done'
  | 'Skipped';

export type SetupChecklistItem = {
  orgId: string;
  entityCode: EntityCode | 'ORG';
  stepId: string;
  status: SetupStepStatus;
  completedAt?: string;
  completedBy?: string;
  evidenceUrl?: string;
};

export type GlBalanceMap = Record<string, number>;
