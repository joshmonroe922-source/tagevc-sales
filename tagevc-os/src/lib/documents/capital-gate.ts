import { CAPITAL_DOC_TYPES, type DocType } from '@/lib/types/enums';

export function isCapitalDocument(docType: DocType): boolean {
  return (CAPITAL_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * Human gate: capital docs (TS/SPA/PSA/wire) never silent-send.
 * Aligns with Shared Services forbid-list `docusign_capital_send`.
 */
export function assertHumanCanSend(args: {
  docType: DocType;
  sentBy: string | null | undefined;
  explicitHumanSend: boolean;
}): void {
  if (!isCapitalDocument(args.docType)) return;
  if (!args.explicitHumanSend) {
    throw new Error(
      'Capital documents require explicit human Click Send (never silent send)',
    );
  }
  if (!args.sentBy?.trim()) {
    throw new Error('Capital DocuSign Send requires a human sender identity');
  }
}
