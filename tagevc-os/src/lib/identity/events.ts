/**
 * HRIS event catalog validation + outbox publish (sheet 04).
 * Technology never invents hire/term — only consumes HRIS events.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type {
  HrisCancelledHireBody,
  HrisEventEnvelope,
  HrisEventType,
  HrisHiredBody,
  HrisRehireBody,
  HrisRoleChangedBody,
  HrisTerminatedBody,
  HrisUpdatedBody,
} from '@/lib/identity/types';

export type PublishHrisEventInput = {
  event_type: HrisEventType;
  entity_id: string;
  payload: Record<string, unknown>;
  event_id?: string;
  correlation_id?: string;
  idempotency_key?: string;
  event_time?: string;
  schema_version?: string;
};

export type PublishResult =
  | { ok: true; event_id: string; correlation_id: string; duplicate?: boolean }
  | { ok: false; error: string; code?: string };

function requireString(v: unknown, field: string): string | null {
  if (typeof v !== 'string' || !v.trim()) return field;
  return null;
}

export function validateHiredPayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisHiredBody } | { ok: false; error: string } {
  const missing = [
    requireString(body.employee_id, 'employee_id'),
    requireString(body.legal_first_name, 'legal_first_name'),
    requireString(body.legal_last_name, 'legal_last_name'),
    requireString(body.personal_email, 'personal_email'),
    requireString(body.start_date, 'start_date'),
    requireString(body.primary_role_id, 'primary_role_id'),
    requireString(body.job_title, 'job_title'),
    requireString(body.entity_id, 'entity_id'),
    requireString(body.device_ownership, 'device_ownership'),
    requireString(body.employment_type, 'employment_type'),
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  const ownership = String(body.device_ownership);
  if (ownership !== 'company_owned' && ownership !== 'personal_byod') {
    return {
      ok: false,
      error: 'device_ownership must be company_owned|personal_byod',
    };
  }
  return {
    ok: true,
    data: {
      employee_id: String(body.employee_id),
      legal_first_name: String(body.legal_first_name),
      legal_last_name: String(body.legal_last_name),
      preferred_name: (body.preferred_name as string) ?? null,
      work_email: (body.work_email as string) ?? null,
      personal_email: String(body.personal_email),
      start_date: String(body.start_date),
      primary_role_id: String(body.primary_role_id),
      secondary_role_ids: Array.isArray(body.secondary_role_ids)
        ? (body.secondary_role_ids as string[])
        : [],
      manager_employee_id: (body.manager_employee_id as string) ?? null,
      location: (body.location as string) ?? null,
      country: (body.country as string) ?? 'US',
      employment_type: body.employment_type as HrisHiredBody['employment_type'],
      device_preference:
        (body.device_preference as HrisHiredBody['device_preference']) ?? null,
      device_ownership: ownership,
      entity_id: String(body.entity_id),
      cost_center: (body.cost_center as string) ?? null,
      job_title: String(body.job_title),
    },
  };
}

export function validateTerminatedPayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisTerminatedBody } | { ok: false; error: string } {
  const missing = [
    requireString(body.employee_id, 'employee_id'),
    requireString(body.entity_id, 'entity_id'),
    requireString(body.effective_at, 'effective_at'),
    requireString(body.termination_type, 'termination_type'),
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return {
    ok: true,
    data: {
      employee_id: String(body.employee_id),
      entity_id: String(body.entity_id),
      effective_at: String(body.effective_at),
      last_working_day: (body.last_working_day as string) ?? null,
      termination_type:
        body.termination_type as HrisTerminatedBody['termination_type'],
      retain_mailbox_days:
        typeof body.retain_mailbox_days === 'number'
          ? body.retain_mailbox_days
          : 30,
      device_ownership: body.device_ownership as
        | HrisTerminatedBody['device_ownership']
        | undefined,
    },
  };
}

export function validateUpdatedPayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisUpdatedBody } | { ok: false; error: string } {
  const missing = [
    requireString(body.employee_id, 'employee_id'),
    requireString(body.entity_id, 'entity_id'),
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return {
    ok: true,
    data: {
      employee_id: String(body.employee_id),
      entity_id: String(body.entity_id),
      legal_first_name: (body.legal_first_name as string) ?? undefined,
      legal_last_name: (body.legal_last_name as string) ?? undefined,
      preferred_name: (body.preferred_name as string) ?? null,
      work_email: (body.work_email as string) ?? null,
      personal_email: (body.personal_email as string) ?? null,
      manager_employee_id: (body.manager_employee_id as string) ?? null,
      location: (body.location as string) ?? null,
      job_title: (body.job_title as string) ?? null,
      prior_entity_id: (body.prior_entity_id as string) ?? null,
    },
  };
}

export function validateRoleChangedPayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisRoleChangedBody } | { ok: false; error: string } {
  const missing = [
    requireString(body.employee_id, 'employee_id'),
    requireString(body.entity_id, 'entity_id'),
    requireString(body.primary_role_id, 'primary_role_id'),
    requireString(body.effective_date, 'effective_date'),
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return {
    ok: true,
    data: {
      employee_id: String(body.employee_id),
      entity_id: String(body.entity_id),
      primary_role_id: String(body.primary_role_id),
      secondary_role_ids: Array.isArray(body.secondary_role_ids)
        ? (body.secondary_role_ids as string[])
        : [],
      effective_date: String(body.effective_date),
      prior_primary_role_id: (body.prior_primary_role_id as string) ?? null,
      prior_entity_id: (body.prior_entity_id as string) ?? null,
      job_title: (body.job_title as string) ?? null,
    },
  };
}

export function validateCancelledHirePayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisCancelledHireBody } | { ok: false; error: string } {
  const missing = [
    requireString(body.employee_id, 'employee_id'),
    requireString(body.entity_id, 'entity_id'),
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return {
    ok: true,
    data: {
      employee_id: String(body.employee_id),
      entity_id: String(body.entity_id),
      reason: (body.reason as string) ?? null,
    },
  };
}

export function validateRehirePayload(
  body: Record<string, unknown>,
): { ok: true; data: HrisRehireBody } | { ok: false; error: string } {
  const hired = validateHiredPayload(body);
  if (!hired.ok) return hired;
  return {
    ok: true,
    data: {
      ...hired.data,
      prior_employee_id: (body.prior_employee_id as string) ?? null,
    },
  };
}

export function buildEnvelope(
  input: PublishHrisEventInput,
): HrisEventEnvelope & { payload: Record<string, unknown> } {
  const event_id = input.event_id || randomUUID();
  const correlation_id = input.correlation_id || randomUUID();
  const idempotency_key =
    input.idempotency_key ||
    `${input.event_type}:${input.payload.employee_id ?? 'unknown'}:${event_id}`;
  return {
    event_id,
    event_type: input.event_type,
    event_time: input.event_time || new Date().toISOString(),
    correlation_id,
    entity_id: input.entity_id,
    producer: 'hris',
    schema_version: input.schema_version || '1.0.0',
    idempotency_key,
    payload: input.payload,
  };
}

/** Publish to identity_hris_outbox (Integration Layer attachment). */
export async function publishHrisEvent(
  input: PublishHrisEventInput,
): Promise<PublishResult> {
  if (!input.entity_id?.trim()) {
    return { ok: false, error: 'entity_id required', code: 'entity_id_null' };
  }

  if (
    input.event_type === 'hris.employee.hired' ||
    input.event_type === 'hris.employee.rehire'
  ) {
    const v =
      input.event_type === 'hris.employee.rehire'
        ? validateRehirePayload(input.payload)
        : validateHiredPayload(input.payload);
    if (!v.ok) return { ok: false, error: v.error, code: 'schema_invalid' };
  }
  if (input.event_type === 'hris.employee.terminated') {
    const v = validateTerminatedPayload(input.payload);
    if (!v.ok) return { ok: false, error: v.error, code: 'schema_invalid' };
  }
  if (input.event_type === 'hris.employee.updated') {
    const v = validateUpdatedPayload(input.payload);
    if (!v.ok) return { ok: false, error: v.error, code: 'schema_invalid' };
  }
  if (input.event_type === 'hris.employee.role_changed') {
    const v = validateRoleChangedPayload(input.payload);
    if (!v.ok) return { ok: false, error: v.error, code: 'schema_invalid' };
  }
  if (input.event_type === 'hris.employee.cancelled_hire') {
    const v = validateCancelledHirePayload(input.payload);
    if (!v.ok) return { ok: false, error: v.error, code: 'schema_invalid' };
  }

  const env = buildEnvelope(input);
  try {
    const sb = await createPersistClient();
    const { error } = await sb.from('identity_hris_outbox').insert({
      event_id: env.event_id,
      event_type: env.event_type,
      event_time: env.event_time,
      correlation_id: env.correlation_id,
      entity_id: env.entity_id,
      producer: env.producer,
      schema_version: env.schema_version,
      idempotency_key: env.idempotency_key,
      payload: env.payload,
      status: 'pending',
    });
    if (error) {
      if (
        error.message.includes('duplicate') ||
        error.code === '23505' ||
        error.message.includes('unique')
      ) {
        return {
          ok: true,
          event_id: env.event_id,
          correlation_id: env.correlation_id,
          duplicate: true,
        };
      }
      return { ok: false, error: error.message };
    }
    return {
      ok: true,
      event_id: env.event_id,
      correlation_id: env.correlation_id,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'publish failed',
    };
  }
}
