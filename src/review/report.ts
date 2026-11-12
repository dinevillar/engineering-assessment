import type { CaseEvaluation, WeekFigures } from './evaluate.ts';
import type { DecisionRow } from './store.ts';

export interface ClientReport {
  title: string; scopeLine: string; asOf: string;
  decision: { outcome: DecisionRow['outcome']; label: string; budgetChangePct: number };
  headline: string;
  figures: { label: string; value: string; note: string }[];
  notes: string[];
  nextStep: string;
  reviewer: string; reason: string; decisionVersion: number; evidenceFingerprint: string;
  sources: string[];
}

export const OUTCOME_LABELS: Record<DecisionRow['outcome'], string> = {
  approve_expansion: 'Suggest 10% promotion expansion (for brand-manager approval)',
  hold: 'Hold current promotion',
  hold_pending_data: 'Hold pending data correction',
};

const n = (v: number | null): string => v === null ? 'unavailable' : v.toLocaleString('en-US');
const d = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fullWeek = (w: WeekFigures): boolean => w.publisherStatus === 'complete' && (w.publisherPeriodEnd ?? '') >= w.expectedPeriodEnd;
const money = (v: number): string => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildClientReport(ev: CaseEvaluation, decision: DecisionRow): { content: ClientReport; markdown: string } {
  const [cur, prev] = ev.weeks;
  const s = ev.scope;
  const blocking = ev.issues.filter(i => i.severity === 'blocking');
  const coverage = (w: WeekFigures): string => w.publisher === null ? 'not verified against the publisher'
    : fullWeek(w) ? `full week ${d(w.periodStart)}–${d(w.expectedPeriodEnd)}`
    : `partial week, ${d(w.periodStart)}–${d(w.publisherPeriodEnd!)} only`;

  let headline: string;
  if (cur.publisher === null) headline = `Active subscriptions for the week of ${d(s.periodStart)} could not be verified yet.`;
  else if (ev.growth.comparable && ev.growth.verifiedPct !== null) {
    const dir = ev.growth.verifiedPct > 0 ? 'up' : ev.growth.verifiedPct < 0 ? 'down' : 'unchanged';
    headline = `${n(cur.publisher)} active subscriptions in the week of ${d(s.periodStart)}, ${dir}${dir === 'unchanged' ? '' : ` ${Math.abs(ev.growth.verifiedPct).toFixed(2)}%`} from ${n(prev.publisher)} the previous week.`;
  } else headline = `${n(cur.publisher)} active subscriptions (${coverage(cur)}). A comparable week-over-week change cannot be stated yet.`;

  const figures = [
    { label: `Active subscriptions, week of ${d(cur.periodStart)}`, value: n(cur.publisher), note: coverage(cur) },
    { label: `Active subscriptions, week of ${d(prev.periodStart)}`, value: n(prev.publisher), note: coverage(prev) },
    { label: 'Week-over-week change', value: ev.growth.comparable && ev.growth.verifiedPct !== null ? `${ev.growth.verifiedPct.toFixed(2)}%` : 'Not comparable',
      note: ev.growth.comparable ? 'Both weeks are complete publisher snapshots.' : 'Requires complete snapshots for both weeks.' },
    { label: `Net sales, ${d(s.periodStart)}–${d(s.periodEnd)}`, value: money(ev.context.netSales), note: 'After promotions and refunds.' },
    { label: 'Attributed ROAS', value: ev.context.roas === null ? 'Undefined (no spend)' : ev.context.roas.toFixed(2), note: 'Attributed ad sales ÷ ad spend.' },
    { label: 'Available inventory units', value: n(ev.context.inventoryUnits), note: `Latest snapshot on or before ${d(s.periodEnd)}.` },
  ];

  const notes: string[] = [];
  for (const w of [cur, prev]) {
    const label = w.week === 'current' ? 'reporting week' : 'comparison week';
    if (w.publisher === null) notes.push(`The ${label} figure could not be verified against the publisher's records; missing data is treated as unknown, not zero.`);
    else if (!fullWeek(w)) notes.push(`The ${label} figure comes from a partial publisher report covering ${d(w.periodStart)}–${d(w.publisherPeriodEnd!)}. It is not a full-week figure and is not compared as weekly growth.`);
    if (ev.issues.some(i => i.week === w.week && (i.code === 'incomplete_import' || i.code === 'superseded_report_selected'))) {
      notes.push(`The ${label} figure uses the publisher's current report (${w.publisherReportId}).`);
    }
  }
  if (blocking.some(i => i.code === 'stale_import')) notes.push('The latest data import is older than 48 hours.');
  notes.push('Active subscriptions count product-offer enrollments, not unique customers or orders.');

  const pending = blocking.find(i => i.code === 'incomplete_period' && i.week === 'current');
  const nextStep = decision.outcome === 'approve_expansion'
    ? 'Brand manager to confirm the 10% expansion of the subscription promotion. No change has been made yet.'
    : decision.outcome === 'hold_pending_data'
      ? `Keep the current promotion. Our data team is correcting the source data${cur.pipelineReportIds.length ? '' : ' import'}; this report will be reissued after the case is re-reviewed.`
      : pending
        ? `Keep the current promotion. We will refresh this report when the publisher's complete report for ${d(s.periodStart)}–${d(s.periodEnd)} is available, and reassess the promotion then.`
        : 'Keep the current promotion and reassess with next week\'s complete report.';

  const content: ClientReport = {
    title: `${s.brandName} — weekly subscription report`,
    scopeLine: `${s.marketplace} marketplace · ${d(s.periodStart)}–${d(s.periodEnd)} · data as of ${new Date(s.asOf).toUTCString().replace(' GMT', ' UTC')}`,
    asOf: s.asOf,
    decision: { outcome: decision.outcome, label: OUTCOME_LABELS[decision.outcome], budgetChangePct: decision.budgetChangePct },
    headline, figures, notes, nextStep,
    reviewer: decision.reviewer, reason: decision.reason, decisionVersion: decision.version,
    evidenceFingerprint: decision.evidenceFingerprint,
    sources: [cur.publisherReportId, prev.publisherReportId].filter((x): x is string => Boolean(x)),
  };
  const markdown = [
    `# ${content.title}`, '', content.scopeLine, '',
    `**Recommendation:** ${content.decision.label}`, '', content.headline, '',
    '| Measure | Value | Basis |', '|---|---|---|',
    ...figures.map(f => `| ${f.label} | ${f.value} | ${f.note} |`), '',
    '## Data notes', ...notes.map(x => `- ${x}`), '',
    '## Next step', nextStep, '',
    `_Reviewed by ${content.reviewer} (decision v${content.decisionVersion}). Sources: ${content.sources.join(', ') || 'none verified'}. Evidence ${content.evidenceFingerprint}._`, '',
  ].join('\n');
  return { content, markdown };
}
