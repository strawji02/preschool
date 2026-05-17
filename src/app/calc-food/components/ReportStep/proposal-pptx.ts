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

  // ── 공통 layout 상수 (2026-05-17 사용자 요청 — 카드 폭/여백/테두리 강화) ──
  //   카드 좌측 0.60, 폭 12.13 → 우측 12.73 (헤더 풀폭 13.333보다 안쪽)
  //   상하 gap 0.20 균일 + 테두리 width 1.5, color gray300
  const CARD_X = 0.60
  const CARD_W = 12.13
  const BORDER_GRAY = 'CBD5E1' // slate-300 — 회색보다 살짝 푸른 톤 (시인성 ↑)
  const BORDER_W = 1.75

  // ── (1) 헤더 navy band (풀폭 유지) ──
  s1.addShape('rect', {
    x: 0, y: 0, w: 13.333, h: 0.85,
    fill: { color: C.navy }, line: { type: 'none' },
  })
  s1.addText(`${data.proposedTo || '유치원'} - 급식 제안서`, {
    x: 0.7, y: 0.25, w: 12, h: 0.4,
    fontSize: 22, bold: true, color: C.white, fontFace: 'Pretendard',
  })

  // ── (2) HERO 청색 카드 (연간 절감 효과) — 풀폭으로 통일 ──
  const heroY = 1.10
  const heroH = 1.20
  s1.addShape('roundRect', {
    x: CARD_X, y: heroY, w: CARD_W, h: heroH,
    fill: { color: C.blueHero }, line: { type: 'none' }, rectRadius: 0.12,
  })
  s1.addText('연간 절감 효과', {
    x: CARD_X + 0.25, y: heroY + 0.15, w: 6.00, h: 0.25,
    fontSize: 11, bold: true, color: 'BFDBFE', charSpacing: 2,
  })
  s1.addText(formatCurrency(data.annualSavings), {
    x: CARD_X + 0.25, y: heroY + 0.40, w: 8.00, h: 0.55,
    fontSize: 30, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s1.addText(`월 평균 ${formatCurrency(data.monthlySavings)} 절감`, {
    x: CARD_X + 0.25, y: heroY + 0.95, w: 6.00, h: 0.22,
    fontSize: 11, color: 'BFDBFE',
  })
  // ▼ % 배지 (우상)
  s1.addShape('roundRect', {
    x: CARD_X + CARD_W - 2.20, y: heroY + 0.40, w: 1.90, h: 0.50,
    fill: { color: 'FBBF24' }, line: { type: 'none' }, rectRadius: 0.25,
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}%`, {
    x: CARD_X + CARD_W - 2.20, y: heroY + 0.40, w: 1.90, h: 0.50,
    fontSize: 18, bold: true, color: C.blueDark, align: 'center', valign: 'middle',
  })

  // ── (3) 3카드 grid: 현 거래처 / 신세계푸드 / 절감 효과 (월) ──
  const card3Y = heroY + heroH + 0.20  // 2.50
  const card3H = 1.05
  const card3Gap = 0.20
  const card3W = (CARD_W - card3Gap * 2) / 3  // 약 3.91
  // 현 거래처 (흰색)
  s1.addShape('roundRect', {
    x: CARD_X, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.white }, line: { color: BORDER_GRAY, width: BORDER_W },
    rectRadius: 0.10,
  })
  s1.addText('현 거래처 (월)', {
    x: CARD_X + 0.22, y: card3Y + 0.13, w: card3W - 0.44, h: 0.22,
    fontSize: 10, bold: true, color: C.gray500,
  })
  s1.addText(formatCurrency(data.monthlyOurCost), {
    x: CARD_X + 0.22, y: card3Y + 0.37, w: card3W - 0.44, h: 0.42,
    fontSize: 20, bold: true, color: C.gray700,
  })
  s1.addText(`연간 ${formatCurrency(data.annualOurCost)}`, {
    x: CARD_X + 0.22, y: card3Y + 0.80, w: card3W - 0.44, h: 0.20,
    fontSize: 9, color: C.gray500,
  })
  // 신세계푸드 (연한 청색)
  const card3X2 = CARD_X + card3W + card3Gap
  s1.addShape('roundRect', {
    x: card3X2, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.blueLight }, line: { color: '60A5FA', width: BORDER_W },
    rectRadius: 0.10,
  })
  s1.addText('신세계푸드 (월)', {
    x: card3X2 + 0.22, y: card3Y + 0.13, w: card3W - 0.44, h: 0.22,
    fontSize: 10, bold: true, color: '1D4ED8',
  })
  s1.addText(formatCurrency(data.monthlySsgCost), {
    x: card3X2 + 0.22, y: card3Y + 0.37, w: card3W - 0.44, h: 0.42,
    fontSize: 20, bold: true, color: C.blueText,
  })
  s1.addText(`연간 ${formatCurrency(data.annualSsgCost)}`, {
    x: card3X2 + 0.22, y: card3Y + 0.80, w: card3W - 0.44, h: 0.20,
    fontSize: 9, color: '1D4ED8',
  })
  // 절감 효과 (연한 녹색)
  const card3X3 = card3X2 + card3W + card3Gap
  s1.addShape('roundRect', {
    x: card3X3, y: card3Y, w: card3W, h: card3H,
    fill: { color: C.greenLight }, line: { color: '34D399', width: BORDER_W },
    rectRadius: 0.10,
  })
  s1.addText('절감 효과', {
    x: card3X3 + 0.22, y: card3Y + 0.13, w: card3W - 0.44, h: 0.22,
    fontSize: 10, bold: true, color: C.greenText,
  })
  s1.addText(`- ${formatCurrency(data.monthlySavings)}`, {
    x: card3X3 + 0.22, y: card3Y + 0.37, w: card3W - 0.44, h: 0.42,
    fontSize: 20, bold: true, color: C.greenText,
  })
  s1.addText(`▼ ${data.savingsPercent.toFixed(1)}% (월)`, {
    x: card3X3 + 0.22, y: card3Y + 0.80, w: card3W - 0.44, h: 0.20,
    fontSize: 9, color: C.greenText,
  })

  // ── (4) 비용 효율 비교 카드 — 테두리 강화 ──
  const compY = card3Y + card3H + 0.20  // 3.75
  const compH = 1.30
  const ssgPct = 100 - data.savingsPercent
  s1.addShape('roundRect', {
    x: CARD_X, y: compY, w: CARD_W, h: compH,
    fill: { color: C.white }, line: { color: BORDER_GRAY, width: BORDER_W },
    rectRadius: 0.12,
  })
  s1.addText('비용 효율 비교', {
    x: CARD_X + 0.25, y: compY + 0.18, w: 5.00, h: 0.28,
    fontSize: 13, bold: true, color: C.gray900,
  })
  // 범례 (우상)
  const legendY = compY + 0.22
  const legendRightEnd = CARD_X + CARD_W - 0.25
  s1.addShape('ellipse', {
    x: legendRightEnd - 4.10, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: C.gray400 }, line: { type: 'none' },
  })
  s1.addText('현재 공급사 (100%)', {
    x: legendRightEnd - 3.90, y: legendY, w: 2.00, h: 0.25,
    fontSize: 9, color: C.gray700,
  })
  s1.addShape('ellipse', {
    x: legendRightEnd - 1.80, y: legendY + 0.08, w: 0.14, h: 0.14,
    fill: { color: '2D43A8' }, line: { type: 'none' },
  })
  s1.addText(`신세계푸드 (${ssgPct.toFixed(1)}%)`, {
    x: legendRightEnd - 1.60, y: legendY, w: 1.60, h: 0.25,
    fontSize: 9, bold: true, color: '2D43A8',
  })
  // 가로 막대 (배경 + 신세계 채움)
  const barX = CARD_X + 0.25
  const barW = CARD_W - 0.50
  const barY = compY + 0.58
  const barH = 0.34
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW, h: barH,
    fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.17,
  })
  s1.addShape('roundRect', {
    x: barX, y: barY, w: barW * (ssgPct / 100), h: barH,
    fill: { color: '2D43A8' }, line: { type: 'none' }, rectRadius: 0.17,
  })
  s1.addText(`${ssgPct.toFixed(1)}%`, {
    x: barX + barW * (ssgPct / 100) - 1.00, y: barY, w: 0.90, h: barH,
    fontSize: 12, bold: true, color: C.white, align: 'right', valign: 'middle',
  })
  s1.addText('100%', {
    x: barX + barW - 0.85, y: barY, w: 0.75, h: barH,
    fontSize: 10, color: C.gray500, align: 'right', valign: 'middle',
  })
  // 하단 — 메시지 + 절감 강조
  s1.addText('공급망 최적화를 통한 직접 비용 절감', {
    x: CARD_X + 0.25, y: compY + 0.98, w: 7.00, h: 0.25,
    fontSize: 10, color: C.gray500,
  })
  s1.addText(`월 평균 ${formatCurrency(data.monthlySavings)} 절감  ·  총 절감액: ${data.savingsPercent.toFixed(1)}%`, {
    x: CARD_X + CARD_W - 4.85, y: compY + 0.98, w: 4.60, h: 0.25,
    fontSize: 11, bold: true, color: '2D43A8', align: 'right',
  })

  // ── (5) 카테고리 4 카드 (1x4 가로) — 테두리 강화 ──
  // catH 1.85: 주요 품목 3행 + 좌측 정렬 layout 수용
  const catY = compY + compH + 0.20  // 5.25
  const catH = 1.85
  const catGap = 0.18
  const cardW = (CARD_W - catGap * 3) / 4
  data.categoryStats.forEach((stat, i) => {
    const meta = CATEGORY_META[stat.category]
    const x = CARD_X + i * (cardW + catGap)
    const isSaving = stat.savings > 0
    const topItems = stat.topItems.slice(0, 3)
    const hasMore = stat.topItems.length > 3

    // 카드 배경 (테두리 강화)
    s1.addShape('roundRect', {
      x, y: catY, w: cardW, h: catH,
      fill: { color: C.white }, line: { color: BORDER_GRAY, width: BORDER_W },
      rectRadius: 0.10,
    })
    // [좌상] 아이콘 (0.45 x 0.45)
    s1.addShape('roundRect', {
      x: x + 0.18, y: catY + 0.18, w: 0.45, h: 0.45,
      fill: { color: C.blueSoft }, line: { type: 'none' }, rectRadius: 0.08,
    })
    s1.addText(meta.emoji, {
      x: x + 0.18, y: catY + 0.18, w: 0.45, h: 0.45,
      fontSize: 16, align: 'center', valign: 'middle',
    })
    // [좌상 옆] 절감률 회색 배지
    s1.addShape('roundRect', {
      x: x + 0.70, y: catY + 0.25, w: 0.78, h: 0.30,
      fill: { color: C.gray100 }, line: { type: 'none' }, rectRadius: 0.15,
    })
    s1.addText(`${isSaving ? '▼' : '▲'} ${stat.savingsPercent.toFixed(1)}%`, {
      x: x + 0.70, y: catY + 0.25, w: 0.78, h: 0.30,
      fontSize: 8, bold: true, color: C.gray700, align: 'center', valign: 'middle',
    })
    // [우상] 현 거래처 비용 (작은 회색)
    s1.addText(`현 거래처 ${formatCurrency(stat.ourCost)}`, {
      x: x + cardW - 2.00, y: catY + 0.18, w: 1.82, h: 0.22,
      fontSize: 8, color: C.gray500, align: 'right',
    })
    // [우상 두번째 줄] 큰 절감액 (빨강 bold)
    s1.addText(`${isSaving ? '−' : '+'} ${formatCurrency(Math.abs(stat.savings))}`, {
      x: x + cardW - 2.00, y: catY + 0.40, w: 1.82, h: 0.32,
      fontSize: 14, bold: true, color: 'DC2626', align: 'right',
    })
    // [좌중] 카테고리명 (큰 bold)
    s1.addText(stat.category, {
      x: x + 0.18, y: catY + 0.78, w: cardW - 0.36, h: 0.32,
      fontSize: 14, bold: true, color: C.gray900,
    })
    // [좌하] 주요 품목 3개 (각 줄, 좌측 정렬)
    topItems.forEach((it, idx) => {
      const isLast = idx === topItems.length - 1
      const suffix = isLast && hasMore ? '  외...' : ''
      s1.addText(
        [
          { text: `${shortName(it.name, 10)} `, options: { color: C.gray700 } },
          { text: `-₩${shortKRW(it.savings)}`, options: { color: 'DC2626' } },
          ...(suffix ? [{ text: suffix, options: { color: C.gray400 } }] : []),
        ],
        {
          x: x + 0.18, y: catY + 1.13 + idx * 0.22, w: cardW - 0.36, h: 0.22,
          fontSize: 8,
        },
      )
    })
  })

  // 푸터 (카테고리 끝 7.10 아래)
  s1.addText(`본 제안서는 ${data.period} 거래명세표 기준으로 작성되었습니다.`, {
    x: CARD_X, y: 7.20, w: 11.00, h: 0.20,
    fontSize: 9, color: C.gray400, align: 'center',
  })
  s1.addText('1 / 2', {
    x: 12.20, y: 7.25, w: 1.00, h: 0.18,
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
  // 연간 절감 강조 (좌하) — 2026-05-17 inline layout (라벨 + 금액 한 줄, baseline 정렬)
  // 이전: 두 텍스트 박스가 겹침/카드 boundary 초과
  // 변경: PptxGenJS text-run으로 한 박스에 두 스타일 — vertical 중앙 정렬
  s2.addText(
    [
      { text: '연간 절감   ', options: { fontSize: 11, color: 'FCD34D', charSpacing: 1 } },
      { text: formatCurrency(data.annualSavings), options: { fontSize: 26, bold: true, color: 'FBBF24' } },
    ],
    {
      x: 1.10, y: a1Y + 1.55, w: 8.00, h: 0.45,
      valign: 'middle',
    },
  )
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

  // 부가서비스 항목 (체크된 것만) — 2열 그리드 (2026-05-17 정렬 수정)
  // 이전: ix=0.93 + col*(5.95+0.20) → 우측 column end 13.03 > amber 우측 boundary 12.64
  // 변경: amber 카드 좌우 padding 0.20씩 → grid 영역 0.90 ~ 12.44 (w 11.54)
  //       itW = (11.54 - gap) / 2 = 5.67, 좌우 column이 정확히 amber 안에 fit
  const checked = data.extras.filter((e) => e.checked && e.annualAmount > 0)
  const itY0 = a2Y + 1.17
  const itH = 0.55
  const itGap = 0.08
  // amber 카드 boundary 안에 정확히 fit:
  //   카드 x 0.70 ~ 12.64 (w 11.94)
  //   좌우 padding 0.20 → grid 영역 0.90 ~ 12.44 (w 11.54)
  //   2col + gap 0.20: itW = (11.54 - 0.20) / 2 = 5.67
  const colGap = 0.20
  const gridX = 0.90
  const gridW = 11.54
  const itW = (gridW - colGap) / 2  // 5.67
  checked.forEach((e, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const ix = gridX + col * (itW + colGap)
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
