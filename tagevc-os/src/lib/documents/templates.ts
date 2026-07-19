import type { DocTemplate, Entity } from '@/lib/types';
import type { Deal } from '@/lib/types';

export type MergeContext = {
  entity?: Entity | null;
  deal?: Deal | null;
  party?: { signatory_name?: string; signatory_email?: string };
  effective_date?: string;
  address?: string;
  property?: string;
};

/** Excel §3 merge tokens. */
export const MERGE_TOKENS = [
  '{{entity.canonical_name}}',
  '{{entity.legal_name}}',
  '{{deal.check_size}}',
  '{{deal.pre_money}}',
  '{{deal.instrument}}',
  '{{party.signatory_name}}',
  '{{party.signatory_email}}',
  '{{firm.legal_name}}',
  '{{effective_date}}',
  '{{address}}',
  '{{property}}',
] as const;

export function buildMergeValues(ctx: MergeContext): Record<string, string> {
  return {
    '{{entity.canonical_name}}': ctx.entity?.canonical_name ?? '',
    '{{entity.legal_name}}': ctx.entity?.legal_name ?? '',
    '{{deal.check_size}}':
      ctx.deal?.check_k != null ? String(ctx.deal.check_k) : '',
    '{{deal.pre_money}}':
      ctx.deal?.premoney_m != null ? String(ctx.deal.premoney_m) : '',
    '{{deal.instrument}}': ctx.deal?.instrument ?? '',
    '{{party.signatory_name}}': ctx.party?.signatory_name ?? '',
    '{{party.signatory_email}}': ctx.party?.signatory_email ?? '',
    '{{firm.legal_name}}': 'Tage Venture Capital LLC',
    '{{effective_date}}':
      ctx.effective_date ?? new Date().toISOString().slice(0, 10),
    '{{address}}': ctx.address ?? '',
    '{{property}}': ctx.property ?? '',
  };
}

export function applyMerge(
  templateBody: string,
  values: Record<string, string>,
): string {
  let out = templateBody;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value || `⟦${token}⟧`);
  }
  return out;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    template_id: 'TPL-NDA',
    name: 'Mutual NDA',
    doc_type: 'NDA',
    folder_hint: '02_Deal',
    requires_human_send: false,
    merge_tokens: [
      '{{entity.canonical_name}}',
      '{{firm.legal_name}}',
      '{{party.signatory_name}}',
      '{{party.signatory_email}}',
      '{{effective_date}}',
    ],
    body: `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is entered into as of {{effective_date}} by and between {{firm.legal_name}} ("Tage") and {{entity.canonical_name}} ("Company"), signed by {{party.signatory_name}} ({{party.signatory_email}}).

The parties agree to keep confidential information confidential...`,
  },
  {
    template_id: 'TPL-TS',
    name: 'Term Sheet',
    doc_type: 'Term Sheet',
    folder_hint: '02_Deal',
    requires_human_send: true,
    merge_tokens: [
      '{{entity.canonical_name}}',
      '{{entity.legal_name}}',
      '{{deal.check_size}}',
      '{{deal.pre_money}}',
      '{{deal.instrument}}',
      '{{firm.legal_name}}',
      '{{effective_date}}',
    ],
    body: `TERM SHEET — {{entity.legal_name}}

Investor: {{firm.legal_name}}
Company: {{entity.canonical_name}}
Instrument: {{deal.instrument}}
Pre-Money ($m): {{deal.pre_money}}
Check Size ($k): {{deal.check_size}}
Effective: {{effective_date}}

This term sheet is non-binding except for exclusivity and confidentiality...`,
  },
  {
    template_id: 'TPL-SPA',
    name: 'Stock Purchase Agreement',
    doc_type: 'SPA',
    folder_hint: '02_Deal',
    requires_human_send: true,
    merge_tokens: [
      '{{entity.legal_name}}',
      '{{deal.check_size}}',
      '{{deal.instrument}}',
      '{{firm.legal_name}}',
      '{{party.signatory_name}}',
      '{{effective_date}}',
    ],
    body: `STOCK PURCHASE AGREEMENT

Buyer: {{firm.legal_name}}
Company: {{entity.legal_name}}
Purchase amount ($k): {{deal.check_size}} ({{deal.instrument}})
Signatory: {{party.signatory_name}}
Date: {{effective_date}}`,
  },
  {
    template_id: 'TPL-PSA',
    name: 'Purchase & Sale Agreement (RE)',
    doc_type: 'PSA',
    folder_hint: '02_Deal',
    requires_human_send: true,
    merge_tokens: [
      '{{firm.legal_name}}',
      '{{property}}',
      '{{address}}',
      '{{effective_date}}',
    ],
    body: `PURCHASE AND SALE AGREEMENT

Buyer: {{firm.legal_name}}
Property: {{property}}
Address: {{address}}
Effective: {{effective_date}}`,
  },
  {
    template_id: 'TPL-WIRE',
    name: 'Wire Instruction Package',
    doc_type: 'Wire Package',
    folder_hint: '02_Deal',
    requires_human_send: true,
    merge_tokens: [
      '{{entity.canonical_name}}',
      '{{deal.check_size}}',
      '{{firm.legal_name}}',
      '{{effective_date}}',
    ],
    body: `WIRE PACKAGE (DUAL-CONTROL)

Payor: {{firm.legal_name}}
Payee / Company: {{entity.canonical_name}}
Amount ($k): {{deal.check_size}}
Date: {{effective_date}}

Requires dual-control human verification before release.`,
  },
  {
    template_id: 'TPL-OFFER',
    name: 'Employment Offer Letter',
    doc_type: 'Offer Letter',
    folder_hint: '05_HR',
    requires_human_send: false,
    merge_tokens: [
      '{{entity.canonical_name}}',
      '{{party.signatory_name}}',
      '{{party.signatory_email}}',
      '{{effective_date}}',
    ],
    body: `OFFER LETTER — {{entity.canonical_name}}

Candidate: {{party.signatory_name}} ({{party.signatory_email}})
Start: {{effective_date}}`,
  },
];

export function getTemplate(templateId: string): DocTemplate | null {
  return DOC_TEMPLATES.find((t) => t.template_id === templateId) ?? null;
}
