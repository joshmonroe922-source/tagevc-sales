import Link from 'next/link';

import { saveUserAiPreferenceFormAction } from '@/app/(app)/settings/ai/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  claudeLiveEnabled,
  claudeSelectableInSettings,
  xaiConfigured,
} from '@/lib/ai/flags';
import {
  getAiOrgSettings,
  getAiUserPrefs,
  resolveSessionAiProvider,
} from '@/lib/ai/settings';
import { getSessionContext } from '@/lib/rbac/session';

export default async function AiSettingsPage() {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const entityId = ctx.profile.entity_id || 'ENT-FIRM';
  const [org, user, resolved] = await Promise.all([
    getAiOrgSettings(entityId),
    getAiUserPrefs(ctx.profile.id),
    resolveSessionAiProvider({
      userId: ctx.profile.id,
      entityId,
    }),
  ]);

  const showClaude = claudeSelectableInSettings(org.claudeFeatureEnabled);
  const selectValue = user.preferredProvider ?? 'inherit';

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/settings/notifications"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Notifications
          </Link>
          <Link
            href="/think-tank"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Open Think Tank →
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          AI model preference
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Preferred model for Think Tank and related in-app AI. Cascade: your
          choice → org default → Grok. Microsoft Copilot stays in M365 (not an
          in-app toggle).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferred AI model</CardTitle>
          <CardDescription>
            Effective now:{' '}
            <span className="font-medium text-foreground">
              {resolved.provider}
            </span>{' '}
            ({resolved.source}
            {org.source !== 'db' ? ` · org via ${org.source}` : ''}). Grok
            key: {xaiConfigured() ? 'present' : 'missing'}. Claude LIVE:{' '}
            {claudeLiveEnabled() ? 'on' : 'off'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={saveUserAiPreferenceFormAction}
            className="grid max-w-lg gap-4"
          >
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">
                Preferred AI model
              </span>
              <select
                name="preferredProvider"
                defaultValue={selectValue}
                className="mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3"
              >
                <option value="inherit">
                  Inherit org default ({org.defaultProvider})
                </option>
                <option value="grok">Grok (xAI)</option>
                {showClaude ? (
                  <option value="claude">Claude (Anthropic)</option>
                ) : null}
              </select>
            </label>
            {!showClaude ? (
              <p className="text-xs text-muted-foreground">
                Claude appears here when the org enables the feature flag or
                sets <code className="text-[11px]">ANTHROPIC_API_KEY</code> /
                <code className="text-[11px]">AI_CLAUDE_FEATURE</code>. Spend
                still requires <code className="text-[11px]">ANTHROPIC_LIVE=1</code>.
              </p>
            ) : !claudeLiveEnabled() ? (
              <p className="text-xs text-muted-foreground">
                Claude is selectable but gated — calls fall back to Grok until
                LIVE is on.
              </p>
            ) : null}
            <Button type="submit" className="w-fit">
              Save preference
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
