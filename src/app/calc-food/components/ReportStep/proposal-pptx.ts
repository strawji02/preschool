/**
 * 제안서 PPT 다운로드 (PptxGenJS) — 2슬라이드 구조
 *
 * 2026-05-16 디자인 개편 — 사용자 제공 디자인 컨셉 반영:
 * - 진한 남색 헤더 + 우측 큰 절감액 hero
 * - 비용 효율 비교 막대 그래프
 * - 카테고리 4 카드 (좌 아이콘 + 우 절감 배지 + 비용/절감액)
 *
 * Slide 1: 헤더 + 비용 효율 비교 + 카테고리별 절감
 * Slide 2: 연간 환산 + 유치원 제안 부가서비스
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

// 2026-05-16 새 디자인 컬러 팔레트 (사용자 디자인 컨셉)
const C = {
  // 메인 남색 (헤더/강조)
  navy: '1A2B5C',
  navyDeep: '14224A',
  navyLight: '2D43A8',
  // 보조 컬러
  blueAccent: '3B5BDB',
  blueText: '1E3A8A',
  blueSoft: 'E7EBFA',
  // 회색 톤
  white: 'FFFFFF',
  gray900: '111827',
  gray700: '374151',
  gray500: '6B7280',
  gray400: '9CA3AF',
  gray300: 'D1D5DB',
  gray200: 'E5E7EB',
  gray100: 'F3F4F6',
  gray50: 'F9FAFB',
  // 강조
  amber: 'F59E0B',
  amberLight: 'FEF3C7',
  amberText: '92400E',
  green: '047857',
  greenLight: 'D1FAE5',
  greenSoft: 'ECFDF5',
}

// 카테고리별 아이콘/컬러 (디자인 컨셉 적용)
const CATEGORY_META: Record<FoodCategory, { en: string; emoji: string; accent: string }> = {
  '농산': { en: 'Agricultural', emoji: '🌱', accent: '15803D' },
  '축산': { en: 'Livestock', emoji: '🥩', accent: 'B91C1C' },
  '수산': { en: 'Marine', emoji: '🌊', accent: '0369A1' },
  '가공·기타': { en: 'Processed/Etc', emoji: '📦', accent: 'B45309' },
}

function shortName(name: string, max = 8): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

export async function downloadProposalPptx(data: ProposalPptxData) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 inch
  pptx.title = `${data.proposedTo} 급식 제안서`
  pptx.author = '신세계푸드'
  pptx.company = '신세계푸드'

  // ════════════════════════════════════════════════════════════════
  // Slide 1: 헤더(navy) + 비용 효율 비교 + 카테고리 4 카드
  // ════════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  s1.background = { color: C.gray50 }

  // ── 헤더 (전체 너비, 진한 남색) ──
  const hdrH = 1.85
  s1.addShape('rect', {
    x: 0, y: 0, w: 13.333, h: hdrH,
    fill: { color: C.navy }, line: { type: 'none' },
  })

  // 좌측 — 라벨 + 타이틀 + 기준 기간
  s1.addText('📊  전략적 제안', {
    x: 0.7, y: 0.4, w: 5, h: 0.3,
    fontSize: 10, bold: true, color: '93C5FD', charSpacing: 2,
  })
  s1.addText(`${data.proposedTo || '유치원명'} 절감 효과 분석`, {
    x: 0.7, y: 0.7, w: 8.5, h: 0.7,
    fontSize: 28, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s1.addText(`기준 기간: ${data.period} 시뮬레이션 결과`, {
    x: 0.7, y: 1.4, w: 8.5, h: 0.3,
    fontSize: 11, color: 'A5B4FC',
  })

  // 우측 — 연간 예상 절감액 hero
  s1.addText('연간 예상 절감액', {
    x: 9, y: 0.4, w: 4, h: 0.3,
    fontSize: 11, color: 'A5B4FC', align: 'right', charSpacing: 1,
  })
  s1.addText(formatCurrency(data.annualSavings), {
    x: 8.5, y: 0.7, w: 4.5, h: 0.75,
    fontSize: 34, bold: true, color: C.white, align: 'right', fontFace: 'Pretendard',
  })
  // 월평균 + 절감율 (작게, 우측)
  s1.addText('월평균', {
    x: 9, y: 1.5, w: 1.6, h: 0.2,
    fontSize: 9, color: 'A5B4FC', align: 'right',
  })
  s1.addText(formatCurrency(data.monthlySavings), {
    x: 9, y: 1.5, w: 2.3, h: 0.25,
    fontSize: 12, bold: true, color: C.white, align: 'right',
  })
  s1.addText('절감율', {
    x: 11.4, y: 1.5, w: 0.8, h: 0.2,
    fontSize: 9, color: 'A5B4FC', align: 'right',
  })
  s1.addText(`${data.savingsPercent.toFixed(1)}%`, {
    x: 11.4, y: 1.5, w: 1.5, h: 0.25,
    fontSize: 12, bold: true, color: 'FBBF24', align: 'right',
  })

  // ── 비용 효율 비교 카드 (흰색) ──
  const compY = 2.1
  const compH = 1.45
  s1.addShape('roundRect', {
    x: 0.4, y: compY, w: 12.53, h: compH,
    fill: { color: C.white }, line: { color: C.gray200, width: 0.75 },
    rectRadius: 0.12,
  })
  s1.addText('비용 효율 비교', {
    x: 0.7, y: compY + 0.2, w: 5, h: 0.3,
    fontSize: 13, bold: true, color: C.gray900,
  })

  // 우측 상단 — 범례
  const legendY = compY + 0.25
  // 현재 공급사 (회색)
  s1.addShape('ellipse', {
    x: 8.2, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: C.gray400 }, line: { type: 'none' },
  })
  s1.addText('현재 공급사 (100%)', {
    x: 8.4, y: legendY, w: 2.3, h: 0.25,
    fontSize: 9, color: C.gray700,
  })
  // 신세계푸드 (남색)
  s1.addShape('ellipse', {
    x: 10.65, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: C.navyLight }, line: { type: 'none' },
  })
  const ssgPct = 100 - data.savingsPercent
  s1.addText(`신세계푸드 (${ssgPct.toFixed(1)}%)`, {
    x: 10.85, y: legendY, w: 2.0, h: 0.25,
    fontSize: 9, color: C.navyLight, bold: true,
  })

  // 메인 막대 그래프 (가로, 100% 폭)
  const barY = compY + 0.65
  const barH = 0.36
  const barX = 0.7
  const barW = 11.93
  // 배경 (현재 공급사 100% = 전체)
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW, h: barH,
    fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.18,
  })
  // 신세계 채움 (절감 후 %)
  const ssgRatio = ssgPct / 100
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW * ssgRatio, h: barH,
    fill: { color: C.navyLight }, line: { type: 'none' }, rectRadius: 0.18,
  })
  // 막대 안 신세계 % 텍스트 (흰색, 가운데)
  s1.addText(`${ssgPct.toFixed(1)}%`, {
    x: barX + barW * ssgRatio - 1.0, y: barY, w: 0.9, h: barH,
    fontSize: 12, bold: true, color: C.white, align: 'right', valign: 'middle',
  })
  // 막대 끝 100% 라벨 (회색)
  s1.addText('100%', {
    x: barX + barW - 0.9, y: barY, w: 0.8, h: barH,
    fontSize: 10, color: C.gray500, align: 'right', valign: 'middle',
  })

  // 하단 — 메시지 + 총 절감액
  s1.addText('공급망 최적화를 통한 직접 비용 절감', {
    x: 0.7, y: compY + 1.1, w: 7, h: 0.25,
    fontSize: 10, color: C.gray500,
  })
  s1.addText(`총 절감액: ${data.savingsPercent.toFixed(1)}%`, {
    x: 8, y: compY + 1.1, w: 4.6, h: 0.25,
    fontSize: 11, bold: true, color: C.blueAccent, align: 'right',
  })

  // ── 카테고리 카드 4개 (가로 그리드) ──
  const catY = compY + compH + 0.2
  const catH = 1.55
  const totalW = 12.53
  const gap = 0.18
  const cardW = (totalW - gap * 3) / 4

  data.categoryStats.forEach((stat, i) => {
    const meta = CATEGORY_META[stat.category]
    const x = 0.4 + i * (cardW + gap)

    // 카드 배경
    s1.addShape('roundRect', {
      x, y: catY, w: cardW, h: catH,
      fill: { color: C.white }, line: { color: C.gray200, width: 0.75 },
      rectRadius: 0.1,
    })

    // 좌상 — 아이콘 (둥근 사각형 배경)
    s1.addShape('roundRect', {
      x: x + 0.2, y: catY + 0.2, w: 0.5, h: 0.5,
      fill: { color: C.blueSoft }, line: { type: 'none' }, rectRadius: 0.08,
    })
    s1.addText(meta.emoji, {
      x: x + 0.2, y: catY + 0.2, w: 0.5, h: 0.5,
      fontSize: 18, color: C.navyLight, align: 'center', valign: 'middle',
    })

    // 우상 — 절감률 배지
    s1.addShape('roundRect', {
      x: x + cardW - 1.05, y: catY + 0.25, w: 0.85, h: 0.32,
      fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.16,
    })
    s1.addText(`${stat.savingsPercent.toFixed(1)}% 절감`, {
      x: x + cardW - 1.05, y: catY + 0.25, w: 0.85, h: 0.32,
      fontSize: 9, bold: true, color: C.gray700, align: 'center', valign: 'middle',
    })

    // 카테고리명 + (English)
    s1.addText(`${stat.category} `, {
      x: x + 0.2, y: catY + 0.78, w: cardW - 0.4, h: 0.3,
      fontSize: 13, bold: true, color: C.gray900,
    })
    s1.addText(`(${meta.en})`, {
      x: x + 1.05, y: catY + 0.83, w: cardW - 1.2, h: 0.25,
      fontSize: 9, color: C.gray500,
    })

    // 주요 품목
    const topNames = stat.topItems.slice(0, 3).map((it) => shortName(it.name)).join(', ')
    if (topNames) {
      s1.addText('주요 품목:', {
        x: x + 0.2, y: catY + 1.05, w: 1.3, h: 0.2,
        fontSize: 8, color: C.gray400,
      })
      s1.addText(topNames, {
        x: x + 1.05, y: catY + 1.05, w: cardW - 1.2, h: 0.2,
        fontSize: 9, color: C.gray700,
      })
    }

    // 비용 (작게)
    s1.addText(`비용: ${formatCurrency(stat.ourCost)}`, {
      x: x + 0.2, y: catY + 1.22, w: cardW - 0.4, h: 0.22,
      fontSize: 9, color: C.gray500,
    })

    // 큰 절감액
    s1.addText(formatCurrency(stat.savings), {
      x: x + 0.2, y: catY + cardW > 3 ? 1.42 : 1.4, w: cardW - 0.4, h: 0.32,
      fontSize: 19, bold: true, color: C.navyLight,
    })
  })

  // 페이지 번호
  s1.addText('1 / 2', {
    x: 12.2, y: 7.2, w: 1.0, h: 0.2,
    fontSize: 8, color: C.gray400, align: 'right',
  })

  // ════════════════════════════════════════════════════════════════
  // Slide 2: 연간 환산 + 유치원 제안 부가서비스
  // ════════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  s2.background = { color: C.gray50 }

  // 헤더 (navy strip)
  s2.addShape('rect', {
    x: 0, y: 0, w: 13.333, h: 0.85,
    fill: { color: C.navy }, line: { type: 'none' },
  })
  s2.addText(`${data.proposedTo || '유치원명'} — 연간 환산 + 유치원 부가서비스`, {
    x: 0.7, y: 0.25, w: 12, h: 0.4,
    fontSize: 16, bold: true, color: C.white, fontFace: 'Pretendard',
  })

  // ── 연간 환산 카드 (남색) ──
  const a1Y = 1.15
  const a1H = 2.05
  s2.addShape('roundRect', {
    x: 0.4, y: a1Y, w: 12.53, h: a1H,
    fill: { color: C.navy }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('연간 환산 (월 합계 × 12)', {
    x: 0.8, y: a1Y + 0.25, w: 11.5, h: 0.3,
    fontSize: 11, bold: true, color: '93C5FD', charSpacing: 2,
  })

  // 현재 vs 신세계 박스
  s2.addShape('roundRect', {
    x: 0.8, y: a1Y + 0.6, w: 5.7, h: 0.85,
    fill: { color: C.navyDeep }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('현재', {
    x: 1.0, y: a1Y + 0.7, w: 5.3, h: 0.22,
    fontSize: 9, color: '93C5FD', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualOurCost), {
    x: 1.0, y: a1Y + 0.92, w: 5.3, h: 0.55,
    fontSize: 22, bold: true, color: 'BFDBFE',
  })

  s2.addShape('roundRect', {
    x: 6.83, y: a1Y + 0.6, w: 5.7, h: 0.85,
    fill: { color: C.white, transparency: 80 }, line: { type: 'none' }, rectRadius: 0.08,
  })
  s2.addText('신세계푸드 전환 시', {
    x: 7.03, y: a1Y + 0.7, w: 5.3, h: 0.22,
    fontSize: 9, color: 'BFDBFE', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSsgCost), {
    x: 7.03, y: a1Y + 0.92, w: 5.3, h: 0.55,
    fontSize: 22, bold: true, color: C.white,
  })

  // 연간 절감 강조
  s2.addText('연간 절감', {
    x: 0.8, y: a1Y + 1.55, w: 5, h: 0.22,
    fontSize: 9, color: 'FCD34D', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 0.8, y: a1Y + 1.75, w: 8, h: 0.5,
    fontSize: 30, bold: true, color: 'FBBF24',
  })
  s2.addShape('roundRect', {
    x: 10.7, y: a1Y + 1.82, w: 1.8, h: 0.4,
    fill: { color: 'FBBF24' }, line: { type: 'none' }, rectRadius: 0.2,
  })
  s2.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: 10.7, y: a1Y + 1.82, w: 1.8, h: 0.4,
    fontSize: 13, bold: true, color: C.navy, align: 'center', valign: 'middle',
  })

  // 연결 메시지
  s2.addText('↓ 이 절감액이 유치원 부가서비스로 제공됩니다', {
    x: 0.4, y: a1Y + a1H + 0.15, w: 12.53, h: 0.35,
    fontSize: 12, bold: true, color: C.amberText, align: 'center',
  })

  // ── 부가서비스 카드 (앰버) ──
  const a2Y = a1Y + a1H + 0.6
  const a2H = 7.2 - a2Y
  s2.addShape('roundRect', {
    x: 0.4, y: a2Y, w: 12.53, h: a2H,
    fill: { color: C.amber }, line: { type: 'none' }, rectRadius: 0.15,
  })
  s2.addText('유치원 제안 부가서비스 (연간)', {
    x: 0.8, y: a2Y + 0.2, w: 7, h: 0.3,
    fontSize: 11, bold: true, color: 'FFFBEB', charSpacing: 2,
  })
  s2.addText(formatCurrency(data.totalExtrasAnnual), {
    x: 0.8, y: a2Y + 0.5, w: 8, h: 0.65,
    fontSize: 32, bold: true, color: C.white,
  })
  s2.addText('참고 · 연간 절감액', {
    x: 9, y: a2Y + 0.25, w: 3.3, h: 0.22,
    fontSize: 9, color: 'FFFBEB', align: 'right', charSpacing: 1,
  })
  s2.addText(formatCurrency(data.annualSavings), {
    x: 9, y: a2Y + 0.5, w: 3.3, h: 0.4,
    fontSize: 16, bold: true, color: 'FFFBEB', align: 'right',
  })

  // 부가서비스 항목 (체크된 것만)
  const checked = data.extras.filter((e) => e.checked && e.annualAmount > 0)
  const itY0 = a2Y + 1.45
  const itH = 0.55
  const itGap = 0.08
  const itW = 5.95
  checked.forEach((e, i) => {
    const col = i % 2
    const r = Math.floor(i / 2)
    const ix = 0.6 + col * (itW + 0.2)
    const iy = itY0 + r * (itH + itGap)
    if (iy + itH > a2Y + a2H - 0.2) return // overflow guard

    s2.addShape('roundRect', {
      x: ix, y: iy, w: itW, h: itH,
      fill: { color: C.white, transparency: 80 }, line: { type: 'none' },
      rectRadius: 0.08,
    })
    s2.addText(e.label, {
      x: ix + 0.2, y: iy + 0.05, w: itW - 2.5, h: 0.25,
      fontSize: 11, bold: true, color: C.white,
    })
    const detail = `${e.count ?? 0}회 × ${formatNumber(e.perRound)}원${e.note ? ` · ${e.note}` : ''}`
    s2.addText(detail, {
      x: ix + 0.2, y: iy + 0.28, w: itW - 2.5, h: 0.22,
      fontSize: 9, color: 'FFFBEB',
    })
    s2.addText(formatCurrency(e.annualAmount), {
      x: ix + itW - 2.3, y: iy + 0.13, w: 2.1, h: 0.35,
      fontSize: 13, bold: true, color: C.white, align: 'right',
    })
  })

  // 푸터
  s2.addText(`본 제안서는 ${data.period} 거래명세표 기준으로 작성되었습니다.`, {
    x: 0.4, y: 7.05, w: 11.0, h: 0.22,
    fontSize: 9, color: C.gray400, align: 'center',
  })
  s2.addText('2 / 2', {
    x: 12.2, y: 7.2, w: 1.0, h: 0.2,
    fontSize: 8, color: C.gray400, align: 'right',
  })

  // 다운로드
  const fileName = `${data.proposedTo || '유치원'} 급식 제안서_${data.period.replace(/\s/g, '')}.pptx`
  await pptx.writeFile({ fileName })
}
