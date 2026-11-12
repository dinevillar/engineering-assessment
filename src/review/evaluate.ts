import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF, PERIOD_START, PREVIOUS_START, queryRows, rebuildMetrics } from '../database.ts';
import { analyse } from '../analyst.ts';
import type { EvidenceOptions } from '../metrics.ts';
import { evaluatePolicy, validateProposal, type PolicyOutcome } from '../policy.ts';
import type { Evidence, QualityIssue, Recommendation, SourceSnapshot, PublisherCurrent, Quality } from '../types.ts';

/** The starter pipeline's selection (pre-fix). Used only to reproduce the figure shown in the
 * draft report under investigation, so the reviewer can see what was wrong and why. */
const DRAFT_SELECTION_SQL = `
WITH ranked AS (
  SELECT r.*, DENSE_RANK() OVER (
    PARTITION BY brand_id, marketplace, period_start
    ORDER BY CASE WHEN status = 'complete' THEN 0 ELSE 1 END) AS priority
  FROM raw.subscription_reports r
  WHERE brand_id=$1 AND marketplace=$2 AND period_start=$3::date AND extracted_at <= $4::timestamptz
)
SELECT COALESCE(SUM(o.active_subscriptions),0)::int AS total, COUNT(DISTINCT r.report_id)::int AS reports,
       COALESCE(jsonb_agg(DISTINCT r.report_id) FILTER (WHERE r.report_id IS NOT NULL), '[]') AS report_ids
FROM ranked r LEFT JOIN raw.subscription_offers o USING (report_id) WHERE priority = 1`;

export interface WeekFigures {
  week: 'current' | 'previous';
  periodStart: string; expectedPeriodEnd: string;
  /** Figure in the draft report (starter pipeline). */
  draft: number | null; draftReportIds: string[];
  /** Figure from the corrected internal pipeline. */
  pipeline: number | null; pipelineReportIds: string[];
  /** Authoritative publisher figure. */
  publisher: number | null; publisherReportId: string | null;
  publisherStatus: string | null; publisherPeriodEnd: string | null;
}

export interface CaseEvaluation {
  scope: { brandId: string; brandName: string; marketplace: string; periodStart: string; periodEnd: string; previousPeriodStart: string; asOf: string };
  weeks: WeekFigures[];
  growth: { draftPct: number | null; verifiedPct: number | null; observedPct: number | null; comparable: boolean };
  quality: Quality;
  issues: QualityIssue[];
  policy: PolicyOutcome;
  model: { proposal: Recommendation; accepted: boolean; problems: string[]; documents: { id: string; source: string }[] };
  sources: SourceSnapshot[];
  publisherCurrent: PublisherCurrent[];
  context: Pick<Evidence, 'netSales' | 'adSpend' | 'attributedAdSales' | 'roas' | 'inventoryUnits'>;
  limitations: string[];
  fingerprint: string;
}

const pct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b <= 0 ? null : Math.round((a / b - 1) * 10000) / 100;

export const STANDING_LIMITATIONS = [
  'Active subscriptions count product-offer enrollments at a point in time, not unique customers or weekly orders.',
  'Sales, advertising and inventory are supporting context and do not drive the promotion policy.',
];

