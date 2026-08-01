/**
 * Mobile App Store Launch — operational phases for Shared Services → Technology.
 * Full narrative checklist: docs/MOBILE_APP_STORE_LAUNCH_PLAYBOOK.md
 */

export const MOBILE_LAUNCH_DOC = 'docs/MOBILE_APP_STORE_LAUNCH_PLAYBOOK.md';

export type MobileLaunchPhase = {
  id: string;
  title: string;
  summary: string;
  items: string[];
};

export const MOBILE_LAUNCH_PHASES: MobileLaunchPhase[] = [
  {
    id: 'preflight',
    title: '0 · Preflight / accounts / legal',
    summary:
      'Organization Apple membership, Play verification, legal URLs, billing model, demo review account.',
    items: [
      'Apple Developer Organization Active + Team ID (not Individual for company apps)',
      'D-U-N-S matched to legal filings when Apple requires it',
      'Google Play Console paid + org / authorized-rep verification complete',
      'Expo login works; Stripe + Supabase + privacy URL ready',
      'Bundle/package ID locked; iOS billing path decided (IAP vs web handoff)',
      'Demo review account plan (email + password + how-to notes)',
    ],
  },
  {
    id: 'eas',
    title: '1 · Expo / EAS project link',
    summary: 'Link repo to expo.dev, credentials, production profiles, ASC submit IDs.',
    items: [
      'eas login + eas init → extra.eas.projectId set',
      'eas.json production autoIncrement; iOS submit appleId / appleTeamId / ascAppId',
      'Interactive eas credentials -p ios (or ASC API .p8 — never commit private key)',
      'EAS manages Android upload keystore',
    ],
  },
  {
    id: 'secrets',
    title: '2 · Env & secrets',
    summary: 'EXPO_PUBLIC_* in EAS only; Stripe/Resend/service_role stay on Supabase Edge.',
    items: [
      'EAS production: SUPABASE_URL, ANON_KEY, APP_URL, PRIVACY_POLICY_URL',
      'Edge: STRIPE_*, RESEND_*, SEND_EMAIL_HOOK_SECRET, APP_URL',
      'Never put service_role or Stripe secrets in the mobile binary',
      'Roll any live key pasted in chat before traffic',
    ],
  },
  {
    id: 'auth-email',
    title: '3 · Auth emails (hook · Resend · rate limits)',
    summary:
      'auth-send-email hook → Resend. Raise GoTrue email rate limit (CLI push often no-ops without SMTP).',
    items: [
      'Resend domain verified; branded From address',
      'Send Email Hook deployed + SEND_EMAIL_HOOK_SECRET pushed',
      'Site URL + redirect allow-list (web + deep link scheme)',
      'Raise rate_limit_email_sent in Dashboard/API (default 2/hr blocks review)',
      'App UX: email not confirmed resend + rate-limit messaging + KeyboardAvoidingView',
      'Manually confirm App Review demo user in Auth Admin',
    ],
  },
  {
    id: 'stripe',
    title: '4 · Stripe test → live cutover',
    summary:
      'Mode-agnostic Checkout/Portal/webhooks. Recreate Live prices; new whsec; portal plan switches.',
    items: [
      'Test products, webhook events, portal, 4242 smoke',
      'Live: verification + bank; recreate all prices (incl. one-time SKUs)',
      'Live webhook + Customer Portal with all live prices',
      'Set Edge secrets; leave test webhook alone',
      'Live card smoke + webhook deliveries green',
    ],
  },
  {
    id: 'ios',
    title: '5 · iOS (ASC · screenshots · TestFlight · review)',
    summary:
      'App ID → ASC app → EAS build/submit → metadata → privacy → Submit. Screenshot pixel sizes matter.',
    items: [
      'Register App ID; create ASC app; paste ascAppId into eas.json',
      'Production IPA + TestFlight processing',
      'Metadata (or eas metadata:push); Pricing Free if no IAP',
      'Screenshots at ASC-accepted sizes (e.g. 1284×2778 — 1290×2796 may reject)',
      'App Privacy nutrition labels + export compliance',
      'Demo credentials in App Review Information → Submit for Review',
    ],
  },
  {
    id: 'android',
    title: '6 · Android (Play · graphics · AAB · review)',
    summary:
      'Create app → listing/graphics → Data safety → Internal AAB → promote to production.',
    items: [
      'Create app when verification unlocks; package set on first AAB',
      'Icon 512×512 + feature graphic 1024×500 + 1080×1920 screenshots',
      'Content rating, audience, Data safety aligned to privacy policy',
      'Upload AAB (copy to Desktop if browser path fails) → Internal testing first',
      'Deobfuscation / “too large to preview” warnings — usually non-blocking',
      'Promote track → production review',
    ],
  },
  {
    id: 'go-live',
    title: '7 · Post-approval go-live',
    summary: 'Store live + Stripe live before paid traffic; support path staffed; secrets rolled.',
    items: [
      'Ready for Sale / Play production live; store URLs saved',
      'Stripe live cutover complete before real charges',
      'Support + review reply within ~24h',
      'Phase-2 backlog filed; playbook § errors updated',
    ],
  },
  {
    id: 'smoke',
    title: '8 · Post-launch smoke tests',
    summary: 'Production store builds only — auth, core flow, billing per platform.',
    items: [
      'Signup confirm email; unconfirmed resend path',
      'Two-party core product flow + PDF email',
      'Android/web Stripe Checkout + Portal; iOS web billing handoff',
      'One-time SKUs (if any) grant correctly',
      'Clean-install crash-free; listing links resolve',
    ],
  },
];

export type MobileLaunchErrorRow = {
  symptom: string;
  fix: string;
};

export const MOBILE_LAUNCH_ERRORS: MobileLaunchErrorRow[] = [
  {
    symptom: 'Email rate limit / over_email_send_rate_limit',
    fix: 'Raise rate_limit_email_sent in Supabase Auth Rate Limits (or Management API). Hook does not bypass GoTrue.',
  },
  {
    symptom: 'config push “Auth up to date” but limit still 2/hr',
    fix: 'Hook-only setups skip CLI email_sent — patch Dashboard/API directly.',
  },
  {
    symptom: 'Email not confirmed',
    fix: 'Resend confirmation in-app, or Auth Admin → Confirm user (review accounts).',
  },
  {
    symptom: 'ASC screenshot reject',
    fix: 'Use exact accepted pixels (often 1284×2778). Do not upload 1290×2796 “6.7"” folders.',
  },
  {
    symptom: 'Play “file too large to preview”',
    fix: 'Ignore preview; confirm AAB release processed. Copy .aab to Desktop if Choose File fails.',
  },
  {
    symptom: 'Play deobfuscation / mapping warning',
    fix: 'Optional mapping upload from EAS; usually non-blocking for v1.',
  },
  {
    symptom: 'Newer build available (TestFlight)',
    fix: 'Install latest processing build; expire confusing old builds.',
  },
  {
    symptom: 'Stripe webhook 500 / invalid email',
    fix: 'Ensure Checkout/customer email valid; fix webhook validation; replay delivery. Match live whsec to live key.',
  },
  {
    symptom: 'Demo mode on store build',
    fix: 'EXPO_PUBLIC_SUPABASE_* missing at EAS build time — set env and rebuild.',
  },
  {
    symptom: 'Keyboard covers inputs',
    fix: 'KeyboardAvoidingView + ScrollView + keyboardShouldPersistTaps on auth/billing forms.',
  },
];
