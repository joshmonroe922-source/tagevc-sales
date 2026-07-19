import { Link } from 'react-router-dom';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Placeholder for attorney contract-review queue (not operational checklist work). */
export function LegalContractsPage({ salesUser }: Props) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contracts</h1>
          <p className="muted">
            Staff Legal queue for document and contract review. Operational hygiene lives
            under Corporate audit; renewals under Filings. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/legal/controls" className="btn ghost">
            Corporate audit
          </Link>
          <Link to="/sales/legal" className="btn ghost">
            Overview
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Coming soon</h2>
        </div>
        <p className="muted">
          This workspace will hold contract intake, attorney assignment, and review status
          for MSAs, vendor agreements, employment forms, and deal documents — the work that
          should stay with Legal headcount rather than checklist automation.
        </p>
        <ul className="hr-meta-list">
          <li>Vendor / customer agreement review</li>
          <li>Intercompany and subsidiary agreements</li>
          <li>Employment / executive agreement templates</li>
          <li>Dispute-related document packs</li>
        </ul>
      </section>
    </>
  );
}
