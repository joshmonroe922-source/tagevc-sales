'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  startHrisOffboardingAction,
  startHrisOnboardingAction,
  updateHrisEmployeeAction,
  updateHrisStepAction,
  uploadHrisDocumentAction,
} from '@/app/(app)/shared-services/hr/actions-hris';
import {
  confirmScreeningOrderAction,
  createPendingScreeningOrderAction,
  waiveScreeningOrderAction,
} from '@/app/(app)/screening/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { PeoplePicker } from '@/components/shared-services/people-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { entityDisplayName } from '@/lib/entities/display-name';
import { recruitPeopleHref } from '@/lib/hris/recruit-hook';
import { isStepOverdue } from '@/lib/hris/timing';
import type { HrisDocumentRow } from '@/lib/hris/documents';
import {
  completionLabel,
  statusLabel,
  type HrisEmployee,
  type HrisEmployeeEvent,
  type HrisEmployeeLink,
  type HrisProcessRun,
  type HrisProcessStep,
  type HrisStepStatus,
} from '@/lib/hris/types';
import type { ScreeningOrder } from '@/lib/screening/types';

function isDocuSignStep(step: HrisProcessStep): boolean {
  return (
    step.system_hook === 'docusign_send' ||
    step.step_key === 'pre.offer_letter' ||
    /nda/i.test(step.step_key) ||
    /nda/i.test(step.title)
  );
}

function isScreeningStep(step: HrisProcessStep): boolean {
  return (
    step.system_hook === 'verified_first' ||
    step.system_hook === 'screening' ||
    step.step_key.includes('verified_first') ||
    /background|drug.?screen|verified.?first/i.test(step.title)
  );
}

