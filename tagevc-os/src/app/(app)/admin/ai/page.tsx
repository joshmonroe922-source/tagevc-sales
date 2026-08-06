import Link from 'next/link';

import { saveOrgAiSettingsFormAction } from '@/app/(app)/admin/ai/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  claudeConfigured,
  claudeLiveEnabled,
  xaiConfigured,
} from '@/lib/ai/flags';
import { getAiOrgSettings } from '@/lib/ai/settings';
import { requirePermission } from '@/lib/rbac/session';

export default async function AdminAiPage() {
  const profile = await requirePermission('admin:users');
  const entityId = profile.entity_id || 'ENT-FIRM';
  const org = await getAiOrgSettings(entityId);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
          <Link
            href="/settings/ai"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            User AI preference →
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Org AI defaults
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Org-wide default for Think Tank (user override still wins). Copilot is
          out of scope for this toggle. See{' '}
          <code className="text-xs">docs/AI_MODEL_PREFERENCE.md</code>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default provider · {entityId}</CardTitle>
          <CardDescription>
            Runtime: Grok key {xaiConfigured() ? 'present' : 'missing'} · Claude
            key {claudeConfigured() ? 'present' : 'missing'} · Claude LIVE{' '}
            {claudeLiveEnabled() ? 'on' : 'off'}. Source: {org.source}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={saveOrgAiSettingsFormAction}
            className="grid max-w-lg gap-4"
          >
            <input type="hidden" name="entityId" value={entityId} />
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">
                Org default AI model
              </span>
              <select
                name="defaultProvider"
                defaultValue={org.defaultProvider}
                className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3"
              >
                <option value="grok">Grok (platform default)</option>
                <option value="claude">Claude (optional)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="claudeFeatureEnabled"
                value="1"
                defaultChecked={org.claudeFeatureEnabled}
              />
              Show Claude in user settings (feature flag; still no spend without
              key + LIVE)
            </label>
            <Button type="submit" className="w-fit">
              Save org defaults
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
