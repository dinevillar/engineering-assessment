import { handle } from '../../lib/server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function GET() { return handle(service => service.scopes()); }