let queue: Promise<unknown> = Promise.resolve();
/** Serialises mart rebuild + evidence reads on a shared database connection. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function evaluateCase(db: PGlite, brandId: string, marketplace: string, options: EvidenceOptions = {}): Promise<CaseEvaluation> {
  return exclusive(async () => {
    const asOf = options.asOf ?? AS_OF;
    await rebuildMetrics(db, asOf);
    const report = await analyse(db, brandId, marketplace, undefined, options);
    const { evidence: e, quality } = report;
    const draft = async (start: string) => (await queryRows<{ total: number; reports: number; report_ids: string[] }>(
      db, DRAFT_SELECTION_SQL, [brandId, marketplace, start, asOf]))[0];
    const [draftCur, draftPrev] = [await draft(PERIOD_START), await draft(PREVIOUS_START)];
    const pubCur = e.publisherCurrent.find(p => p.week === 'current') ?? null;
    const pubPrev = e.publisherCurrent.find(p => p.week === 'previous') ?? null;
    const weeks: WeekFigures[] = [
      { week: 'current', periodStart: e.periodStart, expectedPeriodEnd: e.expectedPeriodEnd,
        draft: draftCur.reports ? draftCur.total : null, draftReportIds: draftCur.report_ids,
        pipeline: e.activeSubscriptions, pipelineReportIds: e.sourceReports,
        publisher: e.sourceTotal ?? null, publisherReportId: pubCur?.publisherReportId ?? null,
        publisherStatus: pubCur?.status ?? null, publisherPeriodEnd: pubCur?.periodEnd ?? null },
      { week: 'previous', periodStart: e.previousPeriodStart, expectedPeriodEnd: e.previousExpectedPeriodEnd,
        draft: draftPrev.reports ? draftPrev.total : null, draftReportIds: draftPrev.report_ids,
        pipeline: e.previousSubscriptions, pipelineReportIds: e.previousSourceReports,
        publisher: e.previousSourceTotal ?? null, publisherReportId: pubPrev?.publisherReportId ?? null,
        publisherStatus: pubPrev?.status ?? null, publisherPeriodEnd: pubPrev?.periodEnd ?? null },
    ];

    const issues: QualityIssue[] = [...quality.issues];
    for (const w of weeks) {
      if (w.draft !== null && w.publisher !== null && w.draft !== w.publisher) {
        const label = w.week === 'current' ? 'Reporting week' : 'Comparison week';
        const summed = w.draftReportIds.length > 1 ? ` because the starter pipeline added ${w.draftReportIds.length} revisions of the same snapshot (${w.draftReportIds.join(', ')})` : '';
        issues.push({ code: 'draft_figure_wrong', severity: 'corrected', week: w.week,
          message: `${label}: the draft report showed ${w.draft.toLocaleString('en-US')}${summed}; the publisher figure is ${w.publisher.toLocaleString('en-US')}.`,
          sourceIds: [...w.draftReportIds, ...(w.publisherReportId ? [w.publisherReportId] : [])] });
      }
    }
    const draftPct = pct(weeks[0].draft, weeks[1].draft);
    if (draftPct !== null && draftPct !== e.growthPct) {
      issues.push({ code: 'draft_growth_unsupported', severity: 'corrected', week: null,
        message: e.growthPct === null
          ? `The draft claimed ${draftPct}% growth; no comparable weekly growth can be claimed from the verified evidence.`
          : `The draft claimed ${draftPct}% growth; verified comparable change is ${e.growthPct}%.`,
        sourceIds: [] });
    }

    const policy = evaluatePolicy(e, quality);
    const check = validateProposal(report.trace.proposal, policy);
    const limitations = [
      ...issues.filter(i => i.severity !== 'warning' && !i.code.startsWith('draft_')).map(i => i.message),
      ...STANDING_LIMITATIONS,
    ];
    const evaluation: Omit<CaseEvaluation, 'fingerprint'> = {
      scope: { brandId, brandName: e.brandName, marketplace, periodStart: e.periodStart, periodEnd: e.expectedPeriodEnd, previousPeriodStart: e.previousPeriodStart, asOf },
      weeks,
      growth: { draftPct, verifiedPct: e.growthPct, observedPct: e.observedChangePct ?? null, comparable: e.growthPct !== null },
      quality, issues, policy,
      model: { proposal: report.trace.proposal, accepted: check.accepted, problems: check.problems,
        documents: report.trace.context.documents.map(d => ({ id: d.id, source: d.source })) },
      sources: e.sourceSnapshots, publisherCurrent: e.publisherCurrent,
      context: { netSales: e.netSales, adSpend: e.adSpend, attributedAdSales: e.attributedAdSales, roas: e.roas, inventoryUnits: e.inventoryUnits },
      limitations,
    };
    return { ...evaluation, fingerprint: fingerprint(evaluation) };
  });
}

/** Stable hash of everything a decision depends on: sources, figures, issues and policy. */
export function fingerprint(ev: Omit<CaseEvaluation, 'fingerprint'>): string {
  const material = {
    scope: ev.scope,
    weeks: ev.weeks,
    growth: ev.growth,
    issues: ev.issues.map(i => [i.code, i.severity, i.week, i.sourceIds]),
    policy: [ev.policy.action, ev.policy.budgetChangePct, ev.policy.expansionSupported],
    sources: ev.sources.map(s => [s.reportId, s.publisherReportId, s.status, s.periodEnd, s.generatedAt, s.extractedAt,
      s.loadedOffers, s.activeSubscriptions, s.declaredOffers, s.declaredSubscriptions, s.selected,
      s.exported && [s.exported.status, s.exported.periodEnd, s.exported.supersededBy, s.exported.activeSubscriptions, s.exported.offerSum]]),
    publisher: ev.publisherCurrent.map(p => [p.week, p.publisherReportId, p.status, p.periodEnd, p.activeSubscriptions, p.offerSum]),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16);
}
