import { redirect } from 'next/navigation';

/** Canonical partner stack UI lives at technology-stack. */
export default function TechnologyPartnerStackRedirect() {
  redirect('/shared-services/it/technology-stack');
}
