/**
 * Journey / sequence graph model for Email Campaign Center Phase 6.
 * Serialized as graph_json on ecc_journeys. Visual editor uses @xyflow/react.
 */

export type JourneyNodeType =
  | 'trigger'
  | 'email'
  | 'wait'
  | 'branch'
  | 'call_vm_email'
  | 'send_envelope'
  | 'task'
  | 'goal'
  | 'exit';

export type JourneyNode = {
  id: string;
  type: JourneyNodeType;
  label?: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
};

export type JourneyEdge = {
  id?: string;
  from: string;
  to: string;
  label?: string;
  condition?: string;
};

export type JourneyGraph = {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  version?: number;
};

export type JourneyValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export const JOURNEY_NODE_META: Record<
  JourneyNodeType,
  { label: string; color: string; description: string }
> = {
  trigger: {
    label: 'Trigger',
    color: '#3a414f',
    description: 'Entry: enroll, stage change, form, or sign',
  },
  email: {
    label: 'Email',
    color: '#5b6b7a',
    description: 'Send email (Graph / MTA / auto plane)',
  },
  wait: {
    label: 'Wait',
    color: '#9f957c',
    description: 'Delay before next step',
  },
  branch: {
    label: 'Branch',
    color: '#6b7280',
    description: 'If/else on open, click, reply, field',
  },
  call_vm_email: {
    label: 'Call → VM → Email',
    color: '#535c63',
    description: 'Dialer step; paired email on no-answer + VM',
  },
  send_envelope: {
    label: 'DocuSign',
    color: '#3a414f',
    description: 'Send envelope from Document Library',
  },
  task: {
    label: 'Task',
    color: '#7c7871',
    description: 'Manual follow-up for owner',
  },
  goal: {
    label: 'Goal',
    color: '#4a5d4e',
    description: 'Conversion exit (signed, booked, hired)',
  },
  exit: {
    label: 'Exit',
    color: '#8b7355',
    description: 'Leave journey',
  },
};

const VALID_TYPES = new Set<string>(Object.keys(JOURNEY_NODE_META));

export function emptyJourneyGraph(): JourneyGraph {
  return {
    version: 1,
    nodes: [
      {
        id: 'trigger_1',
        type: 'trigger',
        label: 'Enrolled',
        position: { x: 80, y: 120 },
        config: { source: 'manual' },
      },
    ],
    edges: [],
  };
}

export function normalizeJourneyGraph(raw: unknown): JourneyGraph {
  if (!raw || typeof raw !== 'object') return emptyJourneyGraph();
  const g = raw as Partial<JourneyGraph>;
  const nodes = Array.isArray(g.nodes) ? g.nodes.filter(isNode) : [];
  const edges = Array.isArray(g.edges) ? g.edges.filter(isEdge) : [];
  return { version: Number(g.version) || 1, nodes, edges };
}

function isNode(n: unknown): n is JourneyNode {
  if (!n || typeof n !== 'object') return false;
  const o = n as JourneyNode;
  return typeof o.id === 'string' && VALID_TYPES.has(String(o.type));
}

function isEdge(e: unknown): e is JourneyEdge {
  if (!e || typeof e !== 'object') return false;
  const o = e as JourneyEdge;
  return typeof o.from === 'string' && typeof o.to === 'string';
}

