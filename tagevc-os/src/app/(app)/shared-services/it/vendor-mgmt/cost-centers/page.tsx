import { redirect } from 'next/navigation';

/** Canonical Vendor Management lives under Shared Services Operations. */
export default function VendorMgmtCostCentersRedirect() {
  redirect('/shared-services/ops/vendor-management/cost-centers');
}
