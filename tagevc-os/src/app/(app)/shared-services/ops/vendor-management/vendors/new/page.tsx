import { VendorForm } from '@/components/vendor-mgmt/vendor-form';
import { VmShell } from '@/components/vendor-mgmt/vm-shell';
import { requireVmSession } from '@/lib/vendor-mgmt/session';

export default async function NewVendorPage() {
  const session = await requireVmSession('create_vendor');
  return (
    <VmShell
      title="Add vendor"
      description="Create a live stack row for an entity. Computed monthly spend appears after save."
      active="/shared-services/ops/vendor-management/vendors"
      adminRole={session.adminRole}
    >
      <VendorForm entityLocked={session.filterEntityId} />
    </VmShell>
  );
}
