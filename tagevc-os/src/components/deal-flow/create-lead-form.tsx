'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  createLeadAction,
  type ActionResult,
} from '@/app/(app)/deal-flow/vc/actions';
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
import { LEAD_SOURCES, PRIORITIES } from '@/lib/types';

type EntityOption = { entity_id: string; canonical_name: string };

export function CreateLeadForm({
  entities = [],
  defaultSource = 'Inbound',
  defaultRelatedEntityId,
  showRelatedEntity = false,
  title = 'New lead',
  description = 'Creates a Pipeline Active row at Sourced and spawns LS-01–LS-04 tasks.',
}: {
  entities?: EntityOption[];
  defaultSource?: string;
  defaultRelatedEntityId?: string;
  showRelatedEntity?: boolean;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(createLeadAction, null);

  useEffect(() => {
    if (state?.ok && state.leadId) {
      router.push(`/deal-flow/vc/leads/${state.leadId}`);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="company_name">Company *</Label>
            <Input id="company_name" name="company_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="acme.ai" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sector">Sector</Label>
            <Input id="sector" name="sector" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source">Source *</Label>
            <select
              id="source"
              name="source"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue={defaultSource}
              required
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source_detail">Source detail</Label>
            <Input
              id="source_detail"
              name="source_detail"
              placeholder="Website form · referrer"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner *</Label>
            <Input id="owner" name="owner" defaultValue="Associate" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              name="priority"
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue="Medium"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise_stage">Raise stage</Label>
            <Input id="raise_stage" name="raise_stage" placeholder="Seed" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="check_size_k">Check size ($k)</Label>
            <Input id="check_size_k" name="check_size_k" type="number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" />
          </div>
          {showRelatedEntity ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="related_entity_id">
                Related entity (optional)
              </Label>
              <select
                id="related_entity_id"
                name="related_entity_id"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                defaultValue={defaultRelatedEntityId ?? ''}
              >
                <option value="">— none —</option>
                {entities.map((e) => (
                  <option key={e.entity_id} value={e.entity_id}>
                    {e.canonical_name} ({e.entity_id})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create lead'}
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
