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
import { Printer, Loader2, Save, FileText, FileBarChart2, ArrowLeft } from 'lucide-react'
import { downloadProposalPptx } from './proposal-pptx'
import { downloadProfitReportPptx } from './profit-pptx'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  classifyItem,
  CATEGORY_STYLE,
  FOOD_CATEGORIES,
  type FoodCategory,
} from '@/lib/category-classifier'
import { estimateSsgTotal } from '@/lib/unit-conversion'
import { CategoryBreakdownCards } from './CategoryBreakdownCards'
import type { ComparisonItem, SupplierScenario } from '@/types/audit'

/** 절감액을 K/M 약식으로 — 정밀 단가 노출 방지 (예: 37,000 → 37K) */
function formatShortKRW(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(amount / 1_000)}K`
  return formatNumber(amount)
}

/** 품목명 단축 — 괄호 안 부가정보 제거 + max 길이 truncate */
function shortItemName(name: string, max = 14): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

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
  /** 계산 알고리즘 (2026-06-30 추가)
   *  - 'simple' (기본): unit_price × children × multiplier
   *  - 'coffee_truck': 엑셀 v1 산식 — 50명 이하 530k, 51명+ ROUNDUP(인원 × 2잔 × 단가 + 부대비용, 100k) */
  algo?: 'simple' | 'coffee_truck'
}

/**
 * 커피차 회당 비용 계산 (엑셀 v1 산식 — 2026-06-30, v2 2026-06-30 잔수 직접)
 * 사용자 요청: 원아수 × 1.5(인원배수) → × 2.0(잔수)으로 변경. multiplier = 1인당 잔수.
 *
 * @param children   원아 수
 * @param cupPrice   잔당 단가 (기본 3,500원, 사용자 input으로 변경 가능)
 * @param cupsPerChild 1인당 준비 잔수 (기본 2.0)
 * @returns 회당 비용 (100,000원 단위 올림, 50명 이하 기본 530,000원)
 *
 * 엑셀 v1 매핑 검증:
 *   50명 이하 → 530,000원 (기본/최소)
 *   60명 → 120잔 × 3,500 + 168k = 588k → ROUNDUP = 600,000원
 *   70명 → 140잔 × 3,500 + 168k = 658k → 700,000원
 *   80명 → 160잔 × 3,500 + 168k = 728k → 800,000원
 *   100명 → 200잔 × 3,500 + 168k = 868k → 900,000원
 */
function calcCoffeeTruckPerRound(
  children: number,
  cupPrice: number = 3500,
  cupsPerChild: number = 2.0,
): number {
  const OVERHEAD = 168_000           // 부대비용 = 배너 34k + 현수막 34k + 출장비 100k
  const MIN_PRICE = 530_000          // 50명 이하 기본 가격
  const ROUND_UNIT = 100_000         // 100,000원 단위 올림

  if (children <= 50) return MIN_PRICE

  const cups = Math.ceil(children * cupsPerChild)
  const beverageCost = cups * cupPrice
  return Math.ceil((beverageCost + OVERHEAD) / ROUND_UNIT) * ROUND_UNIT
}

interface ProposalExtras {
  items?: ExtraItem[]
  proposed_to?: string
  based_on_period?: string
  /** 원아 수 (부가서비스 자동 계산용) */
  children_count?: number
  /** 공급율 (2026-06-27 추가) — ReportView가 별도로 저장하지만, ProposalReport의 debounce가
   * proposal_extras를 덮어쓸 때 supply_rate가 사라지는 버그 fix. payload에 명시적으로 포함. */
  supply_rate?: number
}

const DEFAULT_EXTRAS: ExtraItem[] = [
  // 원아수 비례 항목 (per_child: true)
  { key: 'snack',   label: '원아 간식',     checked: false, note: '교사포함 1.1배', count: 4,  unit_price: 5500,   per_child: true,  multiplier: 1.1 },
  // 커피차 — 엑셀 v1 산식 (2026-06-30 v2: 원아 × 2.0잔 직접) · unit_price = 잔당 단가 (3,500), multiplier = 1인당 잔수
  { key: 'coffee',  label: '커피차',        checked: false, note: '1인당 2잔', count: 5,  unit_price: 3500, per_child: true, multiplier: 2.0, algo: 'coffee_truck' },
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
  /** 공급율 (2026-05-16) — 신세계 견적 배율. 카테고리별 통계에 적용 */
  supplyRate?: number
  /** 분석 화면으로 돌아가기 (2026-06-27) — fixed 버튼을 sticky toolbar 안으로 통합
   *  이전: ReportView의 fixed left-4 top-20 버튼이 print:hidden인데도 PDF에 잡힘 */
  onBackToAnalysis?: () => void
}

interface CategoryTopItem {
  name: string
  savings: number
}

export interface CategoryStat {
  category: FoodCategory
  itemCount: number
  ourCost: number      // 현 거래처 합계 (월)
  ssgCost: number      // 신세계 합계 (월)
  savings: number      // 절감액 (양수)
  savingsPercent: number
  /** 절감액 상위 1~3 품목 — 신뢰성 보강용 (단가 노출 X, 절감액만) */
  topItems: CategoryTopItem[]
}

export function computeCategoryStats(items: ComparisonItem[], supplyRate: number = 1): CategoryStat[] {
  const map = new Map<FoodCategory, CategoryStat>()
  // 카테고리별 항목별 절감액 트래킹 (top3 추출용)
  const itemsByCategory = new Map<FoodCategory, CategoryTopItem[]>()
  for (const cat of FOOD_CATEGORIES) {
    map.set(cat, { category: cat, itemCount: 0, ourCost: 0, ssgCost: 0, savings: 0, savingsPercent: 0, topItems: [] })
    itemsByCategory.set(cat, [])
  }
  for (const item of items) {
    // (2026-07-04) 최종 보고서는 확정 품목만으로 상대비교.
    //   미확정(!is_confirmed)은 비교불가로 처리해 제외 — 미확정 오매칭이 절감액·절감률을
    //   부풀리던 문제 차단(예: 확정 안 한 "부드러운숙식빵"이 51.6% 절감으로 집계되던 케이스).
    //   미확정은 검수 단계에서만 사용자에게 노출한다.
    if (item.is_excluded || !item.is_confirmed) continue
    // DB 매칭(신세계 카테고리) 우선, 없으면 키워드 룰 fallback (2026-05-09)
    const cat = classifyItem(item.extracted_name, item.extracted_spec, item.ssg_match?.category)
    const stat = map.get(cat)!
    const qty = item.extracted_quantity || 0
    // (2026-05-17) per-item Math.round — 엑셀 SUM(F/L/M) per-row 합산과 정합성 유지
    //   Excel: SUM(F)=Σround(item), SUM(L)=Σround(ssg*rate)
    //   화면: stat.ourCost=Σround(item), stat.ssgCost=Σround(ssg*rate)
    //   둘 다 동일한 per-item 반올림 → 모든 표시 위치 합계 일치 (0원 차이)
    const ourTotal = Math.round(item.extracted_total_price ?? item.extracted_unit_price * qty)
    // 정밀 환산 (KPI/엑셀과 통일) — 단순 standard_price × qty 가 아닌 ppk × 단위중량 환산
    // (2026-05-16) supplyRate 적용 — 변경 절감액 = 기존 - (신세계 × supplyRate)
    const ssgTotal = item.ssg_match ? Math.round(estimateSsgTotal(item) * supplyRate) : ourTotal
    stat.itemCount += 1
    stat.ourCost += ourTotal
    stat.ssgCost += ssgTotal

    // 항목별 절감액 (양수만)
    const itemSavings = ourTotal - ssgTotal
    if (itemSavings > 0 && item.ssg_match) {
      itemsByCategory.get(cat)!.push({ name: item.extracted_name, savings: itemSavings })
    }
  }
  for (const stat of map.values()) {
    // (2026-07-22) 정직 표시 — clamp(Math.max(0,·)) 제거.
    //   신세계가 더 비싼 카테고리는 순손실(음수)로 표시해야 카드 합 == 헤드라인 절감액.
    //   이전 clamp는 음수를 0으로 감춰 "카드 합 ≠ 헤드라인"(예: 농산 -54,233 누락) 발생.
    stat.savings = stat.ourCost - stat.ssgCost
    stat.savingsPercent = stat.ourCost > 0 ? (stat.savings / stat.ourCost) * 100 : 0
    // 상위 3건만 (절감액 큰 순)
    stat.topItems = itemsByCategory.get(stat.category)!
      .sort((a, b) => b.savings - a.savings)
      .slice(0, 3)
  }
  return FOOD_CATEGORIES.map((c) => map.get(c)!).filter((s) => s.itemCount > 0)
}

export function ProposalReport({
  sessionId,
  items,
  ssgScenario,
  supplierName,
  initialExtras,
  supplyRate = 1,
  onBackToAnalysis,
}: ProposalReportProps) {
  // 부가서비스 state
  const [extras, setExtras] = useState<ExtraItem[]>(() => {
    if (initialExtras?.items && initialExtras.items.length > 0) {
      // DB에 저장된 항목이 있으면 그것을 base로, default와 병합
      const merged = DEFAULT_EXTRAS.map((d) => {
        const saved = initialExtras.items?.find((i) => i.key === d.key)
        if (!saved) return d
        // 커피차 마이그레이션 (2026-06-30 v2)
        //   · unit_price: 5500(인당) → 3500(잔당) 자동
        //   · multiplier: 1.5(인원 배수) → 2.0(1인당 잔수) 자동
        //   · algo 강제 'coffee_truck'
        if (d.key === 'coffee') {
          return {
            ...d,
            ...saved,
            algo: 'coffee_truck' as const,
            unit_price: saved.unit_price === 5500 ? 3500 : (saved.unit_price ?? 3500),
            multiplier: saved.multiplier === 1.5 ? 2.0 : (saved.multiplier ?? 2.0),
          }
        }
        return { ...d, ...saved }
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

  // initialExtras prop이 비동기로 늦게 도착한 경우 state 동기화 + 자동 저장 ready 플래그
  // (마운트 시점에 fetch가 안 끝났으면 useState initial은 DEFAULT_EXTRAS만 잡음 → 사용자가 본 저장값과 다름)
  // ready=false 동안 자동 저장도 막아 DB 덮어쓰기 방지
  const [extrasReady, setExtrasReady] = useState(false)
  useEffect(() => {
    if (!initialExtras) {
      // 한 번도 저장된 적 없는 세션 → ready=true (자동 저장 허용)
      setExtrasReady(true)
      return
    }
    if (initialExtras.items && initialExtras.items.length > 0) {
      const merged = DEFAULT_EXTRAS.map((d) => {
        const saved = initialExtras.items?.find((i) => i.key === d.key)
        if (!saved) return d
        // 커피차 마이그레이션 (2026-06-30 v2)
        //   · unit_price: 5500(인당) → 3500(잔당) 자동
        //   · multiplier: 1.5(인원 배수) → 2.0(1인당 잔수) 자동
        //   · algo 강제 'coffee_truck'
        if (d.key === 'coffee') {
          return {
            ...d,
            ...saved,
            algo: 'coffee_truck' as const,
            unit_price: saved.unit_price === 5500 ? 3500 : (saved.unit_price ?? 3500),
            multiplier: saved.multiplier === 1.5 ? 2.0 : (saved.multiplier ?? 2.0),
          }
        }
        return { ...d, ...saved }
      })
      const extra = initialExtras.items.filter((i) => !DEFAULT_EXTRAS.some((d) => d.key === i.key))
      setExtras([...merged, ...extra])
    }
    if (initialExtras.proposed_to) setProposedTo(initialExtras.proposed_to)
    if (initialExtras.based_on_period) setPeriod(initialExtras.based_on_period)
    if (typeof initialExtras.children_count === 'number') setChildrenCount(initialExtras.children_count)
    setExtrasReady(true)
  }, [initialExtras])

  // 부가서비스 자동 계산 (2026-05-04 수식 / 2026-06-30 커피차 분기 추가)
  //   per_child=true:  단가(회당) = 인당단가 × 원아수 × multiplier
  //   per_child=false: 단가(회당) = 인당단가 × multiplier  (원아수 무관)
  //   금액(년) = 단가(회당) × 횟수
  // 예: 원아간식 5,500 × 100 × 1.1 = 605,000   (per_child=true, mult=1.1)
  //     대형매트 55,000 × 1.0      = 55,000    (per_child=false, mult=1.0)
  //
  // (2026-06-30) 커피차는 별도 산식 — algo='coffee_truck':
  //   인원 = 원아 × multiplier (학부모 포함 1.5배)
  //   인원 ≤ 50명: 530,000원 (기본/최소)
  //   인원 > 50명: ROUNDUP(인원 × 2잔 × 잔당단가 + 168,000, 100,000)
  const extrasComputed = useMemo(() => {
    return extras.map((e) => {
      let perRound: number
      if (e.algo === 'coffee_truck' || e.key === 'coffee') {
        // 커피차 — 엑셀 v1 산식 (multiplier = 1인당 잔수, 기본 2.0)
        perRound = calcCoffeeTruckPerRound(
          childrenCount,
          e.unit_price ?? 3500,
          e.multiplier ?? 2.0,
        )
      } else {
        // 기본 산식
        const base = (e.unit_price ?? 0) * (e.per_child !== false ? childrenCount : 1)
        perRound = base * (e.multiplier ?? 1)
      }
      const annualAmount = perRound * (e.count ?? 0)
      return { ...e, perRound, annualAmount }
    })
  }, [extras, childrenCount])

  const totalExtrasAnnual = useMemo(
    () => extrasComputed.filter((e) => e.checked).reduce((s, e) => s + e.annualAmount, 0),
    [extrasComputed],
  )

  // 카테고리별 통계 (메모이즈)
  const categoryStats = useMemo(() => computeCategoryStats(items, supplyRate), [items, supplyRate])

  // 메인 합계 (2026-05-16) — 표시/산식 완전 정합성 보장
  // categoryStats(이미 round됨)를 single source로 사용:
  //   카테고리 합 = 월합 = 연합/12 (모든 화면에서 정확히 일치)
  // 이전 결함: ssgScenario.totalSupplierCost(raw float)에 ×12 → 표시(반올림) 불일치
  // 예) 표시 ₩4,738,072 × 12 ≠ 표시 ₩56,856,858 (6원 차이)
  const monthlyOurCost = categoryStats.reduce((s, c) => s + c.ourCost, 0)
  const monthlySsgCost = categoryStats.reduce((s, c) => s + c.ssgCost, 0)
  const monthlySavings = monthlyOurCost - monthlySsgCost
  const annualOurCost = monthlyOurCost * 12
  const annualSsgCost = monthlySsgCost * 12
  const annualSavings = monthlySavings * 12
  const savingsPercent = monthlyOurCost > 0 ? (monthlySavings / monthlyOurCost) * 100 : 0

  // (2026-07-04) 절감률 분모 명시 — 확정 품목만으로 상대비교했음을 투명하게 표기.
  //   미확정·비교불가는 절감 계산에서 제외되므로 "확정 M / 전체 N 기준"을 hero에 노출.
  const comparedCount = items.filter((i) => i.is_confirmed && !i.is_excluded).length
  const excludedCount = items.length - comparedCount

  // (2026-06-30 v2) 커피차 비고 자동 동기화 — "기본 N잔" 표시
  //   N = 50명 이하: 100잔 고정 / 51명+: 원아 × multiplier(잔수, 기본 2.0)
  //   childrenCount 변경 시 note 자동 갱신
  useEffect(() => {
    setExtras((prev) => {
      let changed = false
      const next = prev.map((e) => {
        if (e.key !== 'coffee' && e.algo !== 'coffee_truck') return e
        const cupsPerChild = e.multiplier ?? 2.0
        const cups = childrenCount <= 50 ? 100 : Math.ceil(childrenCount * cupsPerChild)
        const autoNote = `기본 ${cups}잔`
        if (e.note === autoNote) return e
        changed = true
        return { ...e, note: autoNote }
      })
      return changed ? next : prev
    })
  }, [childrenCount])

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
  // (2026-06-27) 버그 fix — initialExtras spread + supply_rate 명시 포함
  //   기존: payload에 supply_rate 없어서 ReportView가 저장한 공급율(1.25 등)을
  //         ProposalReport의 debounce가 덮어써서 1.0으로 reset 되는 문제
  //   해결: 기존 proposal_extras 전체 보존(spread) + 명시적으로 supply_rate prop 전달
  const persist = async () => {
    if (!sessionId) return
    setSaving(true)
    try {
      const payload: ProposalExtras = {
        ...(initialExtras ?? {}),  // 기존 모든 필드 보존 (supply_rate 등)
        items: extras,
        proposed_to: proposedTo,
        based_on_period: period,
        children_count: childrenCount,
        supply_rate: supplyRate,  // ReportView가 prop으로 전달한 값을 보존
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
  // ready=false 동안은 저장 X — initialExtras fetch 도착 전에 DEFAULT 데이터로 DB 덮어쓰기 방지
  // (2026-06-27) supplyRate를 deps에 포함하지 않음 — ReportView가 별도로 저장하므로
  //   여기 deps에 두면 supplyRate 변경 시 ProposalReport·ReportView 두 곳에서 동시 PATCH 발생.
  //   대신 persist() payload에 supplyRate 포함시켜 다른 필드 저장 시 supplyRate가 reset 안 되도록 보장.
  useEffect(() => {
    if (!sessionId || !extrasReady) return
    const t = setTimeout(() => {
      persist()
    }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extras, proposedTo, period, childrenCount, sessionId, extrasReady])

  // 인쇄/PDF 출력 시 가로 방향 (A4 landscape)
  // (2026-06-27 v2) @page margin 15mm 균등 + ProposalReport 컨테이너의 print:max-w-[230mm]가
  //   좌측 정렬을 실제로 만든다. v1의 margin-right 50mm는 max-w-[260mm]가 가득 채워서 효과 없었음.
  //   현재: A4 landscape 297mm - margin 30mm = 267mm 영역 / max-w-[230mm] 콘텐츠 좌측 정렬
  //   → 우측 자연 여백 약 37mm (약 14%)
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      @media print {
        @page { size: A4 landscape; margin: 15mm; }
      }
    `
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])

  // 인쇄 트리거
  const handlePrint = () => {
    window.print()
  }

  // 신세계 DB 최종 sync 연월 — 푸터 '{X년 Y월} 신세계 단가 기준' 표시용 (2026-05-17)
  const [ssgPeriod, setSsgPeriod] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/products/last-sync')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.period) setSsgPeriod(d.period as string)
      })
      .catch((e) => console.warn('신세계 sync 날짜 조회 실패:', e))
  }, [])

  // PPT 다운로드 (영업자 편집 가능 — 텍스트/도형/색상 그대로)
  const [pptxLoading, setPptxLoading] = useState(false)
  const handleDownloadPptx = async () => {
    setPptxLoading(true)
    try {
      await downloadProposalPptx({
        proposedTo,
        period,
        monthlyOurCost,
        monthlySsgCost,
        monthlySavings,
        annualOurCost,
        annualSsgCost,
        annualSavings,
        savingsPercent,
        categoryStats,
        extras: extrasComputed,
        totalExtrasAnnual,
        childrenCount,
        ssgPeriod: ssgPeriod ?? undefined,
      })
    } catch (e) {
      console.error('PPT 다운로드 실패:', e)
      alert('PPT 다운로드 실패: ' + (e instanceof Error ? e.message : 'Unknown'))
    } finally {
      setPptxLoading(false)
    }
  }

  // 영업자 손익 보고서 PPT — 계약식(제4조): 영업자 정산금 = 원가 × (마진율 − 플랫폼 5%)
  //   마진율 민감도 표는 현재 공급율(supplyRate)을 중심으로 ±3%×3단계 동적 생성
  const [profitLoading, setProfitLoading] = useState(false)
  const handleDownloadProfit = async () => {
    setProfitLoading(true)
    try {
      await downloadProfitReportPptx({
        proposedTo,
        period,
        annualSupplyRevenue: annualSsgCost, // 현재 공급율 기준 판매가 = 원가 × supplyRate
        supplyRate,                          // 작성자가 설정한 현재 공급율 (중심)
        annualOurCost,                       // 원장 현재가(비교가능, 연) — 유치원 제공 서비스 기준
        annualSavings,
        savingsPercent,
        childrenCount,
        ssgPeriod: ssgPeriod ?? undefined,
      })
    } catch (e) {
      console.error('손익 보고서 다운로드 실패:', e)
      alert('손익 보고서 다운로드 실패: ' + (e instanceof Error ? e.message : 'Unknown'))
    } finally {
      setProfitLoading(false)
    }
  }

  return (
    <div className="bg-gray-100 print:bg-white">
      {/* 인쇄 시 숨김: 액션 툴바 */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white px-6 py-3 shadow-sm print:hidden">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          {onBackToAnalysis && (
            <button
              onClick={onBackToAnalysis}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              title="분석 화면으로 돌아가기"
            >
              <ArrowLeft size={14} /> 분석 화면
            </button>
          )}
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
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPptx}
            disabled={pptxLoading}
            title="유치원 원장 제출용 급식 제안서 (2페이지 · 편집 가능)"
            className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-100 disabled:opacity-60"
          >
            {pptxLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            ① 유치원 제출용 제안서
          </button>
          <button
            onClick={handleDownloadProfit}
            disabled={profitLoading}
            title="급식을 공급하는 영업자용 예상 손익 보고서 (1페이지 · 편집 가능)"
            className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-60"
          >
            {profitLoading ? <Loader2 size={16} className="animate-spin" /> : <FileBarChart2 size={16} />}
            ② 영업자 손익 보고서
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            <Printer size={16} /> 인쇄 / PDF 저장
          </button>
        </div>
      </div>

      {/* 보고서 본체 (인쇄 영역)
          PDF: A4 landscape (267mm 가로 — 15mm 마진 차감)
          (2026-06-27 v2) 좌측 정렬 + 우측 여백 — print:max-w-[230mm]가 실효
            · 화면: max-w-4xl + ml-0/mr-auto = 좌측 정렬, 우측 자연 여백
            · PDF: print:max-w-[230mm] (이전 260mm 대비 -30mm) → 우측 37mm 여백
            · ml-0 mr-auto가 print에도 적용되어 PDF 좌측 정렬 */}
      <div className="ml-0 mr-auto max-w-4xl bg-white px-14 py-8 shadow-lg print:max-w-[230mm] print:px-5 print:py-0 print:shadow-none">
        {/* ─── 헤더 ─── */}
        <header className="mb-8 border-b-2 border-blue-600 pb-6 print:mb-2 print:pb-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-600">
            급식 제안서 · Foodservice Proposal
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-3xl font-bold text-gray-900 print:text-2xl">
              <input
                value={proposedTo}
                onChange={(e) => setProposedTo(e.target.value)}
                placeholder="유치원명 입력"
                className="w-full border-none bg-transparent text-3xl font-bold text-gray-900 outline-none placeholder:text-gray-300 focus:bg-blue-50 print:bg-transparent print:text-2xl"
              />
            </h1>
            <div className="text-right text-sm text-gray-500">
              <div className="flex items-baseline justify-end gap-4">
                <div>
                  <div>기준 기간</div>
                  <input
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    placeholder="2024년 8월"
                    className="w-32 border-none bg-transparent text-right font-semibold text-gray-900 outline-none focus:bg-blue-50 print:bg-transparent"
                  />
                </div>
                {/* 원아 수 표시 (2026-06-27) — 사용자 입력값을 PDF/PPT에도 반영 */}
                <div>
                  <div>원아 수</div>
                  <div className="text-right font-semibold text-gray-900 tabular-nums">
                    {formatNumber(childrenCount)} <span className="text-xs font-medium text-gray-500">명</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ─── HERO: 연간 절감액 강조 ─── */}
        <section className="mb-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white shadow-lg print:mb-2 print:p-3 print:bg-blue-700 print:break-inside-avoid">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-100">연간 절감 효과</div>
          <div className="mt-2 flex items-baseline gap-3 print:mt-0.5">
            <div className="text-5xl font-bold print:text-3xl">{formatCurrency(annualSavings)}</div>
            <div className="text-2xl font-semibold text-blue-100 print:text-lg">▼ {savingsPercent.toFixed(1)}%</div>
          </div>
          <div className="mt-3 text-sm text-blue-100 print:mt-0.5 print:text-xs">
            월 평균 <strong className="text-white">{formatCurrency(monthlySavings)}</strong> 절감
          </div>
          {/* (2026-07-04) 절감률 분모 명시 — 확정 품목만 상대비교했음을 투명하게 */}
          <div className="mt-1.5 text-xs text-blue-200 print:mt-0.5 print:text-[9px]">
            비교 완료 <strong className="text-white">{comparedCount}</strong>품목 기준
            {excludedCount > 0 && ` · 미확정·비교불가 ${excludedCount}품목 제외`}
          </div>
        </section>

        {/* ─── 월/연간 비교 카드 ─── */}
        <section className="mb-10 grid grid-cols-3 gap-4 print:mb-2 print:gap-2">
          <div className="rounded-xl border-2 border-gray-200 bg-white p-5 print:p-2">
            <div className="mb-1 text-xs font-medium text-gray-500">현 거래처 (월)</div>
            <div className="text-2xl font-bold text-gray-700 print:text-base">{formatCurrency(monthlyOurCost)}</div>
            <div className="mt-2 text-xs text-gray-400 print:mt-0 print:text-[10px]">연간 {formatCurrency(annualOurCost)}</div>
          </div>
          <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 print:p-2">
            <div className="mb-1 text-xs font-medium text-blue-700">신세계푸드 (월)</div>
            <div className="text-2xl font-bold text-blue-900 print:text-base">{formatCurrency(monthlySsgCost)}</div>
            <div className="mt-2 text-xs text-blue-700 print:mt-0 print:text-[10px]">연간 {formatCurrency(annualSsgCost)}</div>
          </div>
          <div className="rounded-xl border-2 border-green-300 bg-green-50 p-5 print:p-2">
            <div className="mb-1 text-xs font-medium text-green-700">절감 효과</div>
            <div className="text-2xl font-bold text-green-700 print:text-base">- {formatCurrency(monthlySavings)}</div>
            <div className="mt-2 text-xs text-green-700 print:mt-0 print:text-[10px]">▼ {savingsPercent.toFixed(1)}% (월)</div>
          </div>
        </section>

        {/* ─── 비용 효율 비교 (PDF 디자인 반영, 2026-05-16) ─── */}
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm print:mb-2 print:p-3 print:break-inside-avoid">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 print:text-sm">비용 효율 비교</h2>
            <div className="flex items-center gap-4 text-[11px] print:text-[10px]">
              <span className="inline-flex items-center gap-1.5 text-gray-600">
                <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                현재 공급사 (100%)
              </span>
              <span className="inline-flex items-center gap-1.5 font-bold text-blue-700">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-700" />
                신세계푸드 ({(100 - savingsPercent).toFixed(1)}%)
              </span>
            </div>
          </div>
          {/* 가로 막대 */}
          <div className="relative mt-3 h-8 overflow-hidden rounded-full bg-gray-100 print:h-6">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-blue-700 transition-all"
              style={{ width: `${Math.min(100, 100 - savingsPercent)}%` }}
            />
            {/* 신세계 % 라벨 (막대 끝) */}
            <span
              className="absolute inset-y-0 flex items-center text-xs font-bold text-white print:text-[10px]"
              style={{ left: `calc(${Math.min(100, 100 - savingsPercent)}% - 3rem)` }}
            >
              {(100 - savingsPercent).toFixed(1)}%
            </span>
            <span className="absolute inset-y-0 right-3 flex items-center text-[11px] text-gray-500 print:text-[10px]">
              100%
            </span>
          </div>
          {/* 하단 — 메시지 + 절감 강조 */}
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-xs text-gray-500 print:text-[10px]">
              공급망 최적화를 통한 직접 비용 절감
            </span>
            <span className="text-sm font-bold text-blue-700 print:text-xs">
              월 평균 {formatCurrency(monthlySavings)} 절감 · 절감율 : {savingsPercent.toFixed(1)}%
            </span>
          </div>
        </section>

        {/* ─── 카테고리별 절감 (PDF 디자인 — 1x4 가로 그리드)
              (2026-06-27) 1페이지 강제 break-after-page + 자체 break-inside-avoid
              · 1페이지 콘텐츠가 두 페이지로 분할되어 총 3+ 페이지로 늘어나는 문제 fix
              · PPT처럼 정확히 2페이지(1p: 헤더+HERO+비교+카테고리 / 2p: 연간환산+부가서비스) */}
        <section className="mb-8 print:mb-0 print:break-inside-avoid print:break-after-page">
          <div className="mb-3 flex items-baseline gap-2 print:mb-1">
            <h2 className="text-base font-bold text-gray-900 print:text-sm">카테고리별 절감</h2>
            <span className="text-xs text-gray-500 print:text-[10px]">(월 기준)</span>
          </div>
          <CategoryBreakdownCards stats={categoryStats} cols={4} />
        </section>

        {/* ─── 2페이지 시작 — 콘텐츠 적어 수직 중앙 정렬 + 좌우 적절한 padding ─── */}
        <div className="print:flex print:min-h-[180mm] print:flex-col print:justify-center print:break-before-page">
        {/* ─── 연간 환산 — 1페이지 HERO와 톤 통일 (2026-06-27)
              · 짙은 navy → 밝은 blue (from-blue-600 to-blue-700)
              · 노란 큰 글자 제거 → 흰 글자 + 황색 ▼% pill (HERO 동일 패턴) ─── */}
        <section className="mb-4 mt-8 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg print:mt-0 print:bg-blue-700 print:break-inside-avoid">
          <div className="px-7 pt-6 pb-4 print:px-6 print:pt-5 print:pb-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-blue-100">
              연간 환산 (월 합계 × 12)
            </div>

            {/* 현재 ↔ 전환 시 — 좌우 비교 (한 줄) */}
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-white/10 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-blue-100">현재</div>
                <div className="mt-1 whitespace-nowrap text-2xl font-bold text-white tabular-nums print:text-xl">
                  {formatCurrency(annualOurCost)}
                </div>
              </div>
              <div className="rounded-xl bg-white/20 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-blue-100">신세계푸드 전환 시</div>
                <div className="mt-1 whitespace-nowrap text-2xl font-bold text-white tabular-nums print:text-xl">
                  {formatCurrency(annualSsgCost)}
                </div>
              </div>
            </div>
          </div>

          {/* 연간 절감 — 별도 행 + HERO 동일 패턴 (흰 큰 숫자 + 황색 ▼% pill) */}
          <div className="border-t border-white/20 bg-blue-700/40 px-7 py-5 print:px-6 print:py-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-blue-100">연간 절감</div>
                <div className="mt-1 whitespace-nowrap text-4xl font-extrabold text-white tabular-nums print:text-3xl">
                  {formatCurrency(annualSavings)}
                </div>
              </div>
              <div className="rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-blue-900 shadow-sm print:text-xs">
                ▼ {savingsPercent.toFixed(1)}%
              </div>
            </div>
          </div>
        </section>

        {/* ─── 연결 메시지 — 2페이지 톤 통일(amber→blue), 2026-06-27 ─── */}
        <div className="my-3 flex items-center justify-center gap-3 print:my-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blue-300 to-blue-400" />
          <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-4 py-1.5 text-sm font-semibold text-blue-800 ring-2 ring-blue-200">
            <span className="text-base">↓</span>
            이 절감액이 유치원 부가서비스로 제공됩니다
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-blue-300 to-blue-400" />
        </div>

        {/* ─── 제안 부가서비스 (예상 절감액) — 임팩트 디자인 ─── */}
        <section className="mb-10 print:break-inside-avoid">
          {/* 입력 표 영역 — 화면에서만 작업, PDF 출력 시 숨김 */}
          <div className="print:hidden">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">제안 부가서비스 <span className="ml-1 text-sm font-medium text-gray-500">(예상 절감액)</span></h2>
                <p className="mt-1 text-xs text-gray-500">체크된 항목만 합계에 포함됩니다. 원아수 · 횟수 · 인당 단가만 입력하면 자동 계산됩니다.</p>
              </div>
              <label className="flex items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900">
                원아수
                <input
                  type="number"
                  min={1}
                  value={childrenCount || ''}
                  onChange={(e) => setChildrenCount(Math.max(1, Number(e.target.value) || 0))}
                  className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-right font-bold text-amber-900 focus:border-amber-500 focus:outline-none"
                />
                <span className="text-xs text-amber-700">명</span>
              </label>
            </div>

          {/* 표 */}
          <div className="overflow-hidden rounded-xl border-2 border-amber-200">
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
          </div>
          {/* /입력 표 영역 (print:hidden) */}

          {/* 임팩트 — 부가서비스 환원 합계 + 항목 내용 강조 (2026-06-27 v2 밝게)
                · 사용자 피드백: "차콜이 너무 어둡고 무거워" → slate-800/900 → slate-500/600 한 단계 밝게
                · slate-500 to slate-600 — 차분하지만 밝은 톤, 가독성 ↑
                · emerald pill/text 유지 (절감→환원 의미)
                · 항목 카드 ring/backdrop 강도 ↑ */}
          {(() => {
            const checkedItems = extrasComputed.filter((e) => e.checked && e.annualAmount > 0)
            return (
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-600 p-6 text-white shadow-lg print:bg-slate-500 print:break-inside-avoid">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-100">
                      <span>유치원 제안 부가서비스 (연간)</span>
                      {/* 원아 수 라벨 (2026-06-27) — 부가서비스 계산 기준 명시 */}
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-white ring-1 ring-white/15">
                        원아 {formatNumber(childrenCount)}명 기준
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <div className="text-4xl font-extrabold leading-none tabular-nums">
                        {formatCurrency(totalExtrasAnnual)}
                      </div>
                      <div className="rounded-full bg-emerald-400 px-2.5 py-0.5 text-[11px] font-bold text-emerald-950 shadow-sm">
                        ▲ 환원
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-widest text-slate-100">참고 · 연간 절감액</div>
                    <div className="text-base font-semibold text-emerald-200 tabular-nums">{formatCurrency(annualSavings)}</div>
                  </div>
                </div>

                {/* 체크된 항목 내용 강조 */}
                {checkedItems.length > 0 ? (
                  <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {checkedItems.map((e) => (
                      <div
                        key={e.key}
                        className="flex items-baseline justify-between gap-3 rounded-lg bg-white/15 px-3 py-2 backdrop-blur-sm ring-1 ring-white/10"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-white">{e.label}</div>
                          <div className="text-[11px] text-slate-100 tabular-nums">
                            {e.count ?? 0}회 × {formatNumber(e.perRound)}원
                            {e.note && <span className="ml-1 opacity-80">· {e.note}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 font-mono text-base font-bold text-white tabular-nums">
                          {formatCurrency(e.annualAmount)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200">
                    체크된 부가서비스가 없습니다. 위 표에서 항목을 선택해주세요.
                  </div>
                )}
              </div>
            )
          })()}
        </section>

        {/* ─── 푸터 — 2페이지 안에 통합 (2026-06-27) — 별도 3페이지 발생 방지 ─── */}
        <footer className="mt-6 border-t pt-3 text-center text-xs text-gray-400 print:mt-3 print:pt-2">
          본 제안서는 {period} 거래명세표 기준으로 작성되었습니다.
        </footer>
        </div>
        {/* /2페이지 묶음 (footer 포함) */}
      </div>
    </div>
  )
}
