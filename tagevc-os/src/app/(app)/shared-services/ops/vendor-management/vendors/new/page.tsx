import { VendorForm } from '@/components/vendor-mgmt/vendor-form';
import { VmShell } from '@/components/vendor-mgmt/vm-shell';
import { requireVmSession } from '@/lib/vendor-mgmt/session';
import { hasValidVmStepUp } from '@/lib/vendor-mgmt/step-up';

export default async function NewVendorPage() {
  const session = await requireVmSession('create_vendor');
  const stepUpActive = await hasValidVmStepUp(session.email);
  return (
    <VmShell
      title="Add vendor"
      description="Create a live stack row for an entity. Computed monthly spend appears after save."
      active="/shared-services/ops/vendor-management/vendors"
      adminRole={session.adminRole}
    >
      <VendorForm
        sessionEmail={session.email}
        stepUpActive={stepUpActive}
        entityLocked={session.filterEntityId}
      />
    </VmShell>
  );
}
