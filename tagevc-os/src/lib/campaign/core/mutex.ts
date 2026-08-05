import type { MutexConflict } from './types';

export type ActiveEnrollment = {
  id: string;
  journeyId: string;
  mutexGroup?: string | null;
};

export type MutexPolicy = {
  maxPerGroup: number;
  maxGlobal: number;
  onConflict: 'block' | 'replace' | 'queue';
};

export const DEFAULT_MUTEX_POLICY: MutexPolicy = {
  maxPerGroup: 1,
  maxGlobal: 3,
  onConflict: 'block',
};

export function checkMutex(input: {
  active: ActiveEnrollment[];
  nextMutexGroup?: string | null;
  policy?: MutexPolicy;
}): { ok: true } | (MutexConflict & { ok: false }) {
  const policy = input.policy ?? DEFAULT_MUTEX_POLICY;
  if (input.active.length >= policy.maxGlobal) {
    return {
      ok: false,
      code: 'CONFLICT',
      blockingEnrollmentIds: input.active.map((a) => a.id),
      message: `Max ${policy.maxGlobal} active sequences reached`,
    };
  }
  if (input.nextMutexGroup) {
    const same = input.active.filter(
      (a) => a.mutexGroup === input.nextMutexGroup,
    );
    if (same.length >= policy.maxPerGroup) {
      return {
        ok: false,
        code: 'CONFLICT',
        blockingEnrollmentIds: same.map((a) => a.id),
        message: `Already enrolled in mutex group ${input.nextMutexGroup}`,
      };
    }
  }
  return { ok: true };
}
