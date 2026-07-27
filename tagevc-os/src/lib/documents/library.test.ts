import { describe, expect, it } from 'vitest';
import {
  FIRM_DOCUMENT_ENTITY_ID,
  entityFolderPath,
  isDocumentLibraryEntityType,
  isFirmDocumentEntity,
  listEntityLibraryPaths,
} from '@/lib/documents/library';

describe('document library firm scope', () => {
  it('treats ENT-FIRM as the firm document entity', () => {
    expect(isFirmDocumentEntity(FIRM_DOCUMENT_ENTITY_ID)).toBe(true);
    expect(isFirmDocumentEntity('ENT-R619')).toBe(false);
    expect(isDocumentLibraryEntityType('Firm')).toBe(true);
    expect(isDocumentLibraryEntityType('Subsidiary')).toBe(true);
    expect(isDocumentLibraryEntityType('Portfolio')).toBe(false);
  });

  it('uses the same folder taxonomy under ENT-FIRM', () => {
    expect(entityFolderPath('ENT-FIRM', '01_Corporate', 'charter.pdf')).toBe(
      '/Entities/ENT-FIRM/01_Corporate/charter.pdf',
    );
    expect(listEntityLibraryPaths('ENT-FIRM')).toContain(
      '/Entities/ENT-FIRM/07_Signed',
    );
  });
});
