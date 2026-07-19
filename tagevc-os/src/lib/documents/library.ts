import type { EntityDocFolder } from '@/lib/types';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

export const FIRM_FOLDERS = ['Firm/Corporate', 'Firm/IC_Memos'] as const;

export const FOLDER_LABELS: Record<EntityDocFolder, string> = {
  '01_Corporate': '01 Corporate — charter, cap table, good standing',
  '02_Deal': '02 Deal — TS/SPA/SAFE, side letters, wire',
  '03_DD': '03 DD — data room, QoE, reports',
  '04_Financials': '04 Financials — packs, audits, models',
  '05_HR': '05 HR — employment (restricted)',
  '06_Ops': '06 Ops — playbooks, GTM, board decks',
  '07_Signed': '07 Signed — DocuSign completed + certificates',
};

export function entityFolderPath(
  entityId: string,
  folder: EntityDocFolder,
  fileName?: string,
): string {
  const base = `/Entities/${entityId}/${folder}`;
  return fileName ? `${base}/${fileName}` : base;
}

export function listEntityLibraryPaths(entityId: string): string[] {
  return ENTITY_DOC_FOLDERS.map((f) => entityFolderPath(entityId, f));
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
}