export function validateJourneyGraph(graph: JourneyGraph): JourneyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  if (!graph.nodes.some((n) => n.type === 'trigger')) {
    errors.push('Journey needs a trigger node');
  }
  if (graph.nodes.length < 2) {
    warnings.push('Add at least one action after the trigger');
  }

  for (const n of graph.nodes) {
    if (!VALID_TYPES.has(n.type)) errors.push(`Unknown node type: ${n.type}`);
    if (n.type === 'email' && !n.config?.delivery_plane) {
      warnings.push(`Email node ${n.id} missing delivery_plane (defaulting to auto)`);
    }
    if (n.type === 'call_vm_email') {
      const on = n.config?.send_email_on;
      if (!Array.isArray(on) || !on.includes('vm_dropped')) {
        warnings.push(
          `call_vm_email ${n.id}: paired email should require vm_dropped (ADR-003)`,
        );
      }
    }
    if (n.type === 'send_envelope' && !n.config?.library_document_id) {
      warnings.push(`DocuSign node ${n.id} needs library_document_id`);
    }
  }

  for (const e of graph.edges) {
    if (!ids.has(e.from)) errors.push(`Edge from missing node ${e.from}`);
    if (!ids.has(e.to)) errors.push(`Edge to missing node ${e.to}`);
  }

  const reachable = new Set<string>();
  const triggers = graph.nodes.filter((n) => n.type === 'trigger').map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = adj.get(e.from) || [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const stack = [...triggers];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) || []) stack.push(next);
  }
  for (const n of graph.nodes) {
    if (n.type !== 'trigger' && !reachable.has(n.id)) {
      warnings.push(`Node ${n.id} is unreachable from trigger`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export type StarterPackId =
  | 'r619_candidate_nurture'
  | 'signent_onboarding'
  | 'inda_nda_chase'
  | 'tage_portfolio_drip'
  | 'multichannel_outreach';

export type JourneyStarterPack = {
  id: StarterPackId;
  entityIds: string[];
  name: string;
  description: string;
  journey_type: 'sequence' | 'journey';
  mutex_group: string | null;
  default_delivery_plane: 'graph' | 'owned_mta' | 'controlled_graph' | 'auto';
  graph: JourneyGraph;
};

function edge(from: string, to: string, label?: string): JourneyEdge {
  return { id: `${from}_${to}`, from, to, label };
}

export const JOURNEY_STARTER_PACKS: JourneyStarterPack[] = [
  {
    id: 'r619_candidate_nurture',
    entityIds: ['ENT-R619'],
    name: 'Candidate nurture (Recruit 619)',
    description: 'Email → wait → call/VM/email → branch on reply → goal hired',
    journey_type: 'sequence',
    mutex_group: 'recruiting_outreach',
    default_delivery_plane: 'graph',
    graph: {
      version: 1,
      nodes: [
        {
          id: 't1',
          type: 'trigger',
          label: 'Enrolled / stage Target',
          position: { x: 40, y: 160 },
          config: { source: 'crm_stage', stage: 'Target' },
        },
        {
          id: 'e1',
          type: 'email',
          label: 'Intro note',
          position: { x: 260, y: 160 },
          config: {
            delivery_plane: 'graph',
            include_signature: true,
            subject: 'Quick note about {{job.title | default: "an open role"}}',
            merge_context: ['contact', 'job', 'owner'],
          },
        },
        {
          id: 'w1',
          type: 'wait',
          label: 'Wait 2 days',
          position: { x: 480, y: 160 },
          config: { delay_hours: 48 },
        },
        {
          id: 'c1',
          type: 'call_vm_email',
          label: 'Call + VM drop',
          position: { x: 700, y: 160 },
          config: {
            send_email_on: ['no_answer', 'vm_dropped'],
            delay_email_seconds: 60,
            plane: 'graph',
          },
        },
        {
          id: 'b1',
          type: 'branch',
          label: 'Replied?',
          position: { x: 920, y: 160 },
          config: { field: 'replied', op: 'eq', value: true },
        },
        {
          id: 'goal',
          type: 'goal',
          label: 'Conversation / hire path',
          position: { x: 1140, y: 60 },
          config: { goal: 'conversation' },
        },
        {
          id: 'task',
          type: 'task',
          label: 'Owner follow-up',
          position: { x: 1140, y: 260 },
          config: { task_type: 'call_back' },
        },
      ],
      edges: [
        edge('t1', 'e1'),
        edge('e1', 'w1'),
        edge('w1', 'c1'),
        edge('c1', 'b1'),
        edge('b1', 'goal', 'yes'),
        edge('b1', 'task', 'no'),
      ],
    },
  },
  {
    id: 'signent_onboarding',
    entityIds: ['ENT-SIGNENT'],
    name: 'HR onboarding drip (Signent)',
    description: 'Welcome email → wait → DocuSign packet → goal completed',
    journey_type: 'journey',
    mutex_group: 'hr_onboarding',
    default_delivery_plane: 'auto',
    graph: {
      version: 1,
      nodes: [
        {
          id: 't1',
          type: 'trigger',
          label: 'New hire',
          position: { x: 40, y: 140 },
          config: { source: 'hris_start' },
        },
        {
          id: 'e1',
          type: 'email',
          label: 'Welcome',
          position: { x: 260, y: 140 },
          config: {
            delivery_plane: 'auto',
            include_signature: false,
            merge_context: ['contact', 'hr', 'owner'],
          },
        },
        {
          id: 'w1',
          type: 'wait',
          label: 'Wait 1 day',
          position: { x: 480, y: 140 },
          config: { delay_hours: 24 },
        },
        {
          id: 'd1',
          type: 'send_envelope',
          label: 'Onboarding packet',
          position: { x: 700, y: 140 },
          config: { library_document_id: null, branding: 'entity' },
        },
        {
          id: 'goal',
          type: 'goal',
          label: 'Signed complete',
          position: { x: 920, y: 140 },
          config: { goal: 'docusign_completed' },
        },
      ],
      edges: [
        edge('t1', 'e1'),
        edge('e1', 'w1'),
        edge('w1', 'd1'),
        edge('d1', 'goal', 'completed'),
      ],
    },
  },
  {
    id: 'inda_nda_chase',
    entityIds: ['ENT-INDA'],
    name: 'NDA chase (Instant NDA)',
    description: 'Reminder email → DocuSign → wait → reminder → goal signed',
    journey_type: 'journey',
    mutex_group: 'nda',
    default_delivery_plane: 'auto',
    graph: {
      version: 1,
      nodes: [
        {
          id: 't1',
          type: 'trigger',
          label: 'NDA requested',
          position: { x: 40, y: 140 },
          config: { source: 'nda_created' },
        },
        {
          id: 'e1',
          type: 'email',
          label: 'Please sign',
          position: { x: 260, y: 140 },
          config: {
            delivery_plane: 'auto',
            merge_context: ['contact', 'nda', 'account'],
          },
        },
        {
          id: 'd1',
          type: 'send_envelope',
          label: 'Send NDA',
          position: { x: 480, y: 140 },
          config: { library_document_id: null },
        },
        {
          id: 'w1',
          type: 'wait',
          label: 'Wait 3 days',
          position: { x: 700, y: 140 },
          config: { delay_hours: 72 },
        },
        {
          id: 'e2',
          type: 'email',
          label: 'Gentle reminder',
          position: { x: 920, y: 140 },
          config: { delivery_plane: 'auto', merge_context: ['contact', 'nda'] },
        },
        {
          id: 'goal',
          type: 'goal',
          label: 'NDA signed',
          position: { x: 1140, y: 140 },
          config: { goal: 'docusign_completed' },
        },
        {
          id: 'exit',
          type: 'exit',
          label: 'Expired',
          position: { x: 1140, y: 280 },
          config: { reason: 'timeout' },
        },
      ],
      edges: [
        edge('t1', 'e1'),
        edge('e1', 'd1'),
        edge('d1', 'goal', 'completed'),
        edge('d1', 'w1', 'pending'),
        edge('w1', 'e2'),
        edge('e2', 'goal', 'completed'),
        edge('e2', 'exit', 'still pending'),
      ],
    },
  },
  {
    id: 'tage_portfolio_drip',
    entityIds: ['ENT-FIRM'],
    name: 'Portfolio update drip (Tage)',
    description: 'Newsletter-style nurture with wait and exit',
    journey_type: 'journey',
    mutex_group: null,
    default_delivery_plane: 'controlled_graph',
    graph: {
      version: 1,
      nodes: [
        {
          id: 't1',
          type: 'trigger',
          label: 'List enroll',
          position: { x: 40, y: 120 },
          config: { source: 'list' },
        },
        {
          id: 'e1',
          type: 'email',
          label: 'Update #1',
          position: { x: 260, y: 120 },
          config: { delivery_plane: 'controlled_graph', include_signature: false },
        },
        {
          id: 'w1',
          type: 'wait',
          label: 'Wait 7 days',
          position: { x: 480, y: 120 },
          config: { delay_hours: 168 },
        },
        {
          id: 'e2',
          type: 'email',
          label: 'Update #2',
          position: { x: 700, y: 120 },
          config: { delivery_plane: 'controlled_graph' },
        },
        {
          id: 'exit',
          type: 'exit',
          label: 'Complete',
          position: { x: 920, y: 120 },
          config: { reason: 'completed' },
        },
      ],
      edges: [
        edge('t1', 'e1'),
        edge('e1', 'w1'),
        edge('w1', 'e2'),
        edge('e2', 'exit'),
      ],
    },
  },
  {
    id: 'multichannel_outreach',
    entityIds: ['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'],
    name: 'Multichannel outreach',
    description: 'Generic call_vm_email cadence with Graph plane + mutex',
    journey_type: 'sequence',
    mutex_group: 'outbound_sequence',
    default_delivery_plane: 'graph',
    graph: {
      version: 1,
      nodes: [
        {
          id: 't1',
          type: 'trigger',
          label: 'Enrolled',
          position: { x: 40, y: 140 },
          config: { source: 'manual' },
        },
        {
          id: 'e1',
          type: 'email',
          label: 'Opener',
          position: { x: 260, y: 140 },
          config: { delivery_plane: 'graph', include_signature: true },
        },
        {
          id: 'w1',
          type: 'wait',
          label: 'Wait 1 day',
          position: { x: 480, y: 140 },
          config: { delay_hours: 24 },
        },
        {
          id: 'c1',
          type: 'call_vm_email',
          label: 'Call / VM / email',
          position: { x: 700, y: 140 },
          config: {
            send_email_on: ['no_answer', 'vm_dropped'],
            delay_email_seconds: 60,
            plane: 'graph',
          },
        },
        {
          id: 'exit',
          type: 'exit',
          label: 'Done',
          position: { x: 920, y: 140 },
          config: {},
        },
      ],
      edges: [
        edge('t1', 'e1'),
        edge('e1', 'w1'),
        edge('w1', 'c1'),
        edge('c1', 'exit'),
      ],
    },
  },
];

export function starterPacksForEntity(entityId: string): JourneyStarterPack[] {
  if (entityId === 'ENT-FIRM') return JOURNEY_STARTER_PACKS;
  return JOURNEY_STARTER_PACKS.filter(
    (p) => p.entityIds.includes(entityId) || p.entityIds.length === 0,
  );
}

export function getStarterPack(id: string): JourneyStarterPack | null {
  return JOURNEY_STARTER_PACKS.find((p) => p.id === id) ?? null;
}

export function journeyNodePalette(): Array<{
  type: JourneyNodeType;
  label: string;
  hint: string;
}> {
  return (Object.keys(JOURNEY_NODE_META) as JourneyNodeType[])
    .filter((t) => t !== 'trigger')
    .map((type) => ({
      type,
      label: JOURNEY_NODE_META[type].label,
      hint: JOURNEY_NODE_META[type].description,
    }));
}

export function newNodeId(type: JourneyNodeType, existing: string[]): string {
  let i = 1;
  let id = `${type}_${i}`;
  const set = new Set(existing);
  while (set.has(id)) {
    i += 1;
    id = `${type}_${i}`;
  }
  return id;
}

/** Fill missing positions with a simple left-to-right layout. */
export function layoutJourneyGraph(graph: JourneyGraph): JourneyGraph {
  const g = normalizeJourneyGraph(graph);
  const children = new Map<string, string[]>();
  const targets = new Set(g.edges.map((e) => e.to));
  for (const e of g.edges) {
    const list = children.get(e.from) || [];
    list.push(e.to);
    children.set(e.from, list);
  }
  const roots = g.nodes.filter((n) => n.type === 'trigger' || !targets.has(n.id));
  const placed = new Map<string, { x: number; y: number }>();
  let leaf = 0;

  function place(id: string, depth: number) {
    if (placed.has(id)) return;
    const kids = children.get(id) || [];
    if (!kids.length) {
      placed.set(id, { x: 40 + leaf * 220, y: 40 + depth * 140 });
      leaf += 1;
      return;
    }
    const start = leaf;
    for (const k of kids) place(k, depth + 1);
    const end = leaf;
    const mid = 40 + ((start + end - 1) / 2) * 220;
    placed.set(id, { x: mid, y: 40 + depth * 140 });
  }

  for (const r of roots.length ? roots : g.nodes.slice(0, 1)) place(r.id, 0);
  for (const n of g.nodes) {
    if (!placed.has(n.id)) {
      placed.set(n.id, { x: 40 + leaf * 220, y: 40 });
      leaf += 1;
    }
  }

  return {
    ...g,
    nodes: g.nodes.map((n) => ({
      ...n,
      position: n.position ?? placed.get(n.id) ?? { x: 0, y: 0 },
    })),
  };
}

/** Deep vertical merge tokens (job / nda / hr) for Phase 6 catalog. */
export const VERTICAL_MERGE_FIELDS = [
  {
    object: 'job',
    api_name: 'title',
    label: 'Job title',
    data_type: 'text',
    sensitive: false,
    insert_token: '{{job.title | default: "this role"}}',
    sample_value: 'Senior Recruiter',
  },
  {
    object: 'job',
    api_name: 'location',
    label: 'Job location',
    data_type: 'text',
    sensitive: false,
    insert_token: '{{job.location}}',
    sample_value: 'San Diego, CA',
  },
  {
    object: 'nda',
    api_name: 'document_name',
    label: 'NDA document',
    data_type: 'text',
    sensitive: false,
    insert_token: '{{nda.document_name | default: "NDA"}}',
    sample_value: 'Mutual NDA',
  },
  {
    object: 'nda',
    api_name: 'expires_at',
    label: 'NDA expires',
    data_type: 'date',
    sensitive: false,
    insert_token: '{{nda.expires_at}}',
    sample_value: '2026-09-01',
  },
  {
    object: 'hr',
    api_name: 'start_date',
    label: 'Start date',
    data_type: 'date',
    sensitive: false,
    insert_token: '{{hr.start_date}}',
    sample_value: '2026-08-15',
  },
  {
    object: 'hr',
    api_name: 'manager_name',
    label: 'Manager',
    data_type: 'text',
    sensitive: false,
    insert_token: '{{hr.manager_name}}',
    sample_value: 'Jordan Lee',
  },
] as const;
