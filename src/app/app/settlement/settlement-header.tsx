import Link from 'next/link'
import type { ReactNode } from 'react'
import { SETTLEMENT_VERSION } from '@/features/shared/version'

/**
 * 급식 정산 시스템 공통 헤더 (2026-07-31).
 *
 * 세 화면이 각자 다른 상단을 갖고 있었다 — 정산은 형제 링크 2개가 제목 아래
 * 버튼으로, 수금·지급은 1개가 우측에, 보고서는 아예 없었다. 어디에 있는지도
 * 어디로 갈 수 있는지도 화면마다 달라 매번 다시 읽어야 했다.
 *
 * **탭 하나로 통일한다.** 세 화면은 한 시스템의 월간 흐름이므로
 * (정산·마감 → 수금·지급 → 보고서) 탭이 관계를 그대로 드러낸다. 현재 위치는
 * 밑줄로 보이니 breadcrumb에 잎 노드를 또 쓰지 않는다.
 *
 * 서버 컴포넌트로 둔 이유: `usePathname` 대신 `active`를 명시로 받으면
 * 클라이언트 번들이 늘지 않고, 경로가 바뀌어도 조용히 틀리지 않는다.
 */

export type SettlementTab = 'settlement' | 'collection' | 'report'

const TABS: { key: SettlementTab; label: string; href: string }[] = [
  { key: 'settlement', label: '급식 정산', href: '/app/settlement' },
  { key: 'collection', label: '수금·지급', href: '/app/settlement/collection' },
  { key: 'report', label: '경영 보고서', href: '/app/settlement/report' },
]

export default function SettlementHeader({
  active,
  title,
  description,
  right,
}: {
  active: SettlementTab
  title: string
  description: ReactNode
  /** 연월 선택기·상태 배지 등 화면별 우측 요소 */
  right?: ReactNode
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="text-sm text-gray-400">
          <Link href="/app" className="transition hover:text-gray-900">
            업무 시스템
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-600">급식 정산 시스템</span>
        </nav>

        {/*
          ⚠️ **빌드 시각이 아니라 정산 시스템이 마지막으로 바뀐 시각이다.**
          비교 시스템만 고쳐서 배포하면 여기 값은 그대로 남는다 (docs §16).
        */}
        <p
          className="text-xs tabular-nums text-gray-400"
          title={`커밋 ${SETTLEMENT_VERSION.sha}`}
        >
          <span className="font-medium text-gray-500">{SETTLEMENT_VERSION.version}</span>
          <span className="mx-1.5 text-gray-300">·</span>
          {SETTLEMENT_VERSION.at} 배포
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500">
            {description}
          </p>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>

      {/* ── 탭 ── */}
      <nav className="mt-5 flex gap-1 border-b border-gray-200" aria-label="급식 정산 시스템">
        {TABS.map((tab) => {
          const on = tab.key === active
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={on ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${
                on
                  ? 'border-gray-900 font-semibold text-gray-900'
                  : 'border-transparent font-medium text-gray-500 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
