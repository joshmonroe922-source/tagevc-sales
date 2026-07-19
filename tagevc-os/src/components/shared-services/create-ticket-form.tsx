'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createTicketAction,
  type TicketActionResult,
} from '@/app/(app)/shared-services/actions';
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
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';

export function CreateTicketForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    TicketActionResult | null,
    FormData
  >(createTicketAction, null);

  useEffect(() => {
    if (state?.ok && state.ticketId) {
      router.push(`/shared-services/tickets/${state.ticketId}`);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New ticket</CardTitle>
        <CardDescription>
          Intake → Diagnose (band + confidence). Forbid-list and P0 always
          ESCALATE. AUTO only on COO allow-list at ≥90%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required minLength={3} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="desired_outcome">Desired outcome</Label>
            <Input id="desired_outcome" name="desired_outcome" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service">Service</Label>
            <select
              id="service"
              name="service"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue="IT"
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
              defaultValue="P2"
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
            <Label htmlFor="company_name">Company</Label>
            <Input id="company_name" name="company_name" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="links">Links</Label>
            <Input id="links" name="links" placeholder="URL / deal / entity" />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Diagnosing…' : 'Create ticket'}
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
