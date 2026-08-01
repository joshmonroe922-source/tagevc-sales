export { VM_SPINE_VERSION } from '@/lib/vendor-mgmt/types';
export * from '@/lib/vendor-mgmt/entities';
export * from '@/lib/vendor-mgmt/math';
export * from '@/lib/vendor-mgmt/permissions';
export {
  provisionVendorMgmtForEntity,
  type VmProvisionResult,
} from '@/lib/vendor-mgmt/provision';
export {
  terminateEmployee,
  onboardEmployee,
  applyBirthrightForEmployee,
  transferEmployeeRole,
} from '@/lib/vendor-mgmt/lifecycle';
export {
  buildDashboard,
  buildSpendSummary,
  buildBudgetVsActual,
  buildCpeReport,
  buildRpeReport,
  buildChargebackAllocations,
  simulateHire,
} from '@/lib/vendor-mgmt/metrics';
export { evaluateAlertRules, persistTriggeredAlerts } from '@/lib/vendor-mgmt/alerts';
