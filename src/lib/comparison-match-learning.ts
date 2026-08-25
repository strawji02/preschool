import type { SupplierMatch } from '@/types/audit'

export type LearnedDecisionScope = 'session' | 'supplier' | 'global'

export interface LearnedDecisionEvidence {
  productId: string
  confirmations: number
  scope: LearnedDecisionScope
}

const SCOPE_PRIORITY: Record<LearnedDecisionScope, number> = {
  session: 3,
  supplier: 2,
  global: 1,
}

/**
 * 거래명세표의 품명·규격·원산지·단위를 과거 결정과 비교하기 위한 안정적인 키로 만든다.
 * 표시용 원문은 audit_items에 그대로 보존하고, 이 값은 조회/집계에만 사용한다.
 */
export function normalizeComparisonMatchKey(value?: string | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_/,()[\]{}*×xX.\-]+/g, '')
    .trim()
}

/**
 * 가장 구체적인 범위(session → supplier → global)에서 단독 1위만 고른다.
 * 전역 1회성 결정은 다른 기관/공급사로 퍼뜨리지 않는다.
 */
export function chooseLearnedDecision(
  evidence: LearnedDecisionEvidence[],
): LearnedDecisionEvidence | null {
  if (evidence.length === 0) return null

  const bestPriority = Math.max(...evidence.map((item) => SCOPE_PRIORITY[item.scope]))
  const scoped = evidence.filter((item) => SCOPE_PRIORITY[item.scope] === bestPriority)
  const byProduct = new Map<string, LearnedDecisionEvidence>()

  for (const item of scoped) {
    const existing = byProduct.get(item.productId)
    if (existing) existing.confirmations += item.confirmations
    else byProduct.set(item.productId, { ...item })
  }

  const ranked = [...byProduct.values()].sort(
    (a, b) => b.confirmations - a.confirmations || a.productId.localeCompare(b.productId),
  )
  const winner = ranked[0]
  const runnerUp = ranked[1]

  if (!winner || (runnerUp && runnerUp.confirmations === winner.confirmations)) return null
  if (winner.scope === 'global' && winner.confirmations < 2) return null
  return winner
}

/** 과거 확정 후보를 1위로 올리되 기존 후보 목록은 검수용으로 유지한다. */
export function mergeLearnedCandidate(
  candidates: SupplierMatch[],
  learned: SupplierMatch,
  limit = 5,
): SupplierMatch[] {
  return [learned, ...candidates.filter((candidate) => candidate.id !== learned.id)].slice(0, limit)
}
