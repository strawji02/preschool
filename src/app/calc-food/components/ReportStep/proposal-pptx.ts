/**
 * 제안서 PPT 다운로드 (PptxGenJS) — 2슬라이드 구조 (2026-05-10)
 *
 * Slide 1: 헤더 + HERO + 비교 카드 + 카테고리별 절감 (PDF 1페이지와 동일)
 * Slide 2: 연간 환산 + 유치원 제안 부가서비스 (PDF 2페이지와 동일)
 *
 * 모든 텍스트가 PPT 도형/텍스트로 구성되어 영업자가 직접 편집 가능.
 */
import type { FoodCategory } from '@/lib/category-classifier'
import { formatCurrency, formatNumber } from '@/lib/format'

interface CategoryStat {
  category: FoodCategory
  itemCount: number
  ourCost: number
  ssgCost: number
  savings: number
  savingsPercent: number
  topItems: { name: string; savings: number }[]
}

interface ExtraItem {
  key: string
  label: string
  checked: boolean
  note?: string
  count?: number
  unit_price?: number
  per_child?: boolean
  multiplier?: number
}

export interface ProposalPptxData {
  proposedTo: string
  period: string
  monthlyOurCost: number
  monthlySsgCost: number
  monthlySavings: number
  annualOurCost: number
  annualSsgCost: number
  annualSavings: number
  savingsPercent: number
  categoryStats: CategoryStat[]
  extras: (ExtraItem & { perRound: number; annualAmount: number })[]
  totalExtrasAnnual: number
  childrenCount: number
}

const COLORS = {
  blueDark: '1E40AF',
  blueMain: '2563EB',
  blueLight: 'DBEAFE',
  blueText: '1E3A8A',
  amberMain: 'F59E0B',
  amberText: '92400E',
  green: '047857',
  greenLight: 'D1FAE5',
  gray700: '374151',
  gray500: '6B7280',
  gray300: 'D1D5DB',
  white: 'FFFFFF',
  emerald: '10B981',
  rose: 'F43F5E',
  sky: '0EA5E9',
  amber: 'F59E0B',
}

const CATEGORY_COLORS: Record<FoodCategory, { bar: string; light: string; text: string; emoji: string }> = {
  '농산': { bar: COLORS.emerald, light: 'ECFDF5', text: '047857', emoji: '🥬' },
  '축산': { bar: COLORS.rose, light: 'FFF1F2', text: 'BE123C', emoji: '🥩' },
  '수산': { bar: COLORS.sky, light: 'F0F9FF', text: '0369A1', emoji: '🐟' },
  '가공·기타': { bar: COLORS.amber, light: 'FFFBEB', text: '92400E', emoji: '🍞' },
}

function shortKRW(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return formatNumber(n)
}

function shortName(name: string, max = 10): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

