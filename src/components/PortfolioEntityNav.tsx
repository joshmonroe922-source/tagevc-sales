import { Link } from 'react-router-dom';
import {
  PORTFOLIO_ENTITY_SECTIONS,
  portfolioEntityPath,
  type PortfolioEntitySection,
} from '../lib/portfolioEntity';

type Props = {
  entityId: string;
  active: PortfolioEntitySection;
};

/** Section switcher for Manage Portfolio entity detail. */
export function PortfolioEntityNav({ entityId, active }: Props) {
  return (
    <nav className="seg recruit619-seg" aria-label="Portfolio entity sections">
      {PORTFOLIO_ENTITY_SECTIONS.map((s) => (
        <Link
          key={s.id}
          to={portfolioEntityPath(entityId, s.id)}
          className={active === s.id ? 'active' : undefined}
          aria-current={active === s.id ? 'page' : undefined}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
