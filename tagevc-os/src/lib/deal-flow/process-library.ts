import type { LeadProcessTemplate, PipelineStage, Priority } from '@/lib/types';

/**
 * Lead Process Library from Excel — spawn into Lead Tasks Active
 * when a company enters a stage (once per lib_id per lead).
 */
export const LEAD_PROCESS_LIBRARY: LeadProcessTemplate[] = [
  {
    lib_id: 'LS-01',
    process_stage: 'Sourced',
    title: 'Log lead with source, sector, raise stage, owner',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Complete Pipeline Active row; unique Lead ID',
  },
  {
    lib_id: 'LS-02',
    process_stage: 'Sourced',
    title: 'Capture deck / one-pager / website in Evidence',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Materials linked same day as intake',
  },
  {
    lib_id: 'LS-03',
    process_stage: 'Sourced',
    title: 'Acknowledge inbound or thank referrer within 48h',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Referrer loop closed; founder knows next step',
  },
  {
    lib_id: 'LS-04',
    process_stage: 'Sourced',
    title: 'Outbound: personalized first touch + follow-up plan',
    default_priority: 'Medium',
    owner_role: 'Associate',
    what_good_looks_like: '2–3 touch sequence scheduled',
  },
  {
    lib_id: 'LS-05',
    process_stage: 'Screened',
    title: 'Thesis fit screen (stage, sector, geo, check size)',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Pass/fail vs fund mandate before deep time',
  },
  {
    lib_id: 'LS-06',
    process_stage: 'Screened',
    title: 'Quick market map: category, comps, timing',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: '1-page view of space and positioning',
  },
  {
    lib_id: 'LS-07',
    process_stage: 'Screened',
    title: 'Team skim: founders LinkedIn, prior companies, signals',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Notable strengths/red flags noted',
  },
  {
    lib_id: 'LS-08',
    process_stage: 'Screened',
    title: 'Traction skim: revenue/users/growth if available',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Metrics logged; holes listed for call',
  },
  {
    lib_id: 'LS-09',
    process_stage: 'Screened',
    title: 'Decide: First Call / Pass / Nurture — update Stage',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Explicit decision + reason in Notes',
  },
  {
    lib_id: 'LS-11',
    process_stage: 'First Call',
    title: 'Prep call agenda; review deck + open questions',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Agenda covers problem, product, GTM, ask',
  },
  {
    lib_id: 'LS-12',
    process_stage: 'First Call',
    title: 'Hold founder call; take structured notes',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Notes in CRM/Evidence within 24h',
  },
  {
    lib_id: 'LS-13',
    process_stage: 'First Call',
    title: 'Score Thesis Fit + Score (1-5) on Pipeline',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Fit and score updated same day',
  },
  {
    lib_id: 'LS-14',
    process_stage: 'First Call',
    title: 'Debrief: advance to Partner Meeting, Pass, or more info',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Stage + Next Action set',
  },
  {
    lib_id: 'LS-15',
    process_stage: 'First Call',
    title: 'Send process email / timeline expectations to founder',
    default_priority: 'Medium',
    owner_role: 'Associate',
    what_good_looks_like: 'Founder knows what happens next',
  },
  {
    lib_id: 'LS-16',
    process_stage: 'Partner Meeting',
    title: 'Write 1-pager + recommendation for partner',
    default_priority: 'Critical',
    owner_role: 'Associate',
    what_good_looks_like: 'Includes thesis, risks, kill criteria, ask',
  },
  {
    lib_id: 'LS-17',
    process_stage: 'Partner Meeting',
    title: 'Schedule partner / deal team meeting with founder',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Calendar held; materials pre-read',
  },
  {
    lib_id: 'LS-18',
    process_stage: 'Partner Meeting',
    title: 'Partner debrief: go / no-go / more work',
    default_priority: 'Critical',
    owner_role: 'Partner',
    what_good_looks_like: 'Written decision owner + date',
  },
  {
    lib_id: 'LS-19',
    process_stage: 'Partner Meeting',
    title: 'Light reference or expert call if needed pre-DD',
    default_priority: 'Medium',
    owner_role: 'Associate',
    what_good_looks_like: 'Notes filed; does not replace full DD refs',
  },
  {
    lib_id: 'LS-20',
    process_stage: 'Deep Dive Prep',
    title: 'Competitive deep-dive and positioning memo',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Clear why-us vs alternatives',
  },
  {
    lib_id: 'LS-21',
    process_stage: 'Deep Dive Prep',
    title: 'Unit economics / model sanity check (light)',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Flags for full DD financial workstream',
  },
  {
    lib_id: 'LS-22',
    process_stage: 'Deep Dive Prep',
    title: 'Confirm round dynamics, timing, other investors',
    default_priority: 'High',
    owner_role: 'Partner',
    what_good_looks_like: 'Process calendar and lead status known',
  },
  {
    lib_id: 'LS-23',
    process_stage: 'Deep Dive Prep',
    title: 'Internal alignment on ownership / check size target',
    default_priority: 'Critical',
    owner_role: 'Partner',
    what_good_looks_like: 'Check size on Pipeline matches mandate',
  },
  {
    lib_id: 'LS-24',
    process_stage: 'Ready for DD',
    title: 'Partner formal approval to open full DD',
    default_priority: 'Critical',
    owner_role: 'Partner',
    what_good_looks_like: 'Outcome Advanced to DD on Pipeline Closed',
  },
  {
    lib_id: 'LS-25',
    process_stage: 'Ready for DD',
    title: 'Handoff: open DD checklist + request data room',
    default_priority: 'Critical',
    owner_role: 'Partner',
    what_good_looks_like: 'Entity name matches Needs Completed exactly',
  },
  {
    lib_id: 'LS-26',
    process_stage: 'Ready for DD',
    title: 'Notify founder of DD kickoff + request list',
    default_priority: 'High',
    owner_role: 'Associate',
    what_good_looks_like: 'Clear owner and response SLA',
  },
];

export function templatesForStage(
  stage: PipelineStage,
): LeadProcessTemplate[] {
  return LEAD_PROCESS_LIBRARY.filter((t) => t.process_stage === stage);
}

export function defaultPriorityForStage(stage: PipelineStage): Priority {
  if (stage === 'Ready for DD' || stage === 'Partner Meeting') return 'Critical';
  if (stage === 'First Call' || stage === 'Deep Dive Prep') return 'High';
  return 'Medium';
}
