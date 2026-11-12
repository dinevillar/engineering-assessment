import type { PGlite } from '@electric-sql/pglite';
import { AS_OF, PERIOD_START, PERIOD_END, PREVIOUS_START, queryRows } from './database.ts';
import { DEFAULT_EXPORTS_DIR, currentExport, loadExports } from './exports.ts';
import type { Evidence, PublisherCurrent, SourceSnapshot, Week } from './types.ts';

export const METRICS_SQL = `
SELECT b.brand_id, b.name, w.active_subscriptions::text AS current_count,
       p.active_subscriptions::text AS previous_count,
       w.source_period_end::text, w.source_complete, w.source_report_ids,
       w.ingested_at::text, p.source_complete AS previous_complete,
       p.source_period_end::text AS previous_end, p.source_report_ids AS previous_report_ids
FROM brands b
LEFT JOIN marts.subscription_weekly w
  ON w.brand_id=b.brand_id AND w.marketplace=$2 AND w.period_start=$3::date
LEFT JOIN marts.subscription_weekly p
  ON p.brand_id=b.brand_id AND p.marketplace=$2 AND p.period_start=$4::date
WHERE b.brand_id=$1`;

/** All reports available by asOf for the two weeks, with loaded offer totals. */
export const CANDIDATES_SQL = `
SELECT r.report_id, r.publisher_report_id, r.revision, r.status, r.period_start::text AS period_start,
       r.period_end::text AS period_end, to_json(r.generated_at)#>>'{}' AS generated_at,
       to_json(r.extracted_at)#>>'{}' AS extracted_at,
       r.declared_offer_count, r.declared_active_subscriptions,
       COUNT(o.offer_id)::int AS loaded_offers, COALESCE(SUM(o.active_subscriptions),0)::int AS loaded_subscriptions
FROM raw.subscription_reports r
LEFT JOIN raw.subscription_offers o USING (report_id)
WHERE r.brand_id=$1 AND r.marketplace=$2 AND r.period_start IN ($3::date, $4::date) AND r.extracted_at <= $5::timestamptz
GROUP BY r.report_id
ORDER BY r.period_start DESC, r.revision DESC`;

interface Row {
  brand_id: string; name: string; current_count: string | null; previous_count: string | null;
  source_period_end: string | null; source_complete: boolean | null; source_report_ids: string[] | null;
  ingested_at: string | null; previous_complete: boolean | null; previous_end: string | null;
  previous_report_ids: string[] | null;
}
interface CandidateRow {
  report_id: string; publisher_report_id: string; revision: number; status: string; period_start: string;
  period_end: string; generated_at: string; extracted_at: string; declared_offer_count: number;
  declared_active_subscriptions: number; loaded_offers: number; loaded_subscriptions: number;
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};

export interface EvidenceOptions { exportsDir?: string; asOf?: string }

export async function listScopes(db: PGlite): Promise<{ brandId: string; brandName: string; marketplace: string }[]> {
  return queryRows(db, `SELECT DISTINCT b.brand_id AS "brandId", b.name AS "brandName", r.marketplace
    FROM brands b JOIN raw.subscription_reports r USING (brand_id) ORDER BY 2, 3`);
}

