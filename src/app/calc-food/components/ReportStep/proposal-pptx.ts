/**
 * 제안서 PPT 다운로드 (PptxGenJS) — 2슬라이드 구조
 *
 * 2026-05-17 PDF 디자인 무조건 반영 — ProposalReport 화면과 완전 동일 layout:
 *   Slide 1:
 *     1. 헤더 navy band ("선경 유치원 - 급식 제안서")
 *     2. HERO 청색 카드 (연간 절감 효과 + ₩금액 + ▼%)
 *     3. 3카드 grid (현 거래처 / 신세계푸드 / 절감 효과 — 월)
 *     4. 비용 효율 비교 카드 (가로 막대 + 범례)
 *     5. 카테고리 1x4 가로 그리드
 *   Slide 2:
 *     1. 헤더 navy band ("선경 유치원 — 절감분의 유치원 부가서비스 제공 제안")
 *     2. 연간 환산 navy 카드 (현재 vs 전환 시 + 연간 절감 amber)
 *     3. 연결 메시지 "↓ 이 절감액이 유치원 부가서비스로 제공됩니다"
 *     4. 유치원 제안 부가서비스 amber 카드 (2열 그리드)
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

// PDF/화면과 동일한 컬러 팔레트
const C = {
  navy: '1A2B5C',
  navyDeep: '14224A',
  blueHero: '2563EB',         // HERO 청색 카드
  blueDark: '1E3A8A',
  blueText: '1E3A8A',
  blueLight: 'DBEAFE',        // 3카드 신세계 배경
  blueSoft: 'E7EBFA',         // 카테고리 아이콘 배경
  greenLight: 'D1FAE5',       // 3카드 절감 배경
  greenText: '047857',
  amber: 'F59E0B',
  amberLight: 'FBBF24',
  amberSoft: 'FEF3C7',
  white: 'FFFFFF',
  gray900: '111827',
  gray700: '374151',
  gray500: '6B7280',
  gray400: '9CA3AF',
  gray300: 'D1D5DB',
  gray200: 'E5E7EB',
  gray100: 'F3F4F6',
  gray50: 'F9FAFB',
}

const CATEGORY_META: Record<FoodCategory, { en: string; emoji: string }> = {
  '농산': { en: 'Agricultural', emoji: '🌱' },
  '축산': { en: 'Livestock', emoji: '🥩' },
  '수산': { en: 'Marine', emoji: '🌊' },
  '가공·기타': { en: 'Processed/Etc', emoji: '📦' },
}

function shortName(name: string, max = 8): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

function shortKRW(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return formatNumber(n)
}

export async function downloadProposalPptx(data: ProposalPptxData) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 inch
  pptx.title = `${data.proposedTo} 급식 제안서`
  pptx.author = '신세계푸드'
  pptx.company = '신세계푸드'

  // ════════════════════════════════════════════════════════════════
  // Slide 1: 헤더 + HERO + 3카드 + 비용효율비교 + 카테고리 1x4
  // ════════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  s1.background = { color: C.white }

  // ── (1) 헤더 navy band (얇게) ──
  s1.addShape('rect', {
    x: 0, y: 0, w: 13.333, h: 0.85,
    fill: { color: C.navy }, line: { type: 'none' },
  })
  s1.addText(`${data.proposedTo || '유치원'} - 급식 제안서`, {
    x: 0.7, y: 0.25, w: 12, h: 0.4,
    fontSize: 22, bold: true, color: C.white, fontFace: 'Pretendard',
  })

  // ── (2) HERO 청색 카드 (연간 절감 효과) ──
  const heroY = 1.10
  const heroH = 1.20
  s1.addShape('roundRect', {
    x: 0.40, y: heroY, w: 6.80, h: heroH,
    fill: { color: C.blueHero }, line: { type: 'none' }, rectRadius: 0.12,
  })
  s1.addText('연간 절감 효과', {
    x: 0.74, y: heroY + 0.08, w: 6.00, h: 0.25,
    fontSize: 10, bold: true, color: 'BFDBFE', charSpacing: 2,
  })
  s1.addText(formatCurrency(data.annualSavings), {
    x: 0.74, y: heroY + 0.27, w: 7.00, h: 0.60,
    fontSize: 30, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: 4.45, y: heroY + 0.46, w: 2.50, h: 0.40,
    fontSize: 18, bold: true, color: 'FBBF24',
  })
  s1.addText(`월 평균 ${formatCurrency(data.monthlySavings)} 절감`, {
    x: 0.79, y: heroY + 0.87, w: 6.00, h: 0.25,
    fontSize: 11, color: 'BFDBFE',
  })

  // ── (3) 3카드 grid: 현 거래처 / 신세계푸드 / 절감 효과 (월) ──
  const card3Y = 2.45
  const card3H = 1.10
  const card3W = 2.90
  const card3Gap = 0.17
  // 현 거래처 (흰색)
  s1.addShape('roundRect', {
    x: 0.40, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.white }, line: { color: C.gray300, width: 1.5 },
    rectRadius: 0.10,
  })
  s1.addText('현 거래처 (월)', {
    x: 0.60, y: card3Y + 0.12, w: 2.61, h: 0.25,
    fontSize: 10, bold: true, color: C.gray500,
  })
  s1.addText(formatCurrency(data.monthlyOurCost), {
    x: 0.60, y: card3Y + 0.38, w: 2.61, h: 0.45,
    fontSize: 20, bold: true, color: C.gray700,
  })
  s1.addText(`연간 ${formatCurrency(data.annualOurCost)}`, {
    x: 0.60, y: card3Y + 0.85, w: 2.61, h: 0.20,
    fontSize: 9, color: C.gray500,
  })
  // 신세계푸드 (연한 청색)
  const card3X2 = 0.40 + card3W + card3Gap
  s1.addShape('roundRect', {
    x: card3X2, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.blueLight }, line: { color: '93C5FD', width: 1.5 },
    rectRadius: 0.10,
  })
  s1.addText('신세계푸드 (월)', {
    x: card3X2 + 0.20, y: card3Y + 0.12, w: 2.61, h: 0.25,
    fontSize: 10, bold: true, color: '1D4ED8',
  })
  s1.addText(formatCurrency(data.monthlySsgCost), {
    x: card3X2 + 0.20, y: card3Y + 0.38, w: 2.61, h: 0.45,
    fontSize: 20, bold: true, color: C.blueText,
  })
  s1.addText(`연간 ${formatCurrency(data.annualSsgCost)}`, {
    x: card3X2 + 0.20, y: card3Y + 0.85, w: 2.61, h: 0.20,
    fontSize: 9, color: '1D4ED8',
  })
  // 절감 효과 (연한 녹색)
  const card3X3 = card3X2 + card3W + card3Gap
  s1.addShape('roundRect', {
    x: card3X3, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.greenLight }, line: { color: '6EE7B7', width: 1.5 },
    rectRadius: 0.10,
  })
  s1.addText('절감 효과', {
    x: card3X3 + 0.20, y: card3Y + 0.12, w: 2.61, h: 0.25,
    fontSize: 10, bold: true, color: C.greenText,
  })
  s1.addText(`- ${formatCurrency(data.monthlySavings)}`, {
    x: card3X3 + 0.20, y: card3Y + 0.38, w: 2.61, h: 0.45,
    fontSize: 20, bold: true, color: C.greenText,
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}% (월)`, {
    x: card3X3 + 0.20, y: card3Y + 0.85, w: 2.61, h: 0.20,
    fontSize: 9, color: C.greenText,
  })

  // ── (4) 비용 효율 비교 카드 (가로 막대) ──
  const compY = 3.72
  const compH = 1.45
  const ssgPct = 100 - data.savingsPercent
  s1.addShape('roundRect', {
    x: 0.40, y: compY, w: 12.53, h: compH,
    fill: { color: C.white }, line: { color: C.gray200, width: 0.75 },
    rectRadius: 0.12,
  })
  s1.addText('비용 효율 비교', {
    x: 0.70, y: compY + 0.20, w: 5.00, h: 0.30,
    fontSize: 13, bold: true, color: C.gray900,
  })
  // 범례 (우상)
  const legendY = compY + 0.25
  s1.addShape('ellipse', {
    x: 8.20, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: C.gray400 }, line: { type: 'none' },
  })
  s1.addText('현재 공급사 (100%)', {
    x: 8.40, y: legendY, w: 2.30, h: 0.25,
    fontSize: 9, color: C.gray700,
  })
  s1.addShape('ellipse', {
    x: 10.65, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: '2D43A8' }, line: { type: 'none' },
  })
  s1.addText(`신세계푸드 (${ssgPct.toFixed(1)}%)`, {
    x: 10.85, y: legendY, w: 2.00, h: 0.25,
    fontSize: 9, bold: true, color: '2D43A8',
  })
  // 가로 막대 (배경 + 신세계 채움)
  const barY = compY + 0.65
  const barH = 0.36
  const barX = 0.70
  const barW = 11.93
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW, h: barH,
    fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.18,
  })
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW * (ssgPct / 100), h: barH,
    fill: { color: '2D43A8' }, line: { type: 'none' }, rectRadius: 0.18,
  })
  s1.addText(`${ssgPct.toFixed(1)}%`, {
    x: barX + barW * (ssgPct / 100) - 1.00, y: barY, w: 0.90, h: barH,
    fontSize: 12, bold: true, color: C.white, align: 'right', valign: 'middle',
  })
  s1.addText('100%', {
    x: barX + barW - 0.90, y: barY, w: 0.80, h: barH,
    fontSize: 10, color: C.gray500, align: 'right', valign: 'middle',
  })
  // 하단 — 메시지 + 절감 강조
  s1.addText('공급망 최적화를 통한 직접 비용 절감', {
    x: 0.70, y: compY + 1.10, w: 7.00, h: 0.25,
    fontSize: 10, color: C.gray500,
  })
  s1.addText(`월 평균 ${formatCurrency(data.monthlySavings)} 절감  ·  총 절감액: ${data.savingsPercent.toFixed(1)}%`, {
    x: 8.00, y: compY + 1.10, w: 4.63, h: 0.25,
    fontSize: 11, bold: true, color: '2D43A8', align: 'right',
  })

  // ── (5) 카테고리 4 카드 (1x4 가로 그리드) ──
  const catY = 5.35
  const catH = 1.55
  const totalCatW = 12.53
  const catGap = 0.18
  const cardW = (totalCatW - catGap * 3) / 4
  data.categoryStats.forEach((stat, i) => {
    const meta = CATEGORY_META[stat.category]
    const x = 0.40 + i * (cardW + catGap)
    const isSaving = stat.savings > 0

    // 카드 배경
    s1.addShape('roundRect', {
      x, y: catY, w: cardW, h: catH,
      fill: { color: C.white }, line: { color: C.gray200, width: 0.75 },
      rectRadius: 0.10,
    })
    // 좌상 아이콘
    s1.addShape('roundRect', {
      x: x + 0.20, y: catY + 0.22, w: 0.50, h: 0.50,
      fill: { color: C.blueSoft }, line: { type: 'none' }, rectRadius: 0.08,
    })
    s1.addText(meta.emoji, {
      x: x + 0.20, y: catY + 0.22, w: 0.50, h: 0.50,
      fontSize: 18, align: 'center', valign: 'middle',
    })
    // 우상 절감률 배지 (회색)
    s1.addShape('roundRect', {
      x: x + cardW - 1.05, y: catY + 0.27, w: 0.85, h: 0.32,
      fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.16,
    })
    s1.addText(`${isSaving ? '▼' : '▲'} ${stat.savingsPercent.toFixed(1)}%`, {
      x: x + cardW - 1.05, y: catY + 0.27, w: 0.85, h: 0.32,
      fontSize: 9, bold: true, color: C.gray700, align: 'center', valign: 'middle',
    })
    // 카테고리명 + (English)
    s1.addText(`${stat.category} `, {
      x: x + 0.20, y: catY + 0.80, w: cardW - 0.40, h: 0.30,
      fontSize: 13, bold: true, color: C.gray900,
    })
    s1.addText(`(${meta.en})`, {
      x: x + 1.05, y: catY + 0.85, w: cardW - 1.20, h: 0.25,
      fontSize: 9, color: C.gray500,
    })
    // 주요 품목
    const topNames = stat.topItems
      .slice(0, 3)
      .map((it) => `${shortName(it.name)} -₩${shortKRW(it.savings)}`)
      .join(', ')
    if (topNames) {
      s1.addText(topNames, {
        x: x + 0.20, y: catY + 1.08, w: cardW - 0.40, h: 0.20,
        fontSize: 8, color: '4B5563',
      })
    }
    // 비용 + 절감액
    s1.addText(`비용 ${formatCurrency(stat.ourCost)}`, {
      x: x + 0.20, y: catY + 1.28, w: cardW - 0.40, h: 0.22,
      fontSize: 9, color: C.gray500,
    })
    s1.addText(`${isSaving ? '−' : '+'} ${formatCurrency(Math.abs(stat.savings))}`, {
      x: x + 0.20, y: catY + 1.30, w: cardW - 0.40, h: 0.22,
      fontSize: 14, bold: true, color: '2D43A8', align: 'right',
    })
  })

  // 푸터
  s1.addText(`본 제안서는 ${data.period} 거래명세표 기준으로 작성되었습니다.`, {
    x: 0.50, y: 7.05, w: 11.00, h: 0.22,
    fontSize: 9, color: C.gray400, align: 'center',
  })
  s1.addText('1 / 2', {
    x: 12.20, y: 7.20, w: 1.00, h: 0.20,
    fontSize: 8, color: C.gray400, align: 'right',
  })

  // ════════════════════════════════════════════════════════════════
  // Slide 2: 연간 환산 + 부가서비스
  // ════════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  s2.background = { color: C.white }

  // (1) 헤더 navy
  s2.addShape('rect', {
    x: 0, y: 0, w: 13.333, h: 0.88,
    fill: { color: C.navy }, line: { type: 'none' },
  })
  s2.addText(`${data.proposedTo || '유치원'} — 절감분의 유치원 부가서비스 제공 제안`, {
    x: 0.80, y: 0.25, w: 12.00, h: 0.40,
    fontSize: 18, bold: true, color: C.white, fontFace: 'Pretendard',
  })

  // (2) 연간 환산 navy 카드
  const a1Y = 1.20
  const a1H = 2.05
  s2.addShape('roundRect', {
    x: 0.70, y: a1Y, w: 9.87, h: a1H,
    fill: { color: C.navy }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('연간 환산 (월 합계 × 12)', {
    x: 1.10, y: a1Y + 0.21, w: 9.07, h: 0.30,
    fontSize: 11, bold: true, color: '93C5FD', charSpacing: 2,
  })
  // 현재 박스
  s2.addShape('roundRect', {
    x: 1.10, y: a1Y + 0.56, w: 3.89, h: 0.85,
    fill: { color: C.navyDeep }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('현재', {
    x: 1.30, y: a1Y + 0.66, w: 3.50, h: 0.22,
    fontSize: 9, color: '93C5FD', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualOurCost), {
    x: 1.30, y: a1Y + 0.88, w: 3.50, h: 0.55,
    fontSize: 22, bold: true, color: 'BFDBFE',
  })
  // 신세계 박스 (반투명)
  s2.addShape('roundRect', {
    x: 5.39, y: a1Y + 0.54, w: 4.78, h: 0.85,
    fill: { color: C.white, transparency: 80 }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('신세계푸드 전환 시', {
    x: 5.47, y: a1Y + 0.66, w: 4.50, h: 0.22,
    fontSize: 9, color: 'BFDBFE', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSsgCost), {
    x: 5.47, y: a1Y + 0.88, w: 4.50, h: 0.55,
    fontSize: 22, bold: true, color: C.white,
  })
  // 연간 절감 강조 (좌하)
  s2.addText('연간 절감', {
    x: 1.10, y: a1Y + 1.53, w: 1.99, h: 0.20,
    fontSize: 10, color: 'FCD34D', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 1.10, y: a1Y + 1.49, w: 8.00, h: 0.50,
    fontSize: 30, bold: true, color: 'FBBF24',
  })
  // amber 배지 ▼ %
  s2.addShape('roundRect', {
    x: 7.97, y: a1Y + 0.76, w: 1.80, h: 0.40,
    fill: { color: C.amberLight }, line: { type: 'none' }, rectRadius: 0.20,
  })
  s2.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: 7.97, y: a1Y + 0.76, w: 1.80, h: 0.40,
    fontSize: 13, bold: true, color: C.navy, align: 'center', valign: 'middle',
  })

  // (3) 연결 메시지
  s2.addText('↓  이 절감액이 유치원 부가서비스로 제공됩니다', {
    x: 0.40, y: 3.41, w: 12.53, h: 0.35,
    fontSize: 12, bold: true, color: '92400E', align: 'center',
  })

  // (4) 부가서비스 amber 카드
  const a2Y = 3.86
  const a2H = 3.19
  s2.addShape('roundRect', {
    x: 0.70, y: a2Y, w: 11.94, h: a2H,
    fill: { color: C.amber }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('유치원 제안 부가서비스 (연간)', {
    x: 0.90, y: a2Y + 0.16, w: 7.00, h: 0.30,
    fontSize: 11, bold: true, color: 'FFFBEB', charSpacing: 2,
  })
  s2.addText(formatCurrency(data.totalExtrasAnnual), {
    x: 0.90, y: a2Y + 0.46, w: 8.00, h: 0.65,
    fontSize: 32, bold: true, color: C.white,
  })
  s2.addText('참고 · 연간 절감액', {
    x: 8.72, y: a2Y + 0.20, w: 3.30, h: 0.22,
    fontSize: 9, color: 'FFFBEB', align: 'right', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 8.72, y: a2Y + 0.45, w: 3.30, h: 0.40,
    fontSize: 16, bold: true, color: 'FFFBEB', align: 'right',
  })

  // 부가서비스 항목 (체크된 것만) — 2열 그리드
  const checked = data.extras.filter((e) => e.checked && e.annualAmount > 0)
  const itY0 = a2Y + 1.17
  const itH = 0.55
  const itGap = 0.08
  const itW = 5.95
  checked.forEach((e, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const ix = 0.93 + col * (itW + 0.20)
    const iy = itY0 + row * (itH + itGap)
    if (iy + itH > a2Y + a2H - 0.10) return // overflow 가드

    s2.addShape('roundRect', {
      x: ix, y: iy, w: itW, h: itH,
      fill: { color: C.white, transparency: 80 }, line: { type: 'none' },
      rectRadius: 0.08,
    })
    s2.addText(e.label, {
      x: ix + 0.20, y: iy + 0.05, w: itW - 2.50, h: 0.25,
      fontSize: 11, bold: true, color: C.white,
    })
    const detail = `${e.count ?? 0}회 × ${formatNumber(e.perRound)}원${e.note ? ` · ${e.note}` : ''}`
    s2.addText(detail, {
      x: ix + 0.20, y: iy + 0.28, w: itW - 2.50, h: 0.22,
      fontSize: 9, color: 'FFFBEB',
    })
    s2.addText(formatCurrency(e.annualAmount), {
      x: ix + itW - 2.30, y: iy + 0.13, w: 2.10, h: 0.35,
      fontSize: 13, bold: true, color: C.white, align: 'right',
    })
  })

  // 푸터
  s2.addText(`본 제안서는 ${data.period} 거래명세표 기준으로 작성되었습니다.`, {
    x: 0.50, y: 7.05, w: 11.00, h: 0.22,
    fontSize: 9, color: C.gray400, align: 'center',
  })
  s2.addText('2 / 2', {
    x: 12.20, y: 7.20, w: 1.00, h: 0.20,
    fontSize: 8, color: C.gray400, align: 'right',
  })

  // 다운로드
  const fileName = `${data.proposedTo || '유치원'} 급식 제안서_${data.period.replace(/\s/g, '')}.pptx`
  await pptx.writeFile({ fileName })
}
