import { Badge } from '@/components/ui/badge';
import {
  entityCodeHint,
  entityDisplayName,
  type EntityDisplayInput,
} from '@/lib/entities/display-name';
import { cn } from '@/lib/utils';

type Props = {
  entity: EntityDisplayInput;
  /** Show ENT-* code as muted tooltip / title only — never as primary text. */
  showCodeTitle?: boolean;
  className?: string;
  variant?: 'outline' | 'secondary' | 'default';
};

/**
 * Company badge for tables, cards, and filters.
 * Always renders the human company name (never raw ENT-* as the label).
 */
export function EntityBadge({
  entity,
  showCodeTitle = true,
  className,
  variant = 'outline',
}: Props) {
  const label = entityDisplayName(entity);
  const code =
    typeof entity === 'string'
      ? entityCodeHint(entity)
      : entityCodeHint(entity?.entity_id);

  return (
    <Badge
      variant={variant}
      className={cn('font-normal', className)}
      title={showCodeTitle && code ? code : undefined}
    >
      {label}
    </Badge>
  );
}
