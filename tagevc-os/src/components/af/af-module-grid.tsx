'use client';

import { ModuleLinkBoard } from '@/components/platform/module-link-board';

export type AfModuleItem = {
  id: string;
  label: string;
  path: string;
  description: string;
};

/**
 * A&F / Personal module hubs — Cards | List via platform ModuleLinkBoard.
 */
export function AfModuleGrid({
  modules,
  qs = '',
  surface = 'af-modules',
  columns = 3,
}: {
  modules: readonly AfModuleItem[];
  qs?: string;
  /** Unique localStorage surface key */
  surface?: string;
  columns?: 2 | 3 | 4;
}) {
  return (
    <ModuleLinkBoard
      surface={surface}
      columns={columns}
      items={modules.map((m) => ({
        id: m.id,
        label: m.label,
        href: `${m.path}${qs}`,
        description: m.description,
      }))}
    />
  );
}