export function HrisEmployeeDetailClient({
  employee,
  runs,
  events,
  links,
  documents,
  screeningOrders = [],
  canWrite,
  canViewComp,
  managerProfile,
}: {
  employee: HrisEmployee;
  runs: HrisProcessRun[];
  events: HrisEmployeeEvent[];
  links: HrisEmployeeLink[];
  documents: HrisDocumentRow[];
  screeningOrders?: ScreeningOrder[];
  canWrite: boolean;
  canViewComp: boolean;
  managerProfile?: {
    id: string;
    email: string;
    full_name: string | null;
    role_label?: string;
    company_name?: string;
  } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const onboarding = runs.find((r) => r.kind === 'onboarding');
  const offboarding = runs.find((r) => r.kind === 'offboarding');
  const recruitHref = recruitPeopleHref(employee.recruit_assignment);
  const itLinks = links.filter(
    (l) => l.kind === 'it_onboarding' || l.kind === 'it_offboarding',
  );

  const setStep = (
    step: HrisProcessStep,
    status: HrisStepStatus,
    opts?: { destructive?: boolean; docusign?: boolean },
  ) => {
    start(async () => {
      const res = await updateHrisStepAction({
        stepId: step.id,
        employeeId: employee.id,
        status,
        confirmDestructive: opts?.destructive,
        confirmDocuSign: opts?.docusign,
      });
      setMessage(res.ok ? res.message : res.error);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{statusLabel(employee.status)}</Badge>
        <Badge variant="outline">
          {entityDisplayName(employee.entity_id)}
        </Badge>
        <Badge variant="outline">
          Onboarding {completionLabel(employee.onboarding_pct)}
        </Badge>
        {employee.offboarding_status !== 'none' ? (
          <Badge variant="outline">
            Offboarding {completionLabel(employee.offboarding_pct)}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>
              Employee system of record — not just tickets or checklists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canWrite ? (
              <form
                className="grid gap-3 sm:grid-cols-2"
                action={(fd) =>
                  start(async () => {
                    const res = await updateHrisEmployeeAction(employee.id, fd);
                    setMessage(res.ok ? res.message : res.error);
                    router.refresh();
                  })
                }
              >
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="full_name">Name</Label>
                  <Input
                    id="full_name"
                    name="full_name"
                    defaultValue={employee.full_name}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role_title">Title</Label>
                  <Input
                    id="role_title"
                    name="role_title"
                    defaultValue={employee.role_title}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entity_id">Company</Label>
                  <CompanySelect
                    id="entity_id"
                    name="entity_id"
                    defaultValue={employee.entity_id}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="work_email">Work email</Label>
                  <Input
                    id="work_email"
                    name="work_email"
                    defaultValue={employee.work_email}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="personal_email">Personal email</Label>
                  <Input
                    id="personal_email"
                    name="personal_email"
                    defaultValue={employee.personal_email}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    defaultValue={employee.phone}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <PeoplePicker
                    name="manager_profile_id"
                    label="Manager"
                    disabled={!canWrite}
                    initial={
                      managerProfile ??
                      (employee.manager_profile_id
                        ? {
                            id: employee.manager_profile_id,
                            email: '',
                            full_name: employee.manager_name || null,
                          }
                        : null)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    name="department"
                    defaultValue={employee.department}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    name="location"
                    defaultValue={employee.location}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start_date">Start date</Label>
                  <Input
                    id="start_date"
                    name="start_date"
                    type="date"
                    defaultValue={employee.start_date ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_date">End date</Label>
                  <Input
                    id="end_date"
                    name="end_date"
                    type="date"
                    defaultValue={employee.end_date ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    name="status"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    defaultValue={employee.status}
                  >
                    {[
                      'pre_start',
                      'onboarding',
                      'active',
                      'leave',
                      'offboarding',
                      'terminated',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                {canViewComp ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="comp_amount">Comp amount (HR only)</Label>
                      <Input
                        id="comp_amount"
                        name="comp_amount"
                        type="number"
                        step="0.01"
                        defaultValue={employee.comp_amount ?? ''}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="comp_currency">Currency</Label>
                      <Input
                        id="comp_currency"
                        name="comp_currency"
                        defaultValue={employee.comp_currency}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="comp_basis">Comp basis</Label>
                      <select
                        id="comp_basis"
                        name="comp_basis"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        defaultValue={employee.comp_basis}
                      >
                        {['salary', 'hourly', 'commission', 'draw', 'other'].map(
                          (b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay_frequency">Pay frequency</Label>
                      <select
                        id="pay_frequency"
                        name="pay_frequency"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        defaultValue={employee.pay_frequency}
                      >
                        {[
                          'annual',
                          'monthly',
                          'biweekly',
                          'weekly',
                          'hourly',
                        ].map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : null}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input id="notes" name="notes" defaultValue={employee.notes} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={pending} size="sm">
                    Save profile
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Title</dt>
                  <dd>{employee.role_title || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{employee.work_email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Manager</dt>
                  <dd>{employee.manager_name || '—'}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Links & Recruit</CardTitle>
            <CardDescription>
              Documents, equipment, access, IT child runs, Recruit assignment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {recruitHref ? (
              <p>
                Recruit assignment:{' '}
                <a
                  href={recruitHref}
                  className="underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {employee.recruit_assignment.status ?? 'pending_link'}
                </a>
              </p>
            ) : (
              <p className="text-muted-foreground">
                No Recruit assignment (company is not Recruit 619).
              </p>
            )}
            {itLinks.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  IT child runs
                </p>
                <ul className="space-y-1">
                  {itLinks.map((l) => (
                    <li key={l.id}>
                      {l.href ? (
                        <Link
                          href={l.href}
                          className="underline-offset-4 hover:underline"
                        >
                          {l.label}
                        </Link>
                      ) : (
                        l.label
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {links.length === 0 ? (
              <p className="text-muted-foreground">
                No document / equipment / access links yet. IT child runs link
                when onboarding/offboarding starts.
              </p>
            ) : (
              <ul className="space-y-1">
                {links.map((l) => (
                  <li key={l.id}>
                    {l.href ? (
                      <Link
                        href={l.href}
                        className="underline-offset-4 hover:underline"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      l.label
                    )}{' '}
                    <span className="text-xs text-muted-foreground">
                      · {l.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2 pt-2">
                {!onboarding ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await startHrisOnboardingAction(employee.id);
                        setMessage(res.ok ? res.message : res.error);
                        router.refresh();
                      })
                    }
                  >
                    Start onboarding
                  </Button>
                ) : null}
                {!offboarding ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Start offboarding? Access revoke steps require separate human confirmation.',
                        )
                      ) {
                        return;
                      }
                      start(async () => {
                        const res = await startHrisOffboardingAction(
                          employee.id,
                        );
                        setMessage(res.ok ? res.message : res.error);
                        router.refresh();
                      });
                    }}
                  >
                    Start offboarding
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document vault</CardTitle>
          <CardDescription>
            Offer / NDA / I-9 style attachments (private bucket). Linked on
            timeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {documents.length === 0 ? (
            <p className="text-muted-foreground">No vault documents yet.</p>
          ) : (
            <ul className="space-y-1">
              {documents.map((d) => (
                <li key={d.id}>
                  {d.title}{' '}
                  <span className="text-xs text-muted-foreground">
                    · {d.kind} · {d.file_name}
                    {d.docusign_envelope_id
                      ? ` · DS ${d.docusign_status ?? 'sent'}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const fd = new FormData(form);
                const file = (form.elements.namedItem('file') as HTMLInputElement)
                  ?.files?.[0];
                if (!file) {
                  setMessage('Choose a file');
                  return;
                }
                start(async () => {
                  const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = String(reader.result ?? '');
                      const comma = result.indexOf(',');
                      resolve(comma >= 0 ? result.slice(comma + 1) : result);
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                  });
                  const res = await uploadHrisDocumentAction({
                    employeeId: employee.id,
                    kind: String(fd.get('kind') ?? 'other') as HrisDocumentRow['kind'],
                    title: String(fd.get('title') ?? file.name),
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    base64,
                  });
                  setMessage(res.ok ? res.message : res.error);
                  router.refresh();
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="doc_title">Title</Label>
                <Input id="doc_title" name="title" placeholder="Offer letter" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc_kind">Kind</Label>
                <select
                  id="doc_kind"
                  name="kind"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  defaultValue="offer"
                >
                  {['offer', 'nda', 'i9', 'handbook', 'contract', 'id', 'other'].map(
                    (k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="file">File</Label>
                <Input id="file" name="file" type="file" />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                Upload to vault
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {(onboarding || offboarding) &&
        [onboarding, offboarding].filter(Boolean).map((run) => (
          <Card key={run!.id}>
            <CardHeader>
              <CardTitle className="text-base capitalize">
                {run!.kind} · {completionLabel(run!.completion_pct)}
              </CardTitle>
              <CardDescription>
                Status {statusLabel(run!.status)}
                {run!.kind === 'offboarding'
                  ? ' · revoke-first sequence; destructive steps need confirm'
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(run!.steps ?? []).map((step) => {
                const overdue = isStepOverdue(step);
                const ds = isDocuSignStep(step);
                const screening = isScreeningStep(step);
                const stepOrders = screeningOrders.filter(
                  (o) =>
                    o.consumer_ref.hris_step_id === step.id ||
                    (o.subject_type === 'employee' &&
                      o.subject_id === employee.id),
                );
                const openOrder = stepOrders.find((o) =>
                  ['pending', 'ordered', 'in_progress', 'review'].includes(
                    o.status,
                  ),
                );
                return (
                  <div
                    key={step.id}
                    className="rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{step.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {step.category} · {step.owner_role}
                          {step.due_at ? ` · due ${step.due_at}` : ''}
                          {step.system_hook ? ` · ${step.system_hook}` : ''}
                          {step.optional_for_audience ? ' · optional' : ''}
                          {step.destructive ? ' · destructive' : ''}
                          {ds ? ' · DocuSign' : ''}
                          {screening ? ' · Verified First' : ''}
                        </p>
                        {step.evidence_note ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Evidence: {step.evidence_note}
                          </p>
                        ) : null}
                        {screening && stepOrders[0] ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Order status: {stepOrders[0].status}
                            {stepOrders[0].package_code
                              ? ` · ${stepOrders[0].package_code}`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {overdue ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : null}
                        <Badge variant="outline">
                          {statusLabel(step.status)}
                        </Badge>
                      </div>
                    </div>
                    {canWrite &&
                    screening &&
                    !['done', 'waived', 'na'].includes(step.status) ? (
                      <div className="mt-2 space-y-2">
                        {!openOrder ? (
                          <form
                            action={createPendingScreeningOrderAction}
                            className="flex flex-wrap gap-2"
                          >
                            <input
                              type="hidden"
                              name="entity_id"
                              value={employee.entity_id}
                            />
                            <input
                              type="hidden"
                              name="subject_type"
                              value="employee"
                            />
                            <input
                              type="hidden"
                              name="subject_id"
                              value={employee.id}
                            />
                            <input type="hidden" name="kind" value="bg" />
                            <input
                              type="hidden"
                              name="hris_step_id"
                              value={step.id}
                            />
                            <input
                              type="hidden"
                              name="hris_run_id"
                              value={run!.id}
                            />
                            <input
                              type="hidden"
                              name="subject_name"
                              value={employee.full_name}
                            />
                            <input
                              type="hidden"
                              name="subject_email"
                              value={
                                employee.work_email || employee.personal_email
                              }
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              Create pending screen order
                            </Button>
                          </form>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <form
                              action={confirmScreeningOrderAction}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <input
                                type="hidden"
                                name="order_id"
                                value={openOrder.id}
                              />
                              <input
                                type="hidden"
                                name="subject_name"
                                value={employee.full_name}
                              />
                              <input
                                type="hidden"
                                name="subject_email"
                                value={
                                  employee.work_email ||
                                  employee.personal_email
                                }
                              />
                              <label className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  name="human_confirm"
                                  value="1"
                                  required
                                />
                                Confirm order
                              </label>
                              <Button type="submit" size="sm">
                                Confirm &amp; order
                              </Button>
                            </form>
                            <form
                              action={waiveScreeningOrderAction}
                              className="flex flex-wrap gap-1"
                            >
                              <input
                                type="hidden"
                                name="order_id"
                                value={openOrder.id}
                              />
                              <input
                                name="waiver_reason"
                                required
                                placeholder="Waiver reason"
                                className="rounded-md border border-border px-2 py-1 text-xs"
                              />
                              <Button type="submit" size="sm" variant="outline">
                                Waive
                              </Button>
                            </form>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Step completes when order is clear or waived (or mark
                          N/A if not required).
                        </p>
                      </div>
                    ) : null}
                    {canWrite &&
                    !screening &&
                    !['done', 'waived', 'na'].includes(step.status) ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => {
                            if (ds) {
                              if (
                                !window.confirm(
                                  `Send DocuSign for "${step.title}"? This is not silent — confirm to send.`,
                                )
                              ) {
                                return;
                              }
                              setStep(step, 'done', { docusign: true });
                              return;
                            }
                            if (step.destructive) {
                              if (
                                !window.confirm(
                                  `Confirm destructive step: ${step.title}?`,
                                )
                              ) {
                                return;
                              }
                              setStep(step, 'done', { destructive: true });
                            } else {
                              setStep(step, 'done');
                            }
                          }}
                        >
                          {ds ? 'Send DocuSign & complete' : 'Complete'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setStep(step, 'waived')}
                        >
                          Waive / N/A
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setStep(step, 'blocked')}
                        >
                          Block
                        </Button>
                      </div>
                    ) : null}
                    {step.escalated_ticket_id ? (
                      <p className="mt-1 text-xs">
                        Escalated:{' '}
                        <Link
                          href={`/shared-services/tickets/${step.escalated_ticket_id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          Open ticket
                        </Link>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {events.length === 0 ? (
            <p className="text-muted-foreground">No events yet.</p>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1.5"
              >
                <span>{ev.summary}</span>
                <span className="text-xs text-muted-foreground">
                  {ev.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
