'use client'

import type { ComparisonItem, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { InvoiceViewer } from '../InvoiceViewer'
import { ReportHeader } from './ReportHeader'
import { ScenarioComparison } from './ScenarioComparison'
import { ItemBreakdownTable } from './ItemBreakdownTable'

interface ReportViewProps {
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
  items: ComparisonItem[]
  fileName: string
  scenarios: {
    cj: SupplierScenario
    ssg: SupplierScenario
  }
  onBackToMatching: () => void
}

export function ReportView({
  pages,
  currentPage,
  onPageSelect,
  items,
  fileName,
  scenarios,
  onBackToMatching,
}: ReportViewProps) {
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
          totalItems={items.length}
          onBackToMatching={onBackToMatching}
        />

        <div className="flex-1 overflow-y-auto p-6">
          {/* 시나리오 비교 */}
          <section className="mb-8">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">공급사별 전환 시나리오</h3>
            <ScenarioComparison cjScenario={scenarios.cj} ssgScenario={scenarios.ssg} />
          </section>

          {/* 품목별 상세 */}
          <section>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">품목별 상세 분석</h3>
            <ItemBreakdownTable items={items} />
          </section>
        </div>
      </div>
    </div>
  )
}
