#!/usr/bin/env node
/**
 * Demo seed for Email Campaign Center (safe, idempotent-ish).
 * Creates a demo list, template, journey pack install metadata, and brand kit touch.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   node scripts/seed-ecc-demo.mjs [ENT-FIRM|ENT-INDA|ENT-SIGNENT]
 *
 * Does NOT touch Recruit 619 portal. ENT-R619 allowed only for shared spine tables.
 */
import pg from 'pg';

const entityId = process.argv[2] || 'ENT-FIRM';
const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const { Client } = pg;
const client = new Client({
  connectionString: raw,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  console.log(`Seeding ECC demo for ${entityId}…`);

  await client.query(
    `insert into public.ecc_entity_settings (entity_id, campaign_enabled, physical_address)
     values ($1, true, $2)
     on conflict (entity_id) do update set campaign_enabled = true`,
    [entityId, `${entityId} — Demo address`],
  );

  await client.query(
    `insert into public.ecc_brand_kits (entity_id, physical_address, colors_json)
     values ($1, $2, '{"primary":"#3a414f","accent":"#9f957c"}'::jsonb)
     on conflict (entity_id) do nothing`,
    [entityId, `${entityId} — Demo address`],
  );

  const tpl = await client.query(
    `insert into public.ecc_templates (entity_id, name, category, subject, html, status)
     values ($1, 'ECC Demo nurture', 'demo', 'Quick note',
       '<p>Hi {{contact.first_name | default: "there"}},</p><p>This is an ECC demo template.</p>',
       'active')
     on conflict do nothing
     returning id`,
    [entityId],
  );

  const list = await client.query(
    `insert into public.ecc_lists (entity_id, name, list_type, description, count_cached)
     values ($1, 'ECC Demo list', 'static', 'Seeded for Email Campaign Center demos', 0)
     returning id`,
    [entityId],
  );

  const graph = {
    version: 1,
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        label: 'Demo enroll',
        position: { x: 40, y: 120 },
        config: { source: 'manual' },
      },
      {
        id: 'e1',
        type: 'email',
        label: 'Nurture',
        position: { x: 260, y: 120 },
        config: { delivery_plane: 'controlled_graph', include_signature: false },
      },
      {
        id: 'd1',
        type: 'send_envelope',
        label: 'DocuSign (library)',
        position: { x: 480, y: 120 },
        config: { library_document_id: null },
      },
      {
        id: 'goal',
        type: 'goal',
        label: 'Signed',
        position: { x: 700, y: 120 },
        config: { goal: 'docusign_completed' },
      },
    ],
    edges: [
      { id: 't1_e1', from: 't1', to: 'e1' },
      { id: 'e1_d1', from: 'e1', to: 'd1' },
      { id: 'd1_goal', from: 'd1', to: 'goal', label: 'completed' },
    ],
  };

  const journey = await client.query(
    `insert into public.ecc_journeys
       (entity_id, name, journey_type, status, mutex_group, default_delivery_plane, graph_json, starter_pack_key)
     values ($1, 'ECC Demo nurture → DocuSign', 'journey', 'draft', 'demo_nda', 'auto', $2::jsonb, 'demo_nurture_envelope')
     returning id`,
    [entityId, JSON.stringify(graph)],
  );

  console.log(
    JSON.stringify(
      {
        entityId,
        templateId: tpl.rows[0]?.id || null,
        listId: list.rows[0]?.id,
        journeyId: journey.rows[0]?.id,
      },
      null,
      2,
    ),
  );
  console.log('Done. Open Sequences & journeys to edit the demo graph and set library_document_id.');
} finally {
  await client.end();
}
