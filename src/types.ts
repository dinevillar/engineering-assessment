import type { Document } from './knowledge.ts';

export type Week = 'current' | 'previous';

/** One imported report as seen by the pipeline, joined with the publisher's own record. */
export interface SourceSnapshot {
  week: Week;
  reportId: string; publisherReportId: string; revision: number;
  status: string; periodEnd: string; generatedAt: string; extractedAt: string;
  /** Offers actually loaded into raw.subscription_offers. */
  loadedOffers: number; activeSubscriptions: number;
  /** Control totals from the imported report header. */
  declaredOffers: number; declaredSubscriptions: number;
  /** True when this is the report the corrected pipeline selected for the week. */
  selected: boolean;
  /** The same publisher report in the authoritative export, or null if absent. */
  exported: null | {
    status: string; periodEnd: string; supersededBy: string | null;
    offerCount: number; activeSubscriptions: number; offerRows: number; offerSum: number;
  };
}

/** The publisher's current report for a week according to the exports. */
export interface PublisherCurrent {
  week: Week; publisherReportId: string; status: string; periodEnd: string; generatedAt: string;
  offerCount: number; activeSubscriptions: number; offerRows: number; offerSum: number;
}

export interface Evidence {
  brandId: string; brandName: string; marketplace: string;
  periodStart: string; expectedPeriodEnd: string; asOf: string;
  previousPeriodStart: string; previousExpectedPeriodEnd: string;
  activeSubscriptions: number | null; previousSubscriptions: number | null;
  /** Comparable week-over-week growth; null unless both weeks are complete and verified. */
  growthPct: number | null;
  /** Arithmetic change between the authoritative figures, even when not comparable. */
  observedChangePct?: number | null;
  sourcePeriodEnd: string | null;
  sourceComplete: boolean; sourceReports: string[]; ingestedAt: string | null;
  previousSourceComplete: boolean; previousSourcePeriodEnd: string | null; previousSourceReports: string[];
  netSales: number; adSpend: number; attributedAdSales: number; roas: number | null;
  inventoryUnits: number;
  /** Every report available by asOf for both weeks (candidates), selected ones flagged. */
  sourceSnapshots: SourceSnapshot[];
  publisherCurrent: PublisherCurrent[];
  /** Authoritative (publisher) totals and the pipeline-minus-publisher deltas, set by reconciliation. */
  sourceTotal?: number | null; previousSourceTotal?: number | null;
  reconciliationDelta?: number | null; previousReconciliationDelta?: number | null;
}

export type IssueSeverity = 'blocking' | 'corrected' | 'warning';
export interface QualityIssue {
  code: string; severity: IssueSeverity; week: Week | null; message: string; sourceIds: string[];
}
export interface Quality { status: 'ready' | 'insufficient'; reasons: string[]; issues: QualityIssue[] }
export interface Recommendation {
  action: 'expand_promotion' | 'hold'; budgetChangePct: number;
  narrative: string; citations: string[];
}
export interface AnalystContext {
  systemPolicy: string; evidence: Evidence; quality: Quality; documents: Document[];
}
export interface Report {
  evidence: Evidence; quality: Quality; recommendation: Recommendation;
  trace: { sql: string; parameters: string[]; context: AnalystContext; proposal: Recommendation; validation: string[] };
}
