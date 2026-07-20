import Link from 'next/link';
import StubPage from '@/components/layout/stub-page';
import { Badge } from '@/components/ui/badge';

export default function DocuSignModulePage() {
  return (
    <div className="space-y-4">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Legal</Badge>
        <Badge variant="secondary">Phase 21+</Badge>
      </div>
      <StubPage
        title="DocuSign integration"
        description="Architecture for real DocuSign Connect + envelopes under Shared Services · Legal. Mock send/webhook remain on Documents until Phase 21. See docs/OS_DOCUSIGN.md."
      />
    </div>
  );
}
