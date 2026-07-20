import Link from 'next/link';
import StubPage from '@/components/layout/stub-page';
import { Badge } from '@/components/ui/badge';

export default function ItAssetsModulePage() {
  return (
    <div className="space-y-4">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">IT</Badge>
        <Badge variant="secondary">Phase 21+</Badge>
      </div>
      <StubPage
        title="Hardware, software & licensing"
        description="Asset assignment, SaaS seat tracking, and onboarding/offboarding hooks under Shared Services · IT. Schema stub: phase20_it_assets.sql. See docs/OS_IT_ASSETS.md."
      />
    </div>
  );
}
