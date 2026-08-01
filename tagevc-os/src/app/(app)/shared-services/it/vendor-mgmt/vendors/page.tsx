import { redirect } from 'next/navigation';

/** Canonical Vendor Management lives under Shared Services Operations. */
export default function VendorMgmtRedirect() {
  redirect('/shared-services/ops/vendor-management/vendors');
}
