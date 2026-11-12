import 'server-only';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { openDatabase, ROOT } from '../../src/database.ts';
import { ReviewStore } from '../../src/review/store.ts';
import { ReviewError, ReviewService } from '../../src/review/service.ts';

/** The app keeps its own working copy of the source snapshot so it never contends with the CLI
 * (`.runtime/marketplace`). Review state lives in `.review-store/` (see src/review/store.ts). */
const APP_RUNTIME = path.join(ROOT, '.runtime', 'app-marketplace');

type Holder = { promise?: Promise<ReviewService>; closing?: boolean };
const holder = ((globalThis as Record<string, unknown>).__reviewService ??= {}) as Holder;

export function getService(): Promise<ReviewService> {
  if (!holder.promise) {
    holder.promise = (async () => {
      const db = await openDatabase(false, process.env.REVIEW_SOURCE_DIR ?? APP_RUNTIME);
      const store = await ReviewStore.open(process.env.REVIEW_STORE_DIR ?? undefined);
      const service = new ReviewService(db, store, { exportsDir: process.env.REVIEW_EXPORTS_DIR });
      const shutdown = async () => {
        if (holder.closing) return;
        holder.closing = true;
        try { await store.close(); await db.close(); } finally { process.exit(0); }
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      return service;
    })();
    // Allow a retry after a failed start (e.g. a locked or missing data directory).
    holder.promise.catch(() => { holder.promise = undefined; });
  }
  return holder.promise;
}

export async function handle<T>(fn: (service: ReviewService) => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    const service = await getService();
    return NextResponse.json(await fn(service), { status });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[review api]', error);
    const unavailable = /Python|PGlite|exports not found|ENOENT|locked/i.test(message);
    return NextResponse.json({ error: {
      code: unavailable ? 'SOURCE_UNAVAILABLE' : 'INTERNAL',
      message: unavailable ? `The evidence sources could not be read: ${message}` : 'Unexpected server error. Details are in the server log.',
      details: [] } }, { status: unavailable ? 503 : 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ReviewError('INVALID_REQUEST', 400, 'Request body must be a JSON object.');
}
