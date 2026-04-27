'use client'

import { useEffect, useState } from 'react'
import { FileText, ClipboardList } from 'lucide-react'
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
}: ReportViewProps) {
  // 'analysis' = 검수자 분석 화면 (좌측 이미지 + 우측 분석)
  // 'proposal' = 고객 제출용 제안서 (인포그래픽)
  const [mode, setMode] = useState<'analysis' | 'proposal'>('analysis')

  // 세션 진입 시 저장된 proposal_extras 로드
  const [initialExtras, setInitialExtras] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.session?.proposal_extras) {
          setInitialExtras(data.session.proposal_extras)
        }
      })
      .catch((e) => console.warn('proposal_extras 로드 실패:', e))
  }, [sessionId])

  const excludedItems = items.filter(i => i.is_excluded)
  const includedItems = items.filter(i => !i.is_excluded)
  // 세액 포함 총액(원장 총액)으로 집계. extracted_total_price가 없으면 공급가액으로 대체.
  const itemBilled = (i: typeof items[number]) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity
  const excludedTotal = excludedItems.reduce((s, i) => s + itemBilled(i), 0)
  const includedTotal = includedItems.reduce((s, i) => s + itemBilled(i), 0)
  const grandTotal = excludedTotal + includedTotal

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
          ssgScenario={scenarios.ssg}
          supplierName={supplierName}
          initialExtras={initialExtras as never}
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
      <div className="relative flex w-1/2 flex-col overflow-hidden">
        <ReportHeader
          fileName={fileName}
          supplierName={supplierName}
          totalItems={items.length}
          items={items}
          onBackToMatching={onBackToMatching}
          onUpdateSupplierName={onUpdateSupplierName}
        />
        {/* 제안서 모드 진입 (2026-04-27) */}
        <button
          onClick={() => setMode('proposal')}
          className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-blue-700"
          title="고객 제출용 제안서 (인포그래픽 보고서)"
        >
          <ClipboardList size={16} />
          제안서 보기
        </button>

        <div className="flex-1 overflow-y-auto p-6">
          {/* 시나리오 비교 */}
          <section className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">신세계 도입 시 절감액</h3>
            <ScenarioComparison cjScenario={scenarios.cj} ssgScenario={scenarios.ssg} />
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
