export const int = (v: number | null | undefined): string => v === null || v === undefined ? '—' : v.toLocaleString('en-US');
export const pct = (v: number | null | undefined): string => v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export const day = (iso: string | null | undefined): string => !iso ? '—'
  : new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const range = (a: string, b: string): string => `${day(a)} – ${day(b)}`;
export const stamp = (iso: string | null | undefined): string => !iso ? '—'
  : new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
export const money = (v: number): string => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const growth = (a: number | null, b: number | null): number | null => a === null || b === null || b <= 0 ? null : Math.round((a / b - 1) * 10000) / 100;

export const OUTCOME_SHORT: Record<string, string> = {
  approve_expansion: 'Expand 10%', hold: 'Hold', hold_pending_data: 'Hold · data fix',
};
export const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: '' },
  decided: { label: 'Decision saved', tone: 'accent' },
  reported: { label: 'Report ready', tone: 'ok' },
  needs_attention: { label: 'Needs attention', tone: 'danger' },
};
export const SEVERITY: Record<string, { label: string; tone: string }> = {
  blocking: { label: 'Blocking', tone: 'danger' },
  corrected: { label: 'Corrected', tone: 'warn' },
  warning: { label: 'Warning', tone: '' },
};
