'use client';

import { useActionState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTicketAction,
  type TicketActionResult,
} from '@/app/(app)/shared-services/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  FINANCE_REQUEST_TEMPLATES,
} from '@/lib/shared-services/finance-ops-phase62';
import { HR_REQUEST_TEMPLATES } from '@/lib/shared-services/hr-ops-phase62';
import { SS_SERVICES, TICKET_PRIORITIES, type SsService } from '@/lib/types';

const ALL_TEMPLATES = [...FINANCE_REQUEST_TEMPLATES, ...HR_REQUEST_TEMPLATES];

type Prefill = {
  service?: SsService | string;
  template?: string;
  entityId?: string;
};

export function CreateTicketForm({ prefill }: { prefill?: Prefill }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    TicketActionResult | null,
    FormData
  >(createTicketAction, null);

  const template = useMemo(() => {
    if (!prefill?.template) return null;
    return ALL_TEMPLATES.find((t) => t.template_id === prefill.template) ?? null;
  }, [prefill?.template]);

  const defaultService =
    (template?.service as SsService | undefined) ??
    (SS_SERVICES.includes((prefill?.service ?? '') as SsService)
      ? (prefill?.service as SsService)
      : 'IT');
  const defaultPriority = template?.default_priority ?? 'P2';
  const defaultTitle = template?.title ?? '';
  const defaultDescription = template?.description ?? '';
  const defaultEntity = prefill?.entityId?.trim() || 'ENT-FIRM';
  const defaultCompanyName = entityDisplayName(defaultEntity);
  const defaultDesiredOutcome = template
    ? `Complete: ${template.title}`
    : '';

  useEffect(() => {
    if (state?.ok && state.ticketId) {
      router.push(`/shared-services/tickets/${state.ticketId}`);
    }
  }, [state, router]);

  return (
    <Card id="create-ticket">
      <CardHeader>
        <CardTitle className="text-base">Create ticket</CardTitle>
        <CardDescription>
          {template
            ? `Template · ${template.title}. High-risk and money actions always need a person.`
            : 'Open a service request for Finance, HR, Legal, IT, or Marketing.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              name="title"
              required
              minLength={3}
              defaultValue={defaultTitle}
              key={`title-${template?.template_id ?? 'blank'}`}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              defaultValue={defaultDescription}
              key={`desc-${template?.template_id ?? 'blank'}`}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="desired_outcome">Desired outcome</Label>
            <Input
              id="desired_outcome"
              name="desired_outcome"
              defaultValue={defaultDesiredOutcome}
              key={`outcome-${template?.template_id ?? 'blank'}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service">Service</Label>
            <select
              id="service"
              name="service"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue={defaultService}
              key={`svc-${defaultService}`}
            >
              {SS_SERVICES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              name="priority"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue={defaultPriority}
              key={`pri-${defaultPriority}`}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requester_name">Requester</Label>
            <Input
              id="requester_name"
              name="requester_name"
              defaultValue="Associate"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company_name">Company name</Label>
            <Input
              id="company_name"
              name="company_name"
              defaultValue={defaultCompanyName}
              key={`co-${defaultEntity}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity_id">Company *</Label>
            <CompanySelect
              id="entity_id"
              name="entity_id"
              required
              defaultValue={defaultEntity}
              className="h-8"
              key={`ent-${defaultEntity}`}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="links">Links</Label>
            <Input
              id="links"
              name="links"
              placeholder="URL / deal / company page"
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create ticket'}
            </Button>
            {state && !state.ok ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
            {state?.ok ? (
              <p className="text-sm text-muted-foreground">{state.message}</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
