/**
 * Export email signatures to local Marketing SoT + Downloads.
 * Usage: npx tsx scripts/brand-collateral/export-email-signatures.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KNOWN_SIGNATURE_PEOPLE,
  PARENT_ENTITY_ID,
  portfolioEntityIds,
  renderEmailSignatureFragment,
  renderEmailSignatureHtml,
  signatureLogoBar,
  type SignaturePerson,
} from '../../src/lib/brand/email-signatures';
import { entityDisplayName } from '../../src/lib/entities/display-name';
import { getEntityBrandPresence } from '../../src/lib/shared-services/entity-brand-presence';

const REPO = join(__dirname, '../..');
const SOT = join(REPO, 'brand/marketing-sot/email-signatures');
const DOWNLOADS = join(
  process.env.HOME || '/Users/joshmonroe',
  'Downloads/Brand Collateral/Email Signatures',
);

const TEMPLATE_PEOPLE: SignaturePerson[] = portfolioEntityIds().map((id) => {
  const label = entityDisplayName(id);
  const short =
    id === 'ENT-FIRM'
      ? 'Tage VC'
      : label;
  return {
    fullName: '{{Full Name}}',
    jobTitle: '{{Job Title}}',
    email: `hello@${hostFor(id)}`,
    entityId: id,
    companyLine: short,
  };
});

function hostFor(entityId: string): string {
  const u = getEntityBrandPresence(entityId)?.website_url || 'tagevc.com';
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return 'tagevc.com';
  }
}

function writePerson(dir: string, slug: string, person: SignaturePerson) {
  mkdirSync(dir, { recursive: true });
  const full = renderEmailSignatureHtml(person);
  const frag = renderEmailSignatureFragment(person);
  writeFileSync(join(dir, `${slug}.html`), full, 'utf8');
  writeFileSync(join(dir, `${slug}.fragment.html`), frag, 'utf8');
  writeFileSync(
    join(dir, `${slug}.meta.json`),
    JSON.stringify(
      {
        person,
        logo_bar: signatureLogoBar(person.entityId),
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function main() {
  mkdirSync(SOT, { recursive: true });
  mkdirSync(DOWNLOADS, { recursive: true });

  // Josh first
  for (const person of KNOWN_SIGNATURE_PEOPLE) {
    const slug = person.fullName.replace(/\s+/g, '-');
    const joshDirDl = join(DOWNLOADS, person.fullName);
    const joshDirSot = join(SOT, 'people', slug);
    writePerson(joshDirDl, slug, person);
    writePerson(joshDirSot, slug, person);
    // Convenience root copies Josh asked for
    writeFileSync(
      join(DOWNLOADS, `${person.fullName} Email Signature.html`),
      renderEmailSignatureHtml(person),
      'utf8',
    );
    writeFileSync(
      join(
        process.env.HOME || '/Users/joshmonroe',
        'Downloads',
        `${person.fullName} Email Signature.html`,
      ),
      renderEmailSignatureHtml(person),
      'utf8',
    );
  }

  for (const person of TEMPLATE_PEOPLE) {
    const slug = person.entityId;
    writePerson(join(SOT, 'templates', slug), slug, person);
    writePerson(join(DOWNLOADS, 'templates', slug), slug, person);
  }

  const peopleList = KNOWN_SIGNATURE_PEOPLE.map(
    (p) => `- **${p.fullName}** (${p.jobTitle}) — \`${p.email}\` / ${p.entityId}`,
  ).join('\n');

  const readme = `# Email Signatures

## Ready now

${peopleList}

1. Open \`{Name} Email Signature.html\` in Chrome/Safari (double-click).
2. Select all (⌘A) → Copy (⌘C).
3. **Outlook for Mac:** Outlook → Settings → Email → Signatures → New → paste (⌘V). Assign to new messages + replies.
4. **Outlook on the web:** Settings → Mail → Compose and reply → Email signature → paste → Save.
5. **Outlook Windows:** File → Options → Mail → Signatures → New → paste.

Logo bar links: Tage VC + Recruit 619 + Signent HR + Instant NDA (each → company site).

## Templates

\`templates/ENT-*/\` — same layout system; replace \`{{Full Name}}\` / \`{{Job Title}}\`.

Parent template = full portfolio bar. Subsidiary templates put the employer logo first, then parent + sisters.

## M365 org apply

Graph cannot set signatures. Use EXO \`Set-MailboxMessageConfiguration\` or paste per user. See \`docs/EMAIL_SIGNATURES.md\`.
`;
  writeFileSync(join(DOWNLOADS, 'README.md'), readme, 'utf8');
  writeFileSync(join(SOT, 'README.md'), readme, 'utf8');

  console.log('Wrote people + entity templates to:');
  console.log(' ', DOWNLOADS);
  console.log(' ', SOT);
  console.log(
    'People:',
    KNOWN_SIGNATURE_PEOPLE.map((p) => p.fullName).join(', '),
  );
  console.log('Parent entity:', PARENT_ENTITY_ID);
}

main();