export async function getEvidence(db: PGlite, brandId: string, marketplace = 'US', options: EvidenceOptions = {}): Promise<Evidence> {
  const asOf = options.asOf ?? AS_OF;
  const [r] = await queryRows<Row>(db, METRICS_SQL, [brandId, marketplace, PERIOD_START, PREVIOUS_START]);
  if (!r) throw new Error(`Unknown brand: ${brandId}. Query SELECT * FROM brands to see valid IDs.`);
  const [scope] = await queryRows<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM raw.subscription_reports WHERE brand_id=$1 AND marketplace=$2`, [brandId, marketplace]);
  if (!scope || scope.n === 0) throw new Error(`No subscription reports for ${brandId} in marketplace ${marketplace}.`);
  const [sales] = await queryRows<{ total: string }>(db, `SELECT COALESCE(SUM(product_revenue + promotions + refunds),0)::text AS total FROM raw.sales_daily WHERE brand_id=$1 AND marketplace=$2 AND date BETWEEN $3::date AND $4::date`, [brandId, marketplace, PERIOD_START, PERIOD_END]);
  const [ads] = await queryRows<{ spend: string; sales: string }>(db, `SELECT COALESCE(SUM(spend),0)::text AS spend, COALESCE(SUM(attributed_sales),0)::text AS sales FROM raw.advertising_daily WHERE brand_id=$1 AND marketplace=$2 AND date BETWEEN $3::date AND $4::date`, [brandId, marketplace, PERIOD_START, PERIOD_END]);
  const [inventory] = await queryRows<{ units: string }>(db, `SELECT COALESCE(SUM(available_units),0)::text AS units FROM raw.inventory_snapshots WHERE brand_id=$1 AND marketplace=$2 AND date=(SELECT MAX(date) FROM raw.inventory_snapshots WHERE brand_id=$1 AND marketplace=$2 AND date <= $3::date)`, [brandId, marketplace, PERIOD_END]);
  const current = r.current_count === null ? null : Number(r.current_count);
  const previous = r.previous_count === null ? null : Number(r.previous_count);

  const exports = await loadExports(options.exportsDir ?? DEFAULT_EXPORTS_DIR);
  const selectedIds = new Set([...(r.source_report_ids ?? []), ...(r.previous_report_ids ?? [])]);
  const candidates = await queryRows<CandidateRow>(db, CANDIDATES_SQL, [brandId, marketplace, PERIOD_START, PREVIOUS_START, asOf]);
  const sourceSnapshots: SourceSnapshot[] = candidates.map(c => {
    const e = exports.get(c.publisher_report_id);
    return {
      week: (c.period_start === PERIOD_START ? 'current' : 'previous') as Week,
      reportId: c.report_id, publisherReportId: c.publisher_report_id, revision: c.revision,
      status: c.status, periodEnd: c.period_end, generatedAt: c.generated_at, extractedAt: c.extracted_at,
      loadedOffers: c.loaded_offers, activeSubscriptions: c.loaded_subscriptions,
      declaredOffers: c.declared_offer_count, declaredSubscriptions: c.declared_active_subscriptions,
      selected: selectedIds.has(c.report_id),
      exported: e ? {
        status: e.status, periodEnd: e.periodEnd, supersededBy: e.supersededBy, offerCount: e.offerCount,
        activeSubscriptions: e.activeSubscriptions, offerRows: e.offerRows, offerSum: e.offerSum,
      } : null,
    };
  });
  const publisherCurrent: PublisherCurrent[] = [];
  for (const [week, start] of [['current', PERIOD_START], ['previous', PREVIOUS_START]] as const) {
    const e = currentExport(exports, brandId, marketplace, start, asOf);
    if (e) publisherCurrent.push({
      week, publisherReportId: e.publisherReportId, status: e.status, periodEnd: e.periodEnd, generatedAt: e.generatedAt,
      offerCount: e.offerCount, activeSubscriptions: e.activeSubscriptions, offerRows: e.offerRows, offerSum: e.offerSum,
    });
  }
  return {
    brandId, brandName: r.name, marketplace, periodStart: PERIOD_START, expectedPeriodEnd: PERIOD_END, asOf,
    previousPeriodStart: PREVIOUS_START, previousExpectedPeriodEnd: addDays(PREVIOUS_START, 6),
    activeSubscriptions: current, previousSubscriptions: previous,
    growthPct: null, sourceSnapshots, publisherCurrent,
    sourcePeriodEnd: r.source_period_end, sourceComplete: r.source_complete ?? false,
    sourceReports: r.source_report_ids ?? [], ingestedAt: r.ingested_at,
    previousSourceComplete: r.previous_complete ?? false, previousSourcePeriodEnd: r.previous_end,
    previousSourceReports: r.previous_report_ids ?? [],
    netSales: Number(sales.total), adSpend: Number(ads.spend), attributedAdSales: Number(ads.sales),
    roas: Number(ads.spend) > 0 ? Math.round(Number(ads.sales) / Number(ads.spend) * 100) / 100 : null,
    inventoryUnits: Number(inventory.units),
  };
}
