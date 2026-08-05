/** Minimal ECC types for the slim enrollments API surface. */

export type EmailPermission = 'opted_in' | 'opted_out' | 'unknown';

export type ConsentGateResult =
  | { allow: true }
  | { allow: false; reason: string; code: string };

export type MutexConflict = {
  code: 'CONFLICT';
  blockingEnrollmentIds: string[];
  message: string;
};
