'use client'

/**
 * 고객 제출용 제안서 — 인포그래픽 스타일 (2026-04-27)
 *
 * 설계 방침 (사용자 결정)
 * - 4개 대분류 (농산/축산/수산/가공·기타) 임팩트 카드
 * - HERO 헤드라인: 연간 절감액 강조
 * - 부가서비스 체크리스트 + 자유 입력
 * - 사이트 파란 톤 유지
 * - PDF 출력: window.print() + @media print
 */
import { useEffect, useMemo, useState } from 'react'
import { Printer, Loader2, Save } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  classifyByRule,
  CATEGORY_STYLE,
  FOOD_CATEGORIES,
  type FoodCategory,
} from '@/lib/category-classifier'
import type { ComparisonItem, SupplierScenario } from '@/types/audit'

interface ExtraItem {
  key: string
  label: string
  checked: boolean
  note?: string
  /** 연간 횟수 (예: 4 = 연 4회) */
  count?: number
  /** 인당 단가 (부가세 포함) */
  unit_price?: number
  /** 원아수에 비례 여부 (true: 인당단가 × 원아수 × multiplier, false: 인당단가 × multiplier) */
  per_child?: boolean
  /** 단가 배수 (예: 1.1 = 교사포함, 1.5 = 학부모포함, 1.0 = 기본) */
  multiplier?: number
}

interface ProposalExtras {
  items?: ExtraItem[]
  proposed_to?: string
  based_on_period?: string
  /** 원아 수 (부가서비스 자동 계산용) */
  children_count?: number
}

const DEFAULT_EXTRAS: ExtraItem[] = [
  // 원아수 비례 항목 (per_child: true)
  { key: 'snack',   label: '원아 간식',     checked: false, note: '교사포함 1.1배', count: 4,  unit_price: 5500,   per_child: true,  multiplier: 1.1 },
  { key: 'coffee',  label: '커피차',        checked: false, note: '학부모 1.5배',  count: 5,  unit_price: 5500,   per_child: true,  multiplier: 1.5 },
  { key: 'cooking', label: '요리실습 재료', checked: false, note: '',              count: 4,  unit_price: 5500,   per_child: true,  multiplier: 1.0 },
  // 회당 직접 항목 (per_child: false — 원아수 무관)
  { key: 'mat',     label: '대형매트',      checked: false, note: '2EA 세척·교환', count: 12, unit_price: 55000,  per_child: false, multiplier: 1.0 },
  { key: 'staff',   label: '조리사 대체인력', checked: false, note: '',            count: 5,  unit_price: 165000, per_child: false, multiplier: 1.0 },
]

interface ProposalReportProps {
  sessionId?: string | null
  items: ComparisonItem[]
  ssgScenario: SupplierScenario
  supplierName?: string | null  // 유치원명 (편집 가능)
  initialExtras?: ProposalExtras
}

interface CategoryStat {
  category: FoodCategory
  itemCount: number
  ourCost: number      // 현 거래처 합계 (월)
  ssgCost: number      // 신세계 합계 (월)
  savings: number      // 절감액 (양수)
  savingsPercent: number
}

function computeCategoryStats(items: ComparisonItem[]): CategoryStat[] {
  const map = new Map<FoodCategory, CategoryStat>()
  for (const cat of FOOD_CATEGORIES) {
    map.set(cat, { category: cat, itemCount: 0, ourCost: 0, ssgCost: 0, savings: 0, savingsPercent: 0 })
  }
  for (const item of items) {
    if (item.is_excluded) continue
    const cat = classifyByRule(item.extracted_name, item.extracted_spec)
    const stat = map.get(cat)!
    const qty = item.extracted_quantity || 0
    const ourTotal = item.extracted_total_price ?? item.extracted_unit_price * qty
    const ssgPrice = item.ssg_match?.standard_price
    const ssgTotal = ssgPrice != null ? ssgPrice * qty : ourTotal  // 매칭 없으면 동일 비용
    stat.itemCount += 1
    stat.ourCost += ourTotal
    stat.ssgCost += ssgTotal
  }
  for (const stat of map.values()) {
    stat.savings = Math.max(0, stat.ourCost - stat.ssgCost)
    stat.savingsPercent = stat.ourCost > 0 ? (stat.savings / stat.ourCost) * 100 : 0
  }
  return FOOD_CATEGORIES.map((c) => map.get(c)!).filter((s) => s.itemCount > 0)
}

