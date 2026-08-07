/** Public identity + device lifecycle surface. */

export { IDENTITY_CONTRACT_VERSION } from '@/lib/identity/types';
export type {
  CaseType,
  DeviceOwnership,
  DevicePath,
  HrisEventType,
  HrisHiredBody,
  HrisTerminatedBody,
  HrisUpdatedBody,
  HrisRoleChangedBody,
  HrisCancelledHireBody,
  HrisRehireBody,
  WorkerCommand,
} from '@/lib/identity/types';
export { resolveDevicePath, assertNoHardwareForByod } from '@/lib/identity/device-path';
export { assertWipeAllowed, isFullWipeAction } from '@/lib/identity/wipe-guard';
export {
  assertAiActionAllowed,
  aiForbidList,
  classifyAiAction,
} from '@/lib/identity/ai-policy';
export { getIdentityFlags, assertFlagEnabled } from '@/lib/identity/flags';
export {
  getEntityCutoverAllowlist,
  isEntityCutoverEnabled,
  isGraphUserLiveEnabled,
} from '@/lib/identity/flags';
export type { IdentityFlags } from '@/lib/identity/flags';
export {
  publishHrisEvent,
  validateHiredPayload,
  validateTerminatedPayload,
  validateUpdatedPayload,
  validateRoleChangedPayload,
  validateCancelledHirePayload,
  validateRehirePayload,
} from '@/lib/identity/events';
export {
  openJoinerCase,
  openLeaverCase,
  openMoverCase,
  openCancelledHireCase,
  openRehireCase,
  handleEmployeeUpdated,
  processHrisOutbox,
} from '@/lib/identity/orchestrator';
export { runIdentityWorkerBatch } from '@/lib/identity/workers/dispatch';
export { seedEntityIdentityBootstrap } from '@/lib/identity/fo24';
