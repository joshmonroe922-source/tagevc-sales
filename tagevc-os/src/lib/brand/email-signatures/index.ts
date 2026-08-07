export {
  PARENT_ENTITY_ID,
  portfolioEntityIds,
  subsidiaryEntityIds,
  signatureLogoBar,
  orderedLogoBarIds,
  missingWebsiteNotes,
  type SignatureLogoLink,
} from '@/lib/brand/email-signatures/portfolio';
export {
  renderEmailSignatureHtml,
  renderEmailSignatureFragment,
  KNOWN_SIGNATURE_PEOPLE,
  type SignaturePerson,
} from '@/lib/brand/email-signatures/render';
export {
  applyEntityEmailSignature,
  buildSignatureForEmployee,
  exoAdminSteps,
  type ApplySignatureResult,
} from '@/lib/brand/email-signatures/apply-graph';