export function ProposalReport({
  sessionId,
  items,
  ssgScenario,
  supplierName,
  initialExtras,
}: ProposalReportProps) {
  // 부가서비스 state
  const [extras, setExtras] = useState<ExtraItem[]>(() => {
    if (initialExtras?.items && initialExtras.items.length > 0) {
      // DB에 저장된 항목이 있으면 그것을 base로, default와 병합
      const merged = DEFAULT_EXTRAS.map((d) => {
        const saved = initialExtras.items?.find((i) => i.key === d.key)
        return saved ? { ...d, ...saved } : d
      })
      // DB에만 있는 추가 항목도 보존
      const extra = initialExtras.items.filter((i) => !DEFAULT_EXTRAS.some((d) => d.key === i.key))
      return [...merged, ...extra]
    }
    return DEFAULT_EXTRAS
  })
  const [proposedTo, setProposedTo] = useState<string>(initialExtras?.proposed_to || supplierName || '')
  const [period, setPeriod] = useState<string>(
    initialExtras?.based_on_period || new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' }),
  )
  const [childrenCount, setChildrenCount] = useState<number>(initialExtras?.children_count ?? 100)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // 부가서비스 자동 계산 (2026-05-04 수식 확정)
  //   per_child=true:  단가(회당) = 인당단가 × 원아수 × multiplier
  //   per_child=false: 단가(회당) = 인당단가 × multiplier  (원아수 무관)
  //   금액(년) = 단가(회당) × 횟수
  // 예: 원아간식 5,500 × 100 × 1.1 = 605,000   (per_child=true, mult=1.1)
  //     커피차   5,500 × 100 × 1.5 = 825,000   (per_child=true, mult=1.5)
  //     대형매트 55,000 × 1.0      = 55,000    (per_child=false, mult=1.0)
  const extrasComputed = useMemo(() => {
    return extras.map((e) => {
      const base = (e.unit_price ?? 0) * (e.per_child !== false ? childrenCount : 1)
      const perRound = base * (e.multiplier ?? 1)
      const annualAmount = perRound * (e.count ?? 0)
      return { ...e, perRound, annualAmount }
    })
  }, [extras, childrenCount])

  const totalExtrasAnnual = useMemo(
    () => extrasComputed.filter((e) => e.checked).reduce((s, e) => s + e.annualAmount, 0),
    [extrasComputed],
  )

  // 카테고리별 통계 (메모이즈)
  const categoryStats = useMemo(() => computeCategoryStats(items), [items])

  // 메인 합계
  const monthlyOurCost = ssgScenario.totalOurCost
  const monthlySsgCost = ssgScenario.totalSupplierCost
  const monthlySavings = ssgScenario.totalSavings
  const annualOurCost = monthlyOurCost * 12
  const annualSsgCost = monthlySsgCost * 12
  const annualSavings = monthlySavings * 12
  const savingsPercent = monthlyOurCost > 0 ? (monthlySavings / monthlyOurCost) * 100 : 0

  // 부가서비스 토글 / 노트 / 횟수 / 인당단가 변경
  const toggleExtra = (key: string) => {
    setExtras((prev) => prev.map((e) => (e.key === key ? { ...e, checked: !e.checked } : e)))
  }
  const updateExtraNote = (key: string, note: string) => {
    setExtras((prev) => prev.map((e) => (e.key === key ? { ...e, note } : e)))
  }
  const updateExtraCount = (key: string, count: number) => {
    setExtras((prev) => prev.map((e) => (e.key === key ? { ...e, count } : e)))
  }
  const updateExtraUnitPrice = (key: string, unit_price: number) => {
    setExtras((prev) => prev.map((e) => (e.key === key ? { ...e, unit_price } : e)))
  }

  // DB 저장 (수동 또는 변경 시 debounce)
  const persist = async () => {
    if (!sessionId) return
    setSaving(true)
    try {
      const payload: ProposalExtras = {
        items: extras,
        proposed_to: proposedTo,
        based_on_period: period,
        children_count: childrenCount,
      }
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_extras: payload }),
      })
      setSavedAt(new Date())
    } catch (e) {
      console.warn('제안서 부가서비스 저장 실패:', e)
    } finally {
      setSaving(false)
    }
  }

  // debounce 자동 저장 (1.5s)
  useEffect(() => {
    if (!sessionId) return
    const t = setTimeout(() => {
      persist()
    }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extras, proposedTo, period, childrenCount, sessionId])

  // 인쇄 트리거
  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="bg-gray-100 print:bg-white">
      {/* 인쇄 시 숨김: 액션 툴바 */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-6 py-3 shadow-sm print:hidden">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>제안서 미리보기</span>
          {sessionId && (
            <span className="text-xs text-gray-400">
              {saving ? (
                <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> 저장 중…</span>
              ) : savedAt ? (
                <span className="inline-flex items-center gap-1 text-green-700"><Save size={11} /> 자동 저장됨 · {savedAt.toLocaleTimeString('ko-KR')}</span>
              ) : null}
            </span>
          )}
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
        >
          <Printer size={16} /> 인쇄 / PDF 저장
        </button>
      </div>

      {/* 보고서 본체 (인쇄 영역) */}
      <div className="mx-auto max-w-4xl bg-white p-8 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        {/* ─── 헤더 ─── */}
        <header className="mb-8 border-b-2 border-blue-600 pb-6">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-600">
            급식 제안서 · Foodservice Proposal
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-3xl font-bold text-gray-900">
              <input
                value={proposedTo}
                onChange={(e) => setProposedTo(e.target.value)}
                placeholder="유치원명 입력"
                className="w-full border-none bg-transparent text-3xl font-bold text-gray-900 outline-none placeholder:text-gray-300 focus:bg-blue-50 print:bg-transparent"
              />
            </h1>
            <div className="text-right text-sm text-gray-500">
              <div>기준 기간</div>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2024년 8월"
                className="w-32 border-none bg-transparent text-right font-semibold text-gray-900 outline-none focus:bg-blue-50 print:bg-transparent"
              />
            </div>
          </div>
        </header>

        {/* ─── HERO: 연간 절감액 강조 ─── */}
        <section className="mb-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white shadow-lg print:bg-blue-700">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-100">연간 절감 효과</div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-5xl font-bold">{formatCurrency(annualSavings)}</div>
            <div className="text-2xl font-semibold text-blue-100">▼ {savingsPercent.toFixed(1)}%</div>
          </div>
          <div className="mt-3 text-sm text-blue-100">
            월 평균 <strong className="text-white">{formatCurrency(monthlySavings)}</strong> 절감
          </div>
        </section>

        {/* ─── 월/연간 비교 카드 ─── */}
        <section className="mb-10 grid grid-cols-3 gap-4">
          <div className="rounded-xl border-2 border-gray-200 bg-white p-5">
            <div className="mb-1 text-xs font-medium text-gray-500">현 거래처 (월)</div>
            <div className="text-2xl font-bold text-gray-700">{formatCurrency(monthlyOurCost)}</div>
            <div className="mt-2 text-xs text-gray-400">연간 {formatCurrency(annualOurCost)}</div>
          </div>
          <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5">
            <div className="mb-1 text-xs font-medium text-blue-700">신세계푸드 (월)</div>
            <div className="text-2xl font-bold text-blue-900">{formatCurrency(monthlySsgCost)}</div>
            <div className="mt-2 text-xs text-blue-700">연간 {formatCurrency(annualSsgCost)}</div>
          </div>
          <div className="rounded-xl border-2 border-green-300 bg-green-50 p-5">
            <div className="mb-1 text-xs font-medium text-green-700">절감 효과</div>
            <div className="text-2xl font-bold text-green-700">- {formatCurrency(monthlySavings)}</div>
            <div className="mt-2 text-xs text-green-700">▼ {savingsPercent.toFixed(1)}% (월)</div>
          </div>
        </section>

        {/* ─── 카테고리별 절감 (메인) ─── */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-gray-900">카테고리별 절감 (월 기준)</h2>
          <div className="space-y-3">
            {categoryStats.map((stat) => {
              const style = CATEGORY_STYLE[stat.category]
              const barPct = monthlyOurCost > 0 ? (stat.ourCost / monthlyOurCost) * 100 : 0
              return (
                <div
                  key={stat.category}
                  className={cn(
                    'rounded-xl border-2 p-4 transition',
                    style.bg,
                    style.ring,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{style.emoji}</span>
                      <div>
                        <div className={cn('text-base font-bold', style.text)}>{stat.category}</div>
                        <div className="text-[11px] text-gray-500">
                          {formatNumber(stat.itemCount)}개 품목 · 전체의 {barPct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500 line-through">
                        {formatCurrency(stat.ourCost)}
                      </div>
                      <div className={cn('text-lg font-bold', style.text)}>
                        {formatCurrency(stat.ssgCost)}
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-green-700">
                        ▼ {formatCurrency(stat.savings)} ({stat.savingsPercent.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                  {/* 카테고리 비중 바 */}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/60">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        stat.category === '농산' ? 'bg-emerald-500' :
                        stat.category === '축산' ? 'bg-rose-500' :
                        stat.category === '수산' ? 'bg-sky-500' : 'bg-amber-500'
                      )}
                      style={{ width: `${Math.min(100, barPct)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ─── 연간 환산 (부가서비스 위로 이동) ─── */}
        <section className="mb-8 rounded-2xl border-2 border-blue-300 bg-blue-50 p-6 print:break-inside-avoid">
          <h2 className="mb-4 text-xl font-bold text-blue-900">연간 환산 (월 합계 × 12)</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-blue-700">현재</div>
              <div className="mt-1 text-xl font-bold text-gray-700">{formatCurrency(annualOurCost)}</div>
            </div>
            <div className="border-l-2 border-blue-200 pl-4">
              <div className="text-xs text-blue-700">신세계푸드 전환 시</div>
              <div className="mt-1 text-xl font-bold text-blue-900">{formatCurrency(annualSsgCost)}</div>
            </div>
            <div className="border-l-2 border-blue-200 pl-4">
              <div className="text-xs text-blue-700">연간 절감</div>
              <div className="mt-1 text-2xl font-bold text-green-700">- {formatCurrency(annualSavings)}</div>
              <div className="mt-1 text-xs font-semibold text-green-700">▼ {savingsPercent.toFixed(1)}%</div>
            </div>
          </div>
        </section>

        {/* ─── 제안 부가서비스 (예상 절감액) — 임팩트 디자인 ─── */}
        <section className="mb-10 print:break-inside-avoid">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">제안 부가서비스 <span className="ml-1 text-sm font-medium text-gray-500">(예상 절감액)</span></h2>
              <p className="mt-1 text-xs text-gray-500">체크된 항목만 합계에 포함됩니다. 원아수 · 횟수 · 인당 단가만 입력하면 자동 계산됩니다.</p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900 print:border-amber-300">
              원아수
              <input
                type="number"
                min={1}
                value={childrenCount || ''}
                onChange={(e) => setChildrenCount(Math.max(1, Number(e.target.value) || 0))}
                className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-right font-bold text-amber-900 focus:border-amber-500 focus:outline-none print:border-amber-300"
              />
              <span className="text-xs text-amber-700">명</span>
            </label>
          </div>

          {/* 표 */}
          <div className="overflow-hidden rounded-xl border-2 border-amber-200 print:break-inside-avoid">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-100 text-amber-900">
                  <th className="px-2 py-2 text-center text-xs font-bold w-10">선택</th>
                  <th className="px-3 py-2 text-left text-xs font-bold">항목</th>
                  <th className="px-2 py-2 text-center text-xs font-bold w-20">횟수</th>
                  <th className="px-2 py-2 text-right text-xs font-bold w-28">단가(회당)</th>
                  <th className="px-2 py-2 text-right text-xs font-bold w-32">금액(년)</th>
                  <th className="px-2 py-2 text-right text-xs font-bold w-28">인당 단가</th>
                  <th className="px-2 py-2 text-left text-xs font-bold w-44">비고</th>
                </tr>
              </thead>
              <tbody>
                {extrasComputed.map((ex, idx) => (
                  <tr
                    key={ex.key}
                    className={cn(
                      'border-t border-amber-100 transition',
                      ex.checked ? 'bg-amber-50' : 'bg-white opacity-70',
                    )}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={ex.checked}
                        onChange={() => toggleExtra(ex.key)}
                        className="h-4 w-4 cursor-pointer accent-amber-600"
                      />
                    </td>
                    <td className={cn('px-3 py-2 font-medium', ex.checked ? 'text-amber-900' : 'text-gray-600')}>
                      {idx + 1}. {ex.label}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="inline-flex items-center gap-0.5">
                        <input
                          type="number"
                          min={0}
                          value={ex.count ?? ''}
                          onChange={(e) => updateExtraCount(ex.key, Number(e.target.value) || 0)}
                          className="w-12 rounded border border-amber-200 bg-white px-1 py-0.5 text-right text-xs focus:border-amber-500 focus:outline-none print:border-none"
                        />
                        <span className="text-xs text-gray-500">회</span>
                      </div>
                    </td>
                    <td className={cn('px-2 py-2 text-right font-mono', ex.checked ? 'text-gray-800' : 'text-gray-400')}>
                      {ex.unit_price && childrenCount > 0 ? formatNumber(ex.perRound) : '-'}
                    </td>
                    <td className={cn('px-2 py-2 text-right font-mono font-bold', ex.checked ? 'text-amber-900' : 'text-gray-400')}>
                      {ex.unit_price && childrenCount > 0 && (ex.count ?? 0) > 0
                        ? formatNumber(ex.annualAmount)
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={ex.unit_price ?? ''}
                        onChange={(e) => updateExtraUnitPrice(ex.key, Number(e.target.value) || 0)}
                        className="w-24 rounded border border-amber-200 bg-white px-1 py-0.5 text-right font-mono text-xs focus:border-amber-500 focus:outline-none print:border-none"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={ex.note ?? ''}
                        onChange={(e) => updateExtraNote(ex.key, e.target.value)}
                        className="w-full rounded border border-amber-200 bg-white px-1 py-0.5 text-xs focus:border-amber-500 focus:outline-none print:border-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-amber-300 bg-amber-200">
                  <td colSpan={4} className="px-3 py-2.5 text-right text-sm font-bold text-amber-900">
                    계 (년간) — 체크된 항목 합계
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-base font-bold text-amber-900">
                    {formatNumber(totalExtrasAnnual)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 임팩트 — 부가서비스 환원 합계 + 항목 내용 강조
              (절감액은 영업자가 목표로 삼을 참고값, 비교/증감 표시 X) */}
          {(() => {
            const checkedItems = extrasComputed.filter((e) => e.checked && e.annualAmount > 0)
            return (
              <div className="mt-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white shadow-lg print:break-inside-avoid">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-amber-100">
                      영업자 부가서비스 환원 (연간)
                    </div>
                    <div className="mt-1 text-4xl font-extrabold leading-none">
                      {formatCurrency(totalExtrasAnnual)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-widest text-amber-100">참고 · 연간 절감액</div>
                    <div className="text-base font-semibold text-amber-100">{formatCurrency(annualSavings)}</div>
                  </div>
                </div>

                {/* 체크된 항목 내용 강조 */}
                {checkedItems.length > 0 ? (
                  <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {checkedItems.map((e) => (
                      <div
                        key={e.key}
                        className="flex items-baseline justify-between gap-3 rounded-lg bg-white/15 px-3 py-2 backdrop-blur-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{e.label}</div>
                          <div className="text-[11px] text-amber-100">
                            {e.count ?? 0}회 × {formatNumber(e.perRound)}원
                            {e.note && <span className="ml-1 opacity-80">· {e.note}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 font-mono text-base font-bold">
                          {formatCurrency(e.annualAmount)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-amber-100">
                    체크된 부가서비스가 없습니다. 위 표에서 항목을 선택해주세요.
                  </div>
                )}
              </div>
            )
          })()}
        </section>

        {/* ─── 푸터 ─── */}
        <footer className="mt-10 border-t pt-4 text-center text-xs text-gray-400">
          본 제안서는 {period} 거래명세표 기준으로 작성되었습니다.
        </footer>
      </div>
    </div>
  )
}
