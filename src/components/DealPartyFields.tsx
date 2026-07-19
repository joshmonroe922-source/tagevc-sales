import { getAccount } from '../lib/accountsApi';
import type { SalesAccount, SalesContact } from '../lib/types';
import { AccountPicker } from './AccountPicker';
import { ContactPicker } from './ContactPicker';

export type DealPartyValue = {
  accountId: string | null;
  contactId: string | null;
  account: SalesAccount | null;
  contact: SalesContact | null;
};

type Props = {
  value: DealPartyValue;
  onChange: (next: DealPartyValue) => void;
  createdBy?: string | null;
  disabled?: boolean;
  /** Contact is required for new deals. */
  requireContact?: boolean;
};

/**
 * Account + Contact lookups for deal create/detail.
 * Selecting a contact may auto-fill account; selecting an account filters contacts.
 */
export function DealPartyFields({
  value,
  onChange,
  createdBy,
  disabled,
  requireContact = true,
}: Props) {
  async function onAccountChange(
    accountId: string | null,
    account: SalesAccount | null,
  ) {
    let contact = value.contact;
    let contactId = value.contactId;
    // Clear contact if it belongs to a different account
    if (
      contact &&
      accountId &&
      contact.account_id &&
      contact.account_id !== accountId
    ) {
      contact = null;
      contactId = null;
    }
    onChange({ accountId, account, contactId, contact });
  }

  async function onContactChange(
    contactId: string | null,
    contact: SalesContact | null,
  ) {
    let accountId = value.accountId;
    let account = value.account;

    if (contact?.account_id && contact.account_id !== accountId) {
      accountId = contact.account_id;
      account =
        contact.sales_accounts
          ? {
              id: contact.sales_accounts.id,
              name: contact.sales_accounts.name,
              website: contact.sales_accounts.website,
              account_type: contact.sales_accounts.account_type,
              notes: '',
              created_by: null,
              archived_at: null,
              created_at: '',
              updated_at: '',
            }
          : (await getAccount(contact.account_id));
    }

    onChange({
      accountId,
      account,
      contactId,
      contact,
    });
  }

  return (
    <div className="deal-party-fields form-grid">
      <div className="full">
        <span className="field-label">Account</span>
        <AccountPicker
          value={value.accountId}
          onChange={(id, account) => void onAccountChange(id, account)}
          createdBy={createdBy}
          disabled={disabled}
        />
      </div>
      <div className="full">
        <span className="field-label">
          Contact{requireContact ? ' *' : ''}
        </span>
        <ContactPicker
          value={value.contactId}
          accountId={value.accountId}
          onChange={(id, contact) => void onContactChange(id, contact)}
          createdBy={createdBy}
          disabled={disabled}
          required={requireContact}
        />
      </div>
    </div>
  );
}

export function emptyDealParty(): DealPartyValue {
  return {
    accountId: null,
    contactId: null,
    account: null,
    contact: null,
  };
}

/** Snapshot lead display fields from linked account/contact. */
export function dealSnapshotsFromParty(party: DealPartyValue): {
  name: string;
  email: string;
  phone: string;
  company: string;
  account_id: string | null;
  contact_id: string | null;
} {
  return {
    name: party.contact?.full_name?.trim() || '',
    email: party.contact?.primary_email?.trim().toLowerCase() || '',
    phone: party.contact?.primary_phone?.trim() || '',
    company:
      party.account?.name?.trim() ||
      party.contact?.company?.trim() ||
      '',
    account_id: party.accountId,
    contact_id: party.contactId,
  };
}
