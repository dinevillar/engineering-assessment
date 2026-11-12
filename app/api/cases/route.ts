import { handle, readJson } from '../../lib/server.ts';
import { ReviewError } from '../../../src/review/service.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Opens the review case for a brand/marketplace (creating it on first open). */
export function POST(request: Request) {
  return handle(async service => {
    const body = await readJson(request);
    if (typeof body.brandId !== 'string' || typeof body.marketplace !== 'string') {
      throw new ReviewError('INVALID_REQUEST', 400, 'brandId and marketplace are required.');
    }
    return service.openCase(body.brandId, body.marketplace);
  });
}
