/**
 * Master data loaders — binding SSOT from spreadsheet dumps.
 * Do not invent parallel CoA / banks / entities.
 */

import entitiesJson from '@/lib/af/ssot/entities.json';
import banksJson from '@/lib/af/ssot/banks.json';
import attachmentsJson from '@/lib/af/ssot/invoice-attachments.json';
import familyJson from '@/lib/af/ssot/personal-family.json';
import personalBanksJson from '@/lib/af/ssot/personal-banks.json';
import profilesJson from '@/lib/af/ssot/allocation-profiles.json';
import goLiveJson from '@/lib/af/ssot/go-live-steps.json';
import coaTvc from '@/lib/af/ssot/coa-tage-vc.json';
import coaR619 from '@/lib/af/ssot/coa-recruit-619.json';
import coaShr from '@/lib/af/ssot/coa-signent-hr.json';
import coaInda from '@/lib/af/ssot/coa-instant-nda.json';
import coaPers from '@/lib/af/ssot/coa-personal.json';

import type {
  AfEntity,
  AllocationBucket,
  BankAccount,
  CoaAccount,
  EntityCode,
  FamilyMember,
  InvoiceAttachmentDefault,
} from '@/lib/af/types';
import { ENTITY_DISPLAY } from '@/lib/af/constants';

export const AF_ENTITIES = entitiesJson as AfEntity[];
export const AF_BANKS = banksJson as BankAccount[];
export const AF_INVOICE_ATTACHMENTS =
  attachmentsJson as InvoiceAttachmentDefault[];
export const AF_PERSONAL_FAMILY = familyJson as FamilyMember[];
export const AF_PERSONAL_BANKS = personalBanksJson as Array<{
  id: string;
  name: string;
  type: string;
  glAccount: string;
  familyClass: string;
  feedEnabled: boolean;
  notes: string;
}>;

export const AF_ALLOCATION_PROFILES = profilesJson as Record<
  string,
  AllocationBucket[]
>;

export const AF_GO_LIVE = goLiveJson as {
  org: Array<{
    id: string;
    action: string;
    required: boolean;
    ssot: string;
  }>;
  entity: Array<{
    id: string;
    action: string;
    required: boolean;
    ssot: string;
    subsOnly?: boolean;
  }>;
};

const COA_BY_ENTITY: Record<string, CoaAccount[]> = {
  TVC: coaTvc as CoaAccount[],
  R619: coaR619 as CoaAccount[],
  SHR: coaShr as CoaAccount[],
  INDA: coaInda as CoaAccount[],
  PERS: coaPers as CoaAccount[],
};

export function getEntity(code: EntityCode): AfEntity | undefined {
  return AF_ENTITIES.find((e) => e.code === code);
}

export function getEntityDisplayName(code: string): string {
  return ENTITY_DISPLAY[code] ?? code;
}

export function getBanksForEntity(code: EntityCode): BankAccount[] {
  return AF_BANKS.filter((b) => b.entityCode === code);
}

export function getOperatingBank(code: EntityCode): BankAccount | undefined {
  return AF_BANKS.find(
    (b) => b.entityCode === code && b.glAccount === '1000',
  );
}

export function getCoa(code: string): CoaAccount[] {
  return COA_BY_ENTITY[code] ?? [];
}

export function getEntityAttachmentDefaults(
  code: EntityCode,
): InvoiceAttachmentDefault[] {
  return AF_INVOICE_ATTACHMENTS.filter(
    (a) => a.entityCode === code && a.status === 'Active',
  ).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getAllocationProfile(
  code: EntityCode,
): AllocationBucket[] {
  return AF_ALLOCATION_PROFILES[code] ?? AF_ALLOCATION_PROFILES.R619;
}

/** Future entity bake-in: OP + SV banks (Spec Cash Routing / MD Banks). */
export function provisionFutureEntityBanks(code: string): BankAccount[] {
  return [
    {
      id: `BA-${code}-OP`,
      entityCode: code as EntityCode,
      name: 'Operating Account',
      type: 'Checking',
      glAccount: '1000',
      purpose: 'Ops spend + default collections',
      feedEnabled: true,
      institution: '',
    },
    {
      id: `BA-${code}-SV`,
      entityCode: code as EntityCode,
      name: `${code} Savings`,
      type: 'Savings',
      glAccount: '1040',
      purpose: 'Entity reserve',
      feedEnabled: true,
      institution: '',
    },
  ];
}

/** Future entity: Wire + I-9 required attachment stubs. */
export function provisionFutureEntityAttachments(
  code: string,
): InvoiceAttachmentDefault[] {
  return [
    {
      id: `ATT-${code}-WIRE`,
      entityCode: code as EntityCode,
      documentType: 'Wiring Instructions',
      displayName: `${code} Wire Instructions`,
      fileRef: `docs/${code.toLowerCase()}/wire.pdf`,
      requiredOnSend: true,
      sortOrder: 10,
      status: 'Active',
      notes: 'Auto on every invoice — upload PDF before go-live',
    },
    {
      id: `ATT-${code}-I9`,
      entityCode: code as EntityCode,
      documentType: 'I-9 Packet',
      displayName: 'I-9 / Compliance Attachment',
      fileRef: `docs/${code.toLowerCase()}/i9-packet.pdf`,
      requiredOnSend: true,
      sortOrder: 20,
      status: 'Active',
      notes: '',
    },
  ];
}
