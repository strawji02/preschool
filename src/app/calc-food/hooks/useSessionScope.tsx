'use client'

/**
 * 지금 보고 있는 세션 id를 화면 전체가 공유한다 — docs/systems/comparison.md §9
 *
 * ★ **왜 필요한가** — 품목 검색·상세 조회 API가 **세션 기준월 단가**로 답해야 한다.
 * 그 라우트를 부르는 자리가 화면 6곳에 흩어져 있고, 그중 어느 것도 세션 id를
 * 받지 않는다 (`SearchPanel`, `ProductSearchModal`, `PrecisionView`,
 * `CandidatesAndSearchPanel` …). prop을 4단계로 내려보내는 대신 여기서 공유한다.
 *
 * ★ **기준월은 서버가 읽는다.** 화면은 세션 id만 붙인다 — 화면이 달을 정하면
 * 검수 화면과 저장된 절감액이 갈릴 수 있다.
 *
 * ⚠️ **없어도 동작해야 한다.** 제공자 밖에서 쓰이면 `null`을 주고, 그러면 쿼리에
 * 아무것도 붙지 않아 **기존 동작**(products 단가)이 된다.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'

const SessionScopeContext = createContext<string | null>(null)

export function SessionScopeProvider({
  sessionId,
  children,
}: {
  sessionId: string | null | undefined
  children: ReactNode
}) {
  const value = useMemo(() => sessionId ?? null, [sessionId])
  return <SessionScopeContext.Provider value={value}>{children}</SessionScopeContext.Provider>
}

/** 지금 세션 id. 제공자 밖이면 null */
export function useSessionId(): string | null {
  return useContext(SessionScopeContext)
}

/**
 * 품목 API 쿼리에 붙일 조각. 세션이 없으면 빈 문자열.
 *
 * ```ts
 * const scope = useSessionScopeParam()
 * fetch(`/api/products/search?q=${q}${scope}`)
 * ```
 */
export function useSessionScopeParam(): string {
  const sessionId = useSessionId()
  return sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''
}
