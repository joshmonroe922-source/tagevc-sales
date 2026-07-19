import { Link } from 'react-router-dom';
import type { SalesUser } from '../lib/types';

type Section = 'controls' | 'tasks';

const SECTION_COPY: Record<
  Section,
  { title: string; description: string }
> = {
  controls: {
    title: 'Plan & audit',
    description:
      'Administrative controls across Tage parent and subsidiaries — office operations, facilities, vendors, records management, and periodic review.',
  },
  tasks: {
    title: 'Tasks',
    description:
      'Open administrative tasks generated from incomplete controls, assignable to shared-services owners and synced to Microsoft To Do.',
  },
};

type Props = {
  salesUser: SalesUser;
  section: Section;
};

/** Placeholder for Administrative audit/task modules not yet implemented. */
export function AdministrativeStubSectionPage({ salesUser, section }: Props) {
  const copy = SECTION_COPY[section];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">
            {copy.description} Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/administrative" className="btn ghost">
            Overview
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <div className="portal-stub">
        <p className="portal-stub-eyebrow">Coming soon</p>
        <h2>Administrative {copy.title.toLowerCase()} are on the roadmap</h2>
        <p className="muted">
          This portal shell is live for access control and navigation. Use{' '}
          <Link to="/sales/administrative/tickets">Tickets</Link> for general admin requests, or{' '}
          <strong>Add To Do</strong> in the header to park work in Microsoft To Do.
        </p>
      </div>
    </>
  );
}
