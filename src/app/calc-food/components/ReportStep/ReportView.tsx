'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ComparisonItem, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { InvoiceViewer } from '../InvoiceViewer'
import { ReportHeader } from './ReportHeader'
import { ScenarioComparison } from './ScenarioComparison'
import { ItemBreakdownTable } from './ItemBreakdownTable'
import { ProposalReport } from './ProposalReport'
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
    return {
      cj: adjust(scenarios.cj),
      ssg: adjust(scenarios.ssg),
    }
  }, [scenarios, supplyRate])

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

          {/* 시나리오 비교 — supplyRate 적용된 adjustedScenarios 사용 */}
          <section className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              신세계 도입 시 절감액
              {supplyRate !== 1 && (
                <span className="ml-2 text-sm font-normal text-blue-600">
                  (공급율 ×{supplyRate} 적용)
                </span>
              )}
            </h3>
            <ScenarioComparison cjScenario={adjustedScenarios.cj} ssgScenario={adjustedScenarios.ssg} />
          </section>

          {/* 품목별 상세 */}
          <section className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              비교 가능 품목 ({formatNumber(includedItems.length)}개)
              <span className="ml-2 text-sm font-normal text-gray-500">
                — 👁️ 버튼으로 제외 가능
              </span>
            </h3>
            <ItemBreakdownTable
              items={includedItems}
              onToggleExclude={onToggleExclude}
              supplyRate={supplyRate}
            />
          </section>

          {/* 비교 불가 품목 별지 (제외된 품목) */}
          {excludedItems.length > 0 && (
            <section className="mb-8">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">
                비교 불가 품목 별지 ({formatNumber(excludedItems.length)}개)
              </h3>
              <p className="mb-4 text-xs text-gray-600">
                신세계 DB에 매칭 없음 또는 담당자가 제외 — 기존 업체 그대로 유지되며 절감액 계산에서 제외됩니다.
              </p>
              <ItemBreakdownTable
                items={excludedItems}
                onToggleExclude={onToggleExclude}
                supplyRate={supplyRate}
              />
            </section>
          )}

          {/* 총액 검증 */}
          <section className="rounded-xl border-2 border-gray-300 bg-gray-50 p-5">
            <h3 className="mb-3 text-base font-semibold text-gray-900">총액 검증</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">비교 가능 품목 총액</span>
                <span className="font-medium">{formatCurrency(includedTotal)}</span>
              </div>
              {excludedItems.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">비교 불가 품목 총액</span>
                  <span className="font-medium">{formatCurrency(excludedTotal)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-300 pt-2 font-bold text-gray-900">
                <span>기존 업체 거래명세표 총액</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-green-700">
              ✓ 비교 가능 + 비교 불가 = 기존 총액 (원장 일치)
            </p>
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
  return (
    <section className="mb-6 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">공급율 (신세계 견적 배율)</h3>
          <p className="mt-0.5 text-xs text-gray-600">
            모든 신세계 단가에 곱하는 배율 — 변경 절감액 = 기존 − (신세계 × 공급율)
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            예) 1.00 = 원가 그대로 · 1.25 = 25% 마진 · 0.95 = 5% 추가 할인
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
              'w-24 rounded-md border bg-white px-3 py-1.5 text-right text-sm font-semibold focus:outline-none focus:ring-2',
              supplyRate === 1
                ? 'border-gray-300 text-gray-700 focus:border-blue-500 focus:ring-blue-200'
                : 'border-blue-400 text-blue-700 focus:border-blue-500 focus:ring-blue-200',
            )}
          />
          {supplyRate !== 1 && (
            <button
              onClick={() => onChange(1.0)}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              title="공급율 초기화 (1.0)"
            >
              초기화
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
