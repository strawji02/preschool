'use client'

/**
 * 공급율(supplyRate) 공유 훅 (2026-07-21)
 *
 * 매칭 화면(PrecisionMatchingView)과 최종 보고서(ReportView)가 동일한 공급율을
 * 공유하도록, proposal_extras.supply_rate 로드·debounce 저장을 캡슐화한다.
 *
 * - 기본값 1.25 (25% 마진)
 * - 세션 진입 시 저장값 복원, 변경 시 600ms debounce 후 DB 저장
 * - 두 화면은 동시에 뜨지 않으므로, 화면 전환 시 재로드로 최신값을 공유한다
 *   (예: 매칭에서 1.4로 바꾸면 → 보고서 진입 시 1.4 로드)
 *
 * 반환:
 *   supplyRate    현재 공급율
 *   setSupplyRate 변경 함수 (자동 저장)
 *   initialExtras 로드된 proposal_extras 전체 (보고서가 다른 필드에 사용)
 */
import { useEffect, useState } from 'react'

export function useSupplyRate(sessionId?: string) {
  const [initialExtras, setInitialExtras] = useState<Record<string, unknown> | null>(null)
  const [supplyRate, setSupplyRate] = useState<number>(1.25)
  // 최초 로드 완료 전에는 저장 금지 — 기본 1.25가 저장값을 덮어쓰는 race 방지
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // sessionId 없으면 로드/저장 모두 스킵 (loaded=false 유지 → 저장 effect가 가드)
    if (!sessionId) return
    let cancelled = false
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && data.session?.proposal_extras) {
          const extras = data.session.proposal_extras as Record<string, unknown>
          setInitialExtras(extras)
          const sr = typeof extras.supply_rate === 'number' ? extras.supply_rate : 1.25
          setSupplyRate(sr > 0 ? sr : 1.25)
        }
        setLoaded(true)
      })
      .catch((e) => {
        if (cancelled) return
        console.warn('proposal_extras 로드 실패:', e)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // 공급율 변경 시 DB 저장 (debounce) — 기존 extras 필드 보존
  useEffect(() => {
    if (!sessionId || !loaded) return
    const t = setTimeout(() => {
      const nextExtras = { ...(initialExtras ?? {}), supply_rate: supplyRate }
      fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_extras: nextExtras }),
      }).catch((e) => console.warn('supply_rate 저장 실패:', e))
    }, 600)
    return () => clearTimeout(t)
  }, [supplyRate, sessionId, initialExtras, loaded])

  return { supplyRate, setSupplyRate, initialExtras }
}
