'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  provisionPartnerSpineAction,
  savePartnerContractAction,
  savePartnerPaymentAction,
  type PartnerWriteResult,
} from '@/app/(app)/shared-services/it/technology-stack/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PARTNER_CATALOG } from '@/lib/partners/catalog';
import type {
  PartnerVendorContract,
  PartnerVendorPayment,
} from '@/lib/partners/types';

const CONTRACT_STATUSES = [
  'draft',
  'active',
  'renewal_due',
  'expired',
  'cancelled',
] as const;

function ActionMessage({ state }: { state: PartnerWriteResult | null }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-emerald-700">
        {state.message ?? 'Saved'}
      </p>
    );
  }
  return <p className="text-sm text-destructive">{state.error}</p>;
}

type PaymentRow = PartnerVendorPayment & {
  contract: PartnerVendorContract | null;
};

type Props = {
  contracts: PartnerVendorContract[];
  payments: PaymentRow[];
};

export function TechnologyStackAdminClient({ contracts, payments }: Props) {
  const [contractState, contractAction, contractPending] = useActionState<
    PartnerWriteResult | null,
    FormData
  >(savePartnerContractAction, null);
  const [paymentState, paymentAction, paymentPending] = useActionState<
    PartnerWriteResult | null,
    FormData
  >(savePartnerPaymentAction, null);
  const [provisionState, provisionAction, provisionPending] = useActionState<
    PartnerWriteResult | null,
    FormData
  >(provisionPartnerSpineAction, null);

  const [editContract, setEditContract] = useState<PartnerVendorContract | null>(
    null,
  );

  const contractDefaults = useMemo(() => {
    if (!editContract) {
      return {
        id: '',
        partner_key: PARTNER_CATALOG[0]?.key ?? 'dialpad',
        entity_id: '',
        vendor_name: '',
        contract_title: '',
        status: 'active' as const,
        starts_on: '',
        ends_on: '',
        amount: '',
        currency: 'USD',
        payment_cadence: '',
        document_path: '',
        notes: '',
      };
    }
    return {
      id: editContract.id,
      partner_key: editContract.partner_key,
      entity_id: editContract.entity_id ?? '',
      vendor_name: editContract.vendor_name,
      contract_title: editContract.contract_title,
      status: editContract.status,
      starts_on: editContract.starts_on ?? '',
      ends_on: editContract.ends_on ?? '',
      amount:
        editContract.amount_cents == null
          ? ''
          : String(editContract.amount_cents / 100),
      currency: editContract.currency,
      payment_cadence: editContract.payment_cadence ?? '',
      document_path: editContract.document_path ?? '',
      notes: editContract.notes ?? '',
    };
  }, [editContract]);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Contracts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Firm-wide write. Secrets stay in env — only commercial terms here.
            </p>
          </div>
          {editContract ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditContract(null)}
            >
              New contract
            </Button>
          ) : null}
        </div>

        {contracts.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-3 py-2 font-medium">Partner</th>
                  <th className="px-3 py-2 font-medium">Vendor / title</th>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Ends</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2">{c.partner_key}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.vendor_name}</div>
                      <div className="text-muted-foreground">{c.contract_title}</div>
                      {c.amount_cents != null ? (
                        <div className="text-xs text-muted-foreground">
                          {(c.amount_cents / 100).toFixed(2)} {c.currency}
                          {c.payment_cadence ? ` · ${c.payment_cadence}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{c.entity_id ?? 'firm-wide'}</td>
                    <td className="px-3 py-2">{c.status}</td>
                    <td className="px-3 py-2">{c.ends_on ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditContract(c)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No contracts yet — add one below.
          </p>
        )}

        <form
          key={editContract?.id ?? 'new-contract'}
          action={contractAction}
          className="grid gap-3 sm:grid-cols-3"
        >
          <input type="hidden" name="id" defaultValue={contractDefaults.id} />
          <div className="space-y-1.5">
            <Label htmlFor="partner_key">Partner</Label>
            <select
              id="partner_key"
              name="partner_key"
              required
              defaultValue={contractDefaults.partner_key}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              {PARTNER_CATALOG.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor_name">Vendor name</Label>
            <Input
              id="vendor_name"
              name="vendor_name"
              required
              defaultValue={contractDefaults.vendor_name}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract_title">Contract title</Label>
            <Input
              id="contract_title"
              name="contract_title"
              required
              defaultValue={contractDefaults.contract_title}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity_id">Entity (blank = firm-wide)</Label>
            <CompanySelect
              id="entity_id"
              name="entity_id"
              defaultValue={contractDefaults.entity_id || undefined}
              allowAll
              allLabel="Firm-wide (all entities)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              defaultValue={contractDefaults.amount}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              name="currency"
              defaultValue={contractDefaults.currency}
              maxLength={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={contractDefaults.status}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="starts_on">Starts</Label>
            <Input
              id="starts_on"
              name="starts_on"
              type="date"
              defaultValue={contractDefaults.starts_on}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ends_on">Ends</Label>
            <Input
              id="ends_on"
              name="ends_on"
              type="date"
              defaultValue={contractDefaults.ends_on}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment_cadence">Cadence</Label>
            <Input
              id="payment_cadence"
              name="payment_cadence"
              placeholder="Annual"
              defaultValue={contractDefaults.payment_cadence}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="document_path">Document path</Label>
            <Input
              id="document_path"
              name="document_path"
              placeholder="s3:// or /documents/..."
              defaultValue={contractDefaults.document_path}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={contractDefaults.notes}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <Button type="submit" disabled={contractPending}>
              {editContract ? 'Update contract' : 'Save contract'}
            </Button>
            <ActionMessage state={contractState} />
          </div>
        </form>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-base font-semibold">Record payment</h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a contract before recording payments.
          </p>
        ) : (
          <form action={paymentAction} className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contract_id">Contract</Label>
              <select
                id="contract_id"
                name="contract_id"
                required
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                defaultValue={contracts[0]?.id}
              >
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.vendor_name} · {c.contract_title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paid_on">Paid on</Label>
              <Input id="paid_on" name="paid_on" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment_amount">Amount</Label>
              <Input
                id="payment_amount"
                name="amount"
                type="number"
                step="0.01"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment_currency">Currency</Label>
              <Input
                id="payment_currency"
                name="currency"
                defaultValue="USD"
                maxLength={3}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                name="reference"
                placeholder="Invoice #, check #, etc."
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="payment_notes">Notes</Label>
              <Input id="payment_notes" name="notes" />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
              <Button type="submit" variant="outline" disabled={paymentPending}>
                Add payment
              </Button>
              <ActionMessage state={paymentState} />
            </div>
          </form>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-dashed border-border p-4">
        <h2 className="text-base font-semibold">Provision partner spine</h2>
        <p className="text-sm text-muted-foreground">
          Inherit catalog bindings, marketing presence slots, and Vendor
          Management for an entity. Also available via{' '}
          <code>POST /api/partners/provision-entity</code>.
        </p>
        <form action={provisionAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] space-y-1.5">
            <Label htmlFor="provision_entity_id">Entity</Label>
            <CompanySelect
              id="provision_entity_id"
              name="entity_id"
              required
              defaultValue="ENT-FIRM"
            />
          </div>
          <Button type="submit" variant="outline" disabled={provisionPending}>
            Run provision
          </Button>
          <ActionMessage state={provisionState} />
        </form>
      </section>

      <section>
        <h2 className="text-base font-semibold">Recent vendor payments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contract document paths and payments feed Technology + Finance ops.
        </p>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {payments.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border px-3 py-2"
              >
                <div className="font-medium">
                  {p.paid_on} · {(p.amount_cents / 100).toFixed(2)} {p.currency}
                  {p.reference ? ` · ${p.reference}` : ''}
                </div>
                {p.contract ? (
                  <div className="text-muted-foreground">
                    {p.contract.vendor_name} · {p.contract.contract_title}
                    {p.contract.partner_key ? ` (${p.contract.partner_key})` : ''}
                  </div>
                ) : null}
                {p.notes ? (
                  <div className="text-xs text-muted-foreground">{p.notes}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
