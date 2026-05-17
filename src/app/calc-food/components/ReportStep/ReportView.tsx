'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ComparisonItem, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { InvoiceViewer } from '../InvoiceViewer'
import { ReportHeader } from './ReportHeader'
import { ScenarioComparison } from './ScenarioComparison'
import { ItemBreakdownTable } from './ItemBreakdownTable'
import { ProposalReport, computeCategoryStats } from './ProposalReport'
import { CategoryBreakdownCards } from './CategoryBreakdownCards'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'

interface ReportViewProps {
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
  items: ComparisonItem[]
  fileName: string
  supplierName?: string | null
  scenarios: {
    cj: SupplierScenario
    ssg: SupplierScenario
  }
  onBackToMatching: () => void
  onToggleExclude?: (itemId: string, reason?: string) => void  // 2026-04-21
  onUpdateSupplierName?: (name: string) => void  // 2026-04-21
  // 제안서 모드 (2026-04-27)
  sessionId?: string | null
  /** 거래명세표 재확인/수정 모달 트리거 (2026-05-10) */
  onOpenInvoiceReview?: () => void
}

export function ReportView({
  pages,
  currentPage,
  onPageSelect,
  items,
  fileName,
  supplierName,
  scenarios,
  onBackToMatching,
  onToggleExclude,
  onUpdateSupplierName,
  sessionId,
  onOpenInvoiceReview,
}: ReportViewProps) {
  // 'analysis' = 검수자 분석 화면 (좌측 이미지 + 우측 분석)
  // 'proposal' = 고객 제출용 제안서 (인포그래픽)
  const [mode, setMode] = useState<'analysis' | 'proposal'>('analysis')

  // 세션 진입 시 저장된 proposal_extras 로드
  const [initialExtras, setInitialExtras] = useState<Record<string, unknown> | null>(null)
  // (2026-05-16) 공급율 — 신세계 견적에 곱하는 배율 (1.0 = 원가, 1.25 = 25% 마진 등)
  // 변경 절감액 = 기존 - (신세계 × supplyRate)
  const [supplyRate, setSupplyRate] = useState<number>(1.0)
  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.session?.proposal_extras) {
          const extras = data.session.proposal_extras as Record<string, unknown>
          setInitialExtras(extras)
          // 공급율 복원
          const sr = typeof extras.supply_rate === 'number' ? extras.supply_rate : 1.0
          setSupplyRate(sr > 0 ? sr : 1.0)
        }
      })
      .catch((e) => console.warn('proposal_extras 로드 실패:', e))
  }, [sessionId])

  // 공급율 변경 시 DB 저장 (debounce)
  useEffect(() => {
    if (!sessionId) return
    if (supplyRate === 1.0 && !initialExtras) return  // 초기 1.0은 저장 X
    const t = setTimeout(() => {
      const nextExtras = { ...(initialExtras ?? {}), supply_rate: supplyRate }
      fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_extras: nextExtras }),
      }).catch((e) => console.warn('supply_rate 저장 실패:', e))
    }, 600)
    return () => clearTimeout(t)
  }, [supplyRate, sessionId, initialExtras])

  const excludedItems = items.filter(i => i.is_excluded)
  const includedItems = items.filter(i => !i.is_excluded)
  // 세액 포함 총액(원장 총액)으로 집계. extracted_total_price가 없으면 공급가액으로 대체.
  const itemBilled = (i: typeof items[number]) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity
  const excludedTotal = excludedItems.reduce((s, i) => s + itemBilled(i), 0)
  const includedTotal = includedItems.reduce((s, i) => s + itemBilled(i), 0)
  const grandTotal = excludedTotal + includedTotal

  // (2026-05-16) 공급율 적용 scenarios — 변경 절감액 = 기존 - (신세계 × supplyRate)
  // (2026-05-17) ssg는 categoryStats 합(round per-category)을 single source로 override —
  //   ScenarioComparison hero와 CategoryBreakdownCards 합계가 반올림 손실로 어긋나는 문제 fix.
  //   ProposalReport와 동일한 fix (해당 파일 line 222-226 주석 참조).
  const adjustedScenarios = useMemo(() => {
    const adjust = (s: SupplierScenario): SupplierScenario => {
      const adjustedSupplierCost = s.totalSupplierCost * supplyRate
      const adjustedSavings = s.totalOurCost - adjustedSupplierCost
      const adjustedPercent = s.totalOurCost > 0 ? (adjustedSavings / s.totalOurCost) * 100 : 0
      return {
        ...s,
        totalSupplierCost: adjustedSupplierCost,
        totalSavings: adjustedSavings,
        savingsPercent: adjustedPercent,
      }
    }
    const adjustedSsg = adjust(scenarios.ssg)
    // ssg만 category-stats 합으로 정밀 일치 (CJ는 카테고리 분석 X)
    const ssgStats = computeCategoryStats(includedItems, supplyRate)
    const sumOur = ssgStats.reduce((s, c) => s + c.ourCost, 0)
    const sumSsg = ssgStats.reduce((s, c) => s + c.ssgCost, 0)
    const sumSavings = sumOur - sumSsg
    const sumPct = sumOur > 0 ? (sumSavings / sumOur) * 100 : 0
    return {
      cj: adjust(scenarios.cj),
      ssg: {
        ...adjustedSsg,
        totalOurCost: sumOur,
        totalSupplierCost: sumSsg,
        totalSavings: sumSavings,
        savingsPercent: sumPct,
      },
    }
  }, [scenarios, supplyRate, includedItems])

  // 제안서 모드: 풀스크린 인포그래픽
  if (mode === 'proposal') {
    return (
      <div className="relative">
        {/* 모드 전환 버튼 (인쇄 시 숨김) */}
        <button
          onClick={() => setMode('analysis')}
          className="fixed left-4 top-20 z-20 flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow hover:bg-gray-50 print:hidden"
        >
          ← 분석 화면
        </button>
        <ProposalReport
          sessionId={sessionId}
          items={items}
          ssgScenario={adjustedScenarios.ssg}
          supplierName={supplierName}
          initialExtras={initialExtras as never}
          supplyRate={supplyRate}
        />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* 좌측: 이미지 뷰어 (50%) */}
      <div className="w-1/2 border-r">
        <InvoiceViewer pages={pages} currentPage={currentPage} onPageSelect={onPageSelect} />
      </div>

      {/* 우측: 리포트 (50%) */}
      <div className="flex w-1/2 flex-col overflow-hidden">
        <ReportHeader
          fileName={fileName}
          supplierName={supplierName}
          totalItems={items.length}
          items={items}
          onBackToMatching={onBackToMatching}
          onUpdateSupplierName={onUpdateSupplierName}
          onOpenInvoiceReview={onOpenInvoiceReview}
          onOpenProposal={() => setMode('proposal')}
          supplyRate={supplyRate}
        />

        <div className="flex-1 overflow-y-auto p-6">
          {/* (2026-05-16) 공급율 입력 — 신세계 견적에 배율 적용 */}
          <SupplyRateInput supplyRate={supplyRate} onChange={setSupplyRate} />

          {/* 시나리오 비교 — supplyRate 적용된 adjustedScenarios 사용
             (2026-05-16) ScenarioComparison hero가 절감액 강조 — 별도 h3 제거 (중복 해소) */}
          <section className="mb-6">
            {supplyRate !== 1 && (
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                공급율 ×{supplyRate} 적용
              </div>
            )}
            <ScenarioComparison cjScenario={adjustedScenarios.cj} ssgScenario={adjustedScenarios.ssg} />
          </section>

          {/* 카테고리별 절감 카드 그리드 (2026-05-16 — PPTX 디자인 컨셉)
             좌 아이콘 + 우상 절감률 배지 + 카테고리(영문) + 주요 품목 + 큰 절감액 */}
          {includedItems.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-baseline gap-1.5">
                <h3 className="text-sm font-semibold text-gray-900">카테고리별 절감</h3>
                <span className="text-[11px] text-gray-500">(월 기준)</span>
              </div>
              <CategoryBreakdownCards
                stats={computeCategoryStats(includedItems, supplyRate)}
              />
            </section>
          )}

          {/* 품목별 상세 (2026-05-16 — 헤더 콤팩트화) */}
          <section className="mb-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                비교 가능 품목
                <span className="ml-1.5 text-xs font-normal text-gray-500">
                  ({formatNumber(includedItems.length)}개)
                </span>
              </h3>
              <span className="text-[11px] text-gray-500">👁️ 클릭으로 제외</span>
            </div>
            <ItemBreakdownTable
              items={includedItems}
              onToggleExclude={onToggleExclude}
              supplyRate={supplyRate}
            />
          </section>

          {/* 비교 불가 품목 별지 (제외된 품목) — 콤팩트 헤더 */}
          {excludedItems.length > 0 && (
            <section className="mb-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  비교 불가 품목 별지
                  <span className="ml-1.5 text-xs font-normal text-gray-500">
                    ({formatNumber(excludedItems.length)}개)
                  </span>
                </h3>
                <span className="text-[11px] text-gray-500">절감 계산 제외</span>
              </div>
              <p className="mb-3 text-[11px] text-gray-500">
                매칭 없음 또는 담당자 제외 — 기존 업체 그대로 유지
              </p>
              <ItemBreakdownTable
                items={excludedItems}
                onToggleExclude={onToggleExclude}
                supplyRate={supplyRate}
              />
            </section>
          )}

          {/* 총액 검증 — 콤팩트 (3행 inline) */}
          <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                총액 검증
              </span>
              <span className="text-[11px] text-green-700">✓ 원장 일치</span>
            </div>
            <div className="space-y-1 tabular-nums">
              <div className="flex justify-between text-gray-600">
                <span>비교 가능 ({formatNumber(includedItems.length)}개)</span>
                <span className="font-medium text-gray-800">{formatCurrency(includedTotal)}</span>
              </div>
              {excludedItems.length > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>비교 불가 ({formatNumber(excludedItems.length)}개)</span>
                  <span className="font-medium text-gray-500">{formatCurrency(excludedTotal)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-300 pt-1.5 font-bold text-gray-900">
                <span>거래명세표 총액</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * 공급율 입력 컴포넌트 (2026-05-16)
 *
 * 신세계 견적에 일괄 적용되는 배율 (예: 1.25 = 25% 마진 추가).
 * 변경 절감액 = 기존 - (신세계 × supplyRate)
 *
 * 0.5 ~ 2.0 범위, 0.01 step. proposal_extras.supply_rate에 저장.
 */
function SupplyRateInput({
  supplyRate,
  onChange,
}: {
  supplyRate: number
  onChange: (rate: number) => void
}) {
  const [draft, setDraft] = useState(supplyRate.toFixed(2))
  useEffect(() => {
    setDraft(supplyRate.toFixed(2))
  }, [supplyRate])
  const active = supplyRate !== 1
  return (
    <section className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          공급율
        </span>
        <span className="truncate text-[11px] text-gray-500" title="모든 신세계 단가에 곱하는 배율">
          신세계 단가 ×N (예: 1.25 = 25% 마진)
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          step="0.01"
          min="0.5"
          max="2"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(draft)
            if (Number.isFinite(n) && n >= 0.5 && n <= 2) {
              onChange(Number(n.toFixed(2)))
            } else {
              setDraft(supplyRate.toFixed(2))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur()
            }
          }}
          className={cn(
            'w-20 rounded-md border px-2.5 py-1 text-right text-sm font-semibold focus:outline-none focus:ring-2',
            active
              ? 'border-blue-400 bg-blue-50 text-blue-700 focus:border-blue-500 focus:ring-blue-200'
              : 'border-gray-300 bg-white text-gray-700 focus:border-blue-500 focus:ring-blue-200',
          )}
        />
        {active && (
          <button
            onClick={() => onChange(1.0)}
            className="rounded-md border border-gray-300 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
            title="공급율 초기화 (1.0)"
          >
            ↺
          </button>
        )}
      </div>
    </section>
  )
}
