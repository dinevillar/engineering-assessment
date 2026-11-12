import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './database.ts';

/** Publisher exports (authoritative). Read-only; never written by the application. */
export interface ExportReport {
  publisherReportId: string; brandId: string; marketplace: string;
  periodStart: string; periodEnd: string; status: 'partial' | 'complete' | string;
  generatedAt: string; supersededBy: string | null;
  offerCount: number; activeSubscriptions: number;
  /** Totals recomputed from subscription_offers.csv for the same report. */
  offerRows: number; offerSum: number;
}

export const DEFAULT_EXPORTS_DIR = path.join(ROOT, 'data', 'exports');

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = split(line);
    return Object.fromEntries(header.map((key, i) => [key, (cells[i] ?? '').trim()]));
  });
}

function requireInt(value: string, field: string, file: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${field} "${value}" in ${file}.`);
  return n;
}

const cache = new Map<string, { key: string; data: Map<string, ExportReport> }>();

/** Loads exports keyed by publisher_report_id. Cached until either file changes. */
export async function loadExports(dir = DEFAULT_EXPORTS_DIR): Promise<Map<string, ExportReport>> {
  const reportsFile = path.join(dir, 'subscription_reports.csv');
  const offersFile = path.join(dir, 'subscription_offers.csv');
  let key: string;
  try {
    const [a, b] = await Promise.all([stat(reportsFile), stat(offersFile)]);
    key = `${a.mtimeMs}:${a.size}:${b.mtimeMs}:${b.size}`;
  } catch {
    throw new Error(`Publisher exports not found in ${dir}. Expected subscription_reports.csv and subscription_offers.csv.`);
  }
  const hit = cache.get(dir);
  if (hit && hit.key === key) return hit.data;

  const [reportsText, offersText] = await Promise.all([readFile(reportsFile, 'utf8'), readFile(offersFile, 'utf8')]);
  const offerTotals = new Map<string, { rows: number; sum: number }>();
  for (const row of parseCsv(offersText)) {
    const t = offerTotals.get(row.publisher_report_id) ?? { rows: 0, sum: 0 };
    t.rows += 1;
    t.sum += requireInt(row.active_subscriptions, 'active_subscriptions', 'subscription_offers.csv');
    offerTotals.set(row.publisher_report_id, t);
  }
  const data = new Map<string, ExportReport>();
  for (const row of parseCsv(reportsText)) {
    const totals = offerTotals.get(row.publisher_report_id) ?? { rows: 0, sum: 0 };
    data.set(row.publisher_report_id, {
      publisherReportId: row.publisher_report_id, brandId: row.brand_id, marketplace: row.marketplace,
      periodStart: row.period_start, periodEnd: row.period_end, status: row.status,
      generatedAt: row.generated_at, supersededBy: row.superseded_by || null,
      offerCount: requireInt(row.offer_count, 'offer_count', 'subscription_reports.csv'),
      activeSubscriptions: requireInt(row.active_subscriptions, 'active_subscriptions', 'subscription_reports.csv'),
      offerRows: totals.rows, offerSum: totals.sum,
    });
  }
  cache.set(dir, { key, data });
  return data;
}

/** The publisher's current (non-superseded) report for a scope/week, if any. */
export function currentExport(exports: Map<string, ExportReport>, brandId: string, marketplace: string, periodStart: string, asOf: string): ExportReport | null {
  const candidates = [...exports.values()].filter(e => e.brandId === brandId && e.marketplace === marketplace
    && e.periodStart === periodStart && Date.parse(e.generatedAt) <= Date.parse(asOf));
  const ids = new Set(candidates.map(c => c.publisherReportId));
  // Current = not superseded by another report that was published by asOf.
  const current = candidates.filter(c => !c.supersededBy || !ids.has(c.supersededBy));
  current.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  return current[0] ?? null;
}
