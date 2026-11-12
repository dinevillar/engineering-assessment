import type { Evidence, Quality, Recommendation } from './types.ts';

/** Reporting and recommendation policy (DATA_DICTIONARY.md). Single source of truth for
 * what the application may suggest or approve; the model provider never decides it. */
export const MIN_GROWTH_PCT = 10;
export const ALLOWED_EXPANSION_PCT = 10;

export interface PolicyOutcome {
  action: 'expand_promotion' | 'hold';
  budgetChangePct: number;
  /** True only when a growth-based expansion is supported by verified, comparable evidence. */
  expansionSupported: boolean;
  /** Plain-language reason for the supported action. */
  rationale: string;
}

export function evaluatePolicy(evidence: Evidence, quality: Quality): PolicyOutcome {
  if (quality.status !== 'ready' || evidence.growthPct === null) {
    const first = quality.reasons[0] ?? 'Comparable complete weekly snapshots are not available.';
    return { action: 'hold', budgetChangePct: 0, expansionSupported: false,
      rationale: `Hold: no comparable weekly growth can be claimed. ${first}` };
  }
  if (evidence.growthPct >= MIN_GROWTH_PCT) {
    return { action: 'expand_promotion', budgetChangePct: ALLOWED_EXPANSION_PCT, expansionSupported: true,
      rationale: `Verified complete weekly growth of ${evidence.growthPct}% meets the ${MIN_GROWTH_PCT}% threshold; a ${ALLOWED_EXPANSION_PCT}% expansion may be suggested for brand-manager review.` };
  }
  return { action: 'hold', budgetChangePct: 0, expansionSupported: false,
    rationale: `Hold: verified complete weekly change is ${evidence.growthPct}%, below the ${MIN_GROWTH_PCT}% threshold for an expansion.` };
}

/** Validates a provider proposal against the policy. Returns accepted/rejected with reasons. */
export function validateProposal(proposal: Recommendation, policy: PolicyOutcome): { accepted: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!['expand_promotion', 'hold'].includes(proposal.action)) problems.push(`Unknown action "${proposal.action}".`);
  if (!Number.isFinite(proposal.budgetChangePct)) problems.push('Budget change is not a number.');
  if (proposal.action === 'expand_promotion' && !policy.expansionSupported) {
    problems.push('Proposes a promotion expansion, but the evidence does not support a comparable growth claim.');
  }
  if (proposal.action === 'expand_promotion' && proposal.budgetChangePct !== ALLOWED_EXPANSION_PCT) {
    problems.push(`Proposes a ${proposal.budgetChangePct}% expansion; policy allows exactly ${ALLOWED_EXPANSION_PCT}%.`);
  }
  if (proposal.action === 'hold' && proposal.budgetChangePct !== 0) problems.push('A hold cannot change the budget.');
  return { accepted: problems.length === 0, problems };
}
