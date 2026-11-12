import type { CaseView } from '../../src/review/service.ts';

export type { CaseView };
export type Scope = {
  brandId: string; brandName: string; marketplace: string; caseId: string | null;
  latestOutcome: string | null; latestVersion: number; decidedAt: string | null; reports: number;
};

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details: string[] = []) { super(message); }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'Cannot reach the review server. Check that `npm run dev` is still running, then retry.', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const e = body?.error;
    throw new ApiError(e?.code ?? 'HTTP_' + response.status, e?.message ?? `Request failed (${response.status}).`, response.status, e?.details ?? []);
  }
  return body as T;
}

export const api = {
  scopes: (signal?: AbortSignal) => request<Scope[]>('/api/scopes', { signal }),
  openCase: (brandId: string, marketplace: string, signal?: AbortSignal) =>
    request<CaseView>('/api/cases', { method: 'POST', body: JSON.stringify({ brandId, marketplace }), signal }),
  getCase: (caseId: string, signal?: AbortSignal) => request<CaseView>(`/api/cases/${encodeURIComponent(caseId)}`, { signal }),
  saveDecision: (caseId: string, body: Record<string, unknown>) =>
    request<CaseView>(`/api/cases/${encodeURIComponent(caseId)}/decisions`, { method: 'POST', body: JSON.stringify(body) }),
  generateReport: (caseId: string) => request<CaseView>(`/api/cases/${encodeURIComponent(caseId)}/report`, { method: 'POST', body: '{}' }),
  reportUrl: (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/report`,
};