export async function downloadProposalPptx(data: ProposalPptxData) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  pptx.layout = 'LAYOUT_WIDE'  // 13.333 × 7.5 inch
  pptx.title = `${data.proposedTo} 급식 제안서`
  pptx.author = '신세계푸드'
  pptx.company = '신세계푸드'

  // ════════════════════════════════════════════════════════════════
  // Slide 1: 헤더 + HERO + 비교 카드 + 카테고리별 절감 (PDF 1페이지)
  // ════════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  s1.background = { color: 'FFFFFF' }

  // ── 헤더 (y 0.25 ~ 1.05) ──
  s1.addText('급식 제안서 · FOODSERVICE PROPOSAL', {
    x: 0.5, y: 0.25, w: 12.3, h: 0.25,
    fontSize: 9, bold: true, color: COLORS.blueMain, charSpacing: 2,
  })
  s1.addText(data.proposedTo || '유치원명', {
    x: 0.5, y: 0.45, w: 8, h: 0.55,
    fontSize: 26, bold: true, color: COLORS.gray700, fontFace: 'Pretendard',
  })
  s1.addText('기준 기간', {
    x: 9.5, y: 0.45, w: 3.3, h: 0.25,
    fontSize: 9, color: COLORS.gray500, align: 'right',
  })
  s1.addText(data.period, {
    x: 9.5, y: 0.7, w: 3.3, h: 0.3,
    fontSize: 12, bold: true, color: COLORS.gray700, align: 'right',
  })
  // 청색 분리선
  s1.addShape('rect', {
    x: 0.5, y: 1.08, w: 12.3, h: 0.04,
    fill: { color: COLORS.blueMain }, line: { type: 'none' },
  })

  // ── HERO 카드 (y 1.25 ~ 2.45, 높이 1.2) ──
  s1.addShape('roundRect', {
    x: 0.5, y: 1.25, w: 12.3, h: 1.2,
    fill: { color: COLORS.blueMain }, line: { type: 'none' }, rectRadius: 0.12,
  })
  s1.addText('연간 절감 효과', {
    x: 0.85, y: 1.4, w: 6, h: 0.25,
    fontSize: 10, bold: true, color: 'BFDBFE', charSpacing: 2,
  })
  s1.addText(formatCurrency(data.annualSavings), {
    x: 0.85, y: 1.65, w: 7, h: 0.6,
    fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Pretendard',
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: 6.5, y: 1.85, w: 2.5, h: 0.4,
    fontSize: 18, bold: true, color: 'FBBF24',
  })
  s1.addText(`월 평균 ${formatCurrency(data.monthlySavings)} 절감`, {
    x: 0.85, y: 2.15, w: 11.5, h: 0.25,
    fontSize: 10, color: 'BFDBFE',
  })

  // ── 비교 카드 3분할 (y 2.6 ~ 3.7, 높이 1.1) ──
  const cmpY = 2.6
  const cmpH = 1.1
  const cmpW = 4.0
  const cmpGap = 0.15
  const cmpStartX = 0.5

  // 현 거래처
  s1.addShape('roundRect', {
    x: cmpStartX, y: cmpY, w: cmpW, h: cmpH,
    fill: { color: 'FFFFFF' }, line: { color: COLORS.gray300, width: 1.5 },
    rectRadius: 0.1,
  })
  s1.addText('현 거래처 (월)', {
    x: cmpStartX + 0.2, y: cmpY + 0.12, w: cmpW - 0.4, h: 0.25,
    fontSize: 10, bold: true, color: COLORS.gray500,
  })
  s1.addText(formatCurrency(data.monthlyOurCost), {
    x: cmpStartX + 0.2, y: cmpY + 0.38, w: cmpW - 0.4, h: 0.45,
    fontSize: 22, bold: true, color: COLORS.gray700,
  })
  s1.addText(`연간 ${formatCurrency(data.annualOurCost)}`, {
    x: cmpStartX + 0.2, y: cmpY + 0.85, w: cmpW - 0.4, h: 0.2,
    fontSize: 9, color: COLORS.gray500,
  })

  // 신세계푸드
  const cmpX2 = cmpStartX + cmpW + cmpGap
  s1.addShape('roundRect', {
    x: cmpX2, y: cmpY, w: cmpW, h: cmpH,
    fill: { color: COLORS.blueLight }, line: { color: '93C5FD', width: 1.5 },
    rectRadius: 0.1,
  })
  s1.addText('신세계푸드 (월)', {
    x: cmpX2 + 0.2, y: cmpY + 0.12, w: cmpW - 0.4, h: 0.25,
    fontSize: 10, bold: true, color: '1D4ED8',
  })
  s1.addText(formatCurrency(data.monthlySsgCost), {
    x: cmpX2 + 0.2, y: cmpY + 0.38, w: cmpW - 0.4, h: 0.45,
    fontSize: 22, bold: true, color: COLORS.blueText,
  })
  s1.addText(`연간 ${formatCurrency(data.annualSsgCost)}`, {
    x: cmpX2 + 0.2, y: cmpY + 0.85, w: cmpW - 0.4, h: 0.2,
    fontSize: 9, color: '1D4ED8',
  })

  // 절감 효과
  const cmpX3 = cmpX2 + cmpW + cmpGap
  s1.addShape('roundRect', {
    x: cmpX3, y: cmpY, w: cmpW, h: cmpH,
    fill: { color: COLORS.greenLight }, line: { color: '6EE7B7', width: 1.5 },
    rectRadius: 0.1,
  })
  s1.addText('절감 효과', {
    x: cmpX3 + 0.2, y: cmpY + 0.12, w: cmpW - 0.4, h: 0.25,
    fontSize: 10, bold: true, color: COLORS.green,
  })
  s1.addText(`- ${formatCurrency(data.monthlySavings)}`, {
    x: cmpX3 + 0.2, y: cmpY + 0.38, w: cmpW - 0.4, h: 0.45,
    fontSize: 22, bold: true, color: COLORS.green,
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}% (월)`, {
    x: cmpX3 + 0.2, y: cmpY + 0.85, w: cmpW - 0.4, h: 0.2,
    fontSize: 9, color: COLORS.green,
  })

  // ── 카테고리 섹션 제목 (y 3.85) ──
  s1.addText('카테고리별 절감 (월 기준)', {
    x: 0.5, y: 3.85, w: 12.3, h: 0.3,
    fontSize: 12, bold: true, color: COLORS.gray700,
  })

  // ── 카테고리 카드 4개 (y 4.2 ~ 7.0, 각 0.65 + gap 0.05) ──
  const catY0 = 4.2
  const catH = 0.65
  const catGap = 0.07
  data.categoryStats.forEach((stat, i) => {
    const cc = CATEGORY_COLORS[stat.category]
    const y = catY0 + i * (catH + catGap)

    // 배경 카드
    s1.addShape('roundRect', {
      x: 0.5, y, w: 12.3, h: catH,
      fill: { color: cc.light }, line: { color: cc.bar, width: 1 },
      rectRadius: 0.08,
    })

    // 좌: 카테고리 정보 (3.3 inch)
    s1.addText(`${cc.emoji}  ${stat.category}`, {
      x: 0.7, y: y + 0.08, w: 2.8, h: 0.3,
      fontSize: 13, bold: true, color: cc.text,
    })
    s1.addText(`${formatNumber(stat.itemCount)}개 · 전체의 ${(stat.ourCost / data.monthlyOurCost * 100).toFixed(1)}%`, {
      x: 0.7, y: y + 0.38, w: 2.8, h: 0.2,
      fontSize: 9, color: COLORS.gray500,
    })

    // 중: 진행 바 + 주요 절감 품목 (5 inch)
    const barX = 3.7
    const barY = y + 0.13
    const barW = 5.0
    s1.addShape('roundRect', {
      x: barX, y: barY, w: barW, h: 0.12,
      fill: { color: 'FFFFFF' }, line: { type: 'none' }, rectRadius: 0.06,
    })
    const fillPct = Math.min(100, (stat.ourCost / data.monthlyOurCost) * 100)
    s1.addShape('roundRect', {
      x: barX, y: barY, w: barW * (fillPct / 100), h: 0.12,
      fill: { color: cc.bar }, line: { type: 'none' }, rectRadius: 0.06,
    })
    if (stat.category !== '가공·기타' && stat.topItems.length > 0) {
      const topText = `주요: ${stat.topItems.slice(0, 3).map((it) => `${shortName(it.name)} -₩${shortKRW(it.savings)}`).join('  ·  ')}`
      s1.addText(topText, {
        x: barX, y: y + 0.32, w: barW, h: 0.28,
        fontSize: 8, color: COLORS.gray700,
      })
    }

    // 우: 금액 (3.4 inch)
    const priceX = 9.0
    s1.addText(formatCurrency(stat.ourCost), {
      x: priceX, y: y + 0.06, w: 3.6, h: 0.22,
      fontSize: 9, color: COLORS.gray500, align: 'right', strike: true,
    })
    s1.addText(formatCurrency(stat.ssgCost), {
      x: priceX, y: y + 0.24, w: 3.6, h: 0.3,
      fontSize: 14, bold: true, color: cc.text, align: 'right',
    })
    s1.addText(`▼ ${formatCurrency(stat.savings)} (${stat.savingsPercent.toFixed(1)}%)`, {
      x: priceX, y: y + 0.5, w: 3.6, h: 0.18,
      fontSize: 9, bold: true, color: COLORS.green, align: 'right',
    })
  })

  // 페이지 번호
  s1.addText('1 / 2', {
    x: 12, y: 7.15, w: 1.0, h: 0.2,
    fontSize: 8, color: COLORS.gray500, align: 'right',
  })

  // ════════════════════════════════════════════════════════════════
  // Slide 2: 연간 환산 + 유치원 제안 부가서비스 (PDF 2페이지)
  // ════════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  s2.background = { color: 'FFFFFF' }

  // ── 연간 환산 카드 (y 0.5 ~ 2.7, 높이 2.2) ──
  s2.addShape('roundRect', {
    x: 0.5, y: 0.5, w: 12.3, h: 2.2,
    fill: { color: COLORS.blueDark }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('연간 환산 (월 합계 × 12)', {
    x: 0.9, y: 0.7, w: 11.5, h: 0.3,
    fontSize: 11, bold: true, color: 'BFDBFE', charSpacing: 2,
  })

  // 현재 vs 신세계 (좌우 박스)
  s2.addShape('roundRect', {
    x: 0.9, y: 1.05, w: 5.6, h: 0.85,
    fill: { color: '1E3A8A' }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('현재', {
    x: 1.1, y: 1.15, w: 5.2, h: 0.25,
    fontSize: 9, color: '93C5FD', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualOurCost), {
    x: 1.1, y: 1.35, w: 5.2, h: 0.55,
    fontSize: 22, bold: true, color: 'BFDBFE',
  })

  s2.addShape('roundRect', {
    x: 6.7, y: 1.05, w: 5.6, h: 0.85,
    fill: { color: 'FFFFFF', transparency: 80 }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('신세계푸드 전환 시', {
    x: 6.9, y: 1.15, w: 5.2, h: 0.25,
    fontSize: 9, color: 'BFDBFE', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSsgCost), {
    x: 6.9, y: 1.35, w: 5.2, h: 0.55,
    fontSize: 22, bold: true, color: 'FFFFFF',
  })

  // 연간 절감 강조
  s2.addText('연간 절감', {
    x: 0.9, y: 2.05, w: 5, h: 0.25,
    fontSize: 9, color: 'FCD34D', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 0.9, y: 2.25, w: 8, h: 0.5,
    fontSize: 32, bold: true, color: 'FBBF24',
  })
  s2.addShape('roundRect', {
    x: 10.5, y: 2.3, w: 1.8, h: 0.4,
    fill: { color: 'FBBF24' }, line: { type: 'none' }, rectRadius: 0.2,
  })
  s2.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: 10.5, y: 2.3, w: 1.8, h: 0.4,
    fontSize: 13, bold: true, color: '1E3A8A', align: 'center', valign: 'middle',
  })

  // 연결 메시지
  s2.addText('↓  이 절감액이 유치원 부가서비스로 제공됩니다', {
    x: 0.5, y: 2.95, w: 12.3, h: 0.4,
    fontSize: 13, bold: true, color: COLORS.amberText, align: 'center',
  })

  // ── 유치원 제안 부가서비스 카드 (y 3.5 ~ 6.9, 높이 3.4) ──
  s2.addShape('roundRect', {
    x: 0.5, y: 3.5, w: 12.3, h: 3.4,
    fill: { color: COLORS.amberMain }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('유치원 제안 부가서비스 (연간)', {
    x: 0.9, y: 3.7, w: 7, h: 0.3,
    fontSize: 11, bold: true, color: 'FFFBEB', charSpacing: 2,
  })
  s2.addText(formatCurrency(data.totalExtrasAnnual), {
    x: 0.9, y: 4.0, w: 8, h: 0.7,
    fontSize: 36, bold: true, color: 'FFFFFF',
  })
  s2.addText('참고 · 연간 절감액', {
    x: 9, y: 3.75, w: 3.3, h: 0.25,
    fontSize: 9, color: 'FFFBEB', align: 'right', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 9, y: 4.0, w: 3.3, h: 0.4,
    fontSize: 16, bold: true, color: 'FFFBEB', align: 'right',
  })

  // 부가서비스 항목 (체크된 것만)
  const checked = data.extras.filter((e) => e.checked && e.annualAmount > 0)
  const itemY0 = 4.85
  const itemH = 0.6
  const itemGap = 0.1
  const itemW = 5.95
  checked.forEach((e, i) => {
    const col = i % 2
    const r = Math.floor(i / 2)
    const ix = 0.7 + col * (itemW + 0.2)
    const iy = itemY0 + r * (itemH + itemGap)

    s2.addShape('roundRect', {
      x: ix, y: iy, w: itemW, h: itemH,
      fill: { color: 'FFFFFF', transparency: 80 }, line: { type: 'none' },
      rectRadius: 0.08,
    })
    s2.addText(e.label, {
      x: ix + 0.2, y: iy + 0.05, w: itemW - 2.5, h: 0.3,
      fontSize: 12, bold: true, color: 'FFFFFF',
    })
    const detail = `${e.count ?? 0}회 × ${formatNumber(e.perRound)}원${e.note ? ` · ${e.note}` : ''}`
    s2.addText(detail, {
      x: ix + 0.2, y: iy + 0.32, w: itemW - 2.5, h: 0.25,
      fontSize: 9, color: 'FFFBEB',
    })
    s2.addText(formatCurrency(e.annualAmount), {
      x: ix + itemW - 2.3, y: iy + 0.13, w: 2.1, h: 0.4,
      fontSize: 14, bold: true, color: 'FFFFFF', align: 'right',
    })
  })

  // 푸터
  s2.addText(`본 제안서는 ${data.period} 거래명세표 기준으로 작성되었습니다.`, {
    x: 0.5, y: 7.0, w: 11.0, h: 0.25,
    fontSize: 9, color: COLORS.gray500, align: 'center',
  })
  s2.addText('2 / 2', {
    x: 12, y: 7.15, w: 1.0, h: 0.2,
    fontSize: 8, color: COLORS.gray500, align: 'right',
  })

  // 다운로드
  const fileName = `${data.proposedTo || '유치원'} 급식 제안서_${data.period.replace(/\s/g, '')}.pptx`
  await pptx.writeFile({ fileName })
}
