/**
 * 영업자(파트너) 손익 보고서 PPT — 계약식(제4조) + 마진율 민감도 (16:9 1슬라이드)
 *
 * 급식 제안서(원장 제출용)와 별도로, 급식을 공급하는 영업자에게 제공할
 * "마진율에 따른 내 수익 vs 유치원 제공 서비스" 비교 보고서.
 *
 *   영업자 정산금 = 신세계 원가 × (마진율 m − 플랫폼수수료 5%)
 *   유치원 판매가 = 원가 × (1 + m)
 *   유치원 제공 서비스(절감 환원) = 원장 현재가 − 판매가
 *
 * 마진율 민감도 표는 보고서 작성자가 설정한 현재 공급율(supplyRate)을 중심으로
 * ±3%×3단계(총 7행) 동적 생성하며, 현재 행을 강조한다.
 *
 * 구성:
 *   1. 헤더 navy band
 *   2. HERO 2카드 (현재 마진 기준 영업자 연 정산금 / 유치원 제공 서비스)
 *   3. 마진율 민감도 표 (마진율 · 판매가 · 유치원 제공 서비스 · 영업자 정산금(매출대비%))
 *   4. 계산 근거 + trade-off 요약 + 각주
 */
import { formatCurrency, formatNumber } from '@/lib/format'
import {
  computePartnerProfit,
  computeMarginSensitivity,
  PLATFORM_FEE_RATE,
} from '@/lib/partner-profit'

export interface ProfitPptxData {
  proposedTo: string
  period: string
  /** 현재 공급율 기준 신세계 판매가(연) = annualSsgCost = 원가 × supplyRate */
  annualSupplyRevenue: number
  /** 현재 공급율 (1+m) — 작성자가 설정한 값 (민감도 표 중심) */
  supplyRate: number
  /** 원장 현재가(비교가능, 연) — 유치원 제공 서비스 기준 */
  annualOurCost: number
  /** 현재 마진 기준 연간 절감액 (참고) */
  annualSavings: number
  savingsPercent: number
  childrenCount: number
  /** 신세계 DB 단가 기준 연월 (푸터) */
  ssgPeriod?: string
  /** 플랫폼 수수료율 (기본 5%) */
  platformFeeRate?: number
}

const C = {
  navy: '1A2B5C',
  blueHero: '2563EB',
  blueText: '1E3A8A',
  emerald50: 'ECFDF5',
  emeraldText: '047857',
  emerald600: '059669',
  amberSoft: 'FEF3C7',
  amberDark: 'B45309',
  slate700: '334155',
  slate100: 'F1F5F9',
  white: 'FFFFFF',
  gray900: '111827',
  gray700: '374151',
  gray500: '6B7280',
  gray400: '9CA3AF',
  gray200: 'E5E7EB',
  gray100: 'F3F4F6',
  gray50: 'F9FAFB',
  border: 'CBD5E1',
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const mLabel = (m: number) => `${Math.round(m * 100)}%`

export async function downloadProfitReportPptx(data: ProfitPptxData) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 inch
  pptx.title = `${data.proposedTo} 영업자 손익 보고서`
  pptx.author = '신세계푸드'
  pptx.company = '신세계푸드'

  const fee = data.platformFeeRate ?? PLATFORM_FEE_RATE
  const purchaseCost = data.supplyRate !== 0 ? data.annualSupplyRevenue / data.supplyRate : 0

  // 현재 마진 기준 파트너 손익
  const profit = computePartnerProfit({
    annualSupplyRevenue: data.annualSupplyRevenue,
    supplyRate: data.supplyRate,
    childrenCount: data.childrenCount,
    platformFeeRate: fee,
  })
  // 마진율 민감도 (현재 공급율 중심 ±3%×3단계)
  const rows = computeMarginSensitivity({
    purchaseCost,
    currentSupplyRate: data.supplyRate,
    kindergartenCurrentCost: data.annualOurCost,
    platformFeeRate: fee,
  })

  const s = pptx.addSlide()
  s.background = { color: C.white }

  const PAGE_W = 13.333
  const MARGIN = 0.6
  const CONTENT_W = PAGE_W - MARGIN * 2 // 12.13

  // ── (1) 헤더 navy band ──
  s.addShape('rect', { x: 0, y: 0, w: PAGE_W, h: 0.82, fill: { color: C.navy }, line: { type: 'none' } })
  s.addText(`${data.proposedTo || '유치원'} — 영업자 손익 보고서`, {
    x: 0.7, y: 0.22, w: 8.8, h: 0.42, fontSize: 21, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s.addText(`현재 마진율 ${mLabel(profit.marginRate)} · 원아 ${formatNumber(data.childrenCount)}명 · ${data.period}`, {
    x: 8.6, y: 0.28, w: 4.1, h: 0.32, fontSize: 11, color: 'BFDBFE', align: 'right', fontFace: 'Pretendard',
  })

  // ── (2) HERO 2카드 (현재 마진 기준) ──
  const heroY = 1.05
  const heroH = 1.35
  const heroGap = 0.28
  const heroW = (CONTENT_W - heroGap) / 2

  // 좌: 영업자 연 정산금 (blue)
  s.addShape('roundRect', { x: MARGIN, y: heroY, w: heroW, h: heroH, fill: { color: C.blueHero }, line: { type: 'none' }, rectRadius: 0.12 })
  s.addText(`영업자 연 예상 정산금  (마진 ${mLabel(profit.marginRate)})`, {
    x: MARGIN + 0.25, y: heroY + 0.18, w: heroW - 0.5, h: 0.28, fontSize: 11, bold: true, color: 'BFDBFE', charSpacing: 1,
  })
  s.addText(formatCurrency(profit.annual), {
    x: MARGIN + 0.25, y: heroY + 0.50, w: heroW - 0.5, h: 0.55, fontSize: 30, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s.addText(`월 ${formatCurrency(profit.monthly)}  ·  매출대비 ${pct(profit.revenuePctOfSales)}  ·  원아당 ${formatCurrency(profit.perChild)}`, {
    x: MARGIN + 0.25, y: heroY + 1.05, w: heroW - 0.5, h: 0.24, fontSize: 10, color: 'BFDBFE',
  })

  // 우: 유치원 제공 서비스 (emerald)
  const hx2 = MARGIN + heroW + heroGap
  s.addShape('roundRect', { x: hx2, y: heroY, w: heroW, h: heroH, fill: { color: C.emerald50 }, line: { color: '6EE7B7', width: 1.5 }, rectRadius: 0.12 })
  s.addText('유치원 제공 서비스 (절감 환원, 연)', {
    x: hx2 + 0.25, y: heroY + 0.18, w: heroW - 0.5, h: 0.28, fontSize: 11, bold: true, color: C.emeraldText, charSpacing: 1,
  })
  s.addText(formatCurrency(data.annualSavings), {
    x: hx2 + 0.25, y: heroY + 0.50, w: heroW - 0.5, h: 0.55, fontSize: 30, bold: true, color: C.emerald600, fontFace: 'Pretendard',
  })
  s.addText(`원장 현재가 ${formatCurrency(data.annualOurCost)} 대비 ▼${data.savingsPercent.toFixed(1)}%`, {
    x: hx2 + 0.25, y: heroY + 1.05, w: heroW - 0.5, h: 0.24, fontSize: 10, color: C.emeraldText,
  })

  // ── (3) 마진율 민감도 표 ──
  const tblY = heroY + heroH + 0.28 // 2.68
  s.addText('마진율 시나리오 — 내 수익 vs 유치원 제공 서비스', {
    x: MARGIN, y: tblY, w: CONTENT_W, h: 0.30, fontSize: 13, bold: true, color: C.gray900,
  })

  const header = ['마진율', '유치원 판매가', '🏫 유치원 제공 서비스', '💼 영업자 연 정산금', '매출대비'].map((t) => ({
    text: t,
    options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 11, align: 'center' as const, valign: 'middle' as const },
  }))

  const bodyRows = rows.map((r) => {
    const cur = r.isCurrent
    const baseFill = cur ? 'DBEAFE' : C.white
    const cell = (text: string, align: 'left' | 'right' | 'center', color: string, bold = false) => ({
      text,
      options: {
        align, valign: 'middle' as const, fontSize: cur ? 12 : 11, bold: bold || cur, color,
        fill: { color: baseFill },
      },
    })
    return [
      cell(cur ? `${mLabel(r.marginRate)} ★` : mLabel(r.marginRate), 'center', cur ? C.blueText : C.gray700, true),
      cell(formatCurrency(r.salePrice), 'right', C.gray700),
      cell(formatCurrency(r.kindergartenService), 'right', r.kindergartenService >= 0 ? C.emeraldText : 'DC2626', true),
      cell(formatCurrency(r.partnerSettlement), 'right', C.blueText, true),
      cell(pct(r.partnerPctOfSales), 'center', C.gray700),
    ]
  })

  const tableH = 3.05
  s.addTable([header, ...bodyRows], {
    x: MARGIN, y: tblY + 0.36, w: CONTENT_W, h: tableH,
    colW: [1.55, 2.75, 3.0, 3.0, 1.83],
    border: { type: 'solid', color: C.border, pt: 0.5 },
    rowH: tableH / (bodyRows.length + 1),
    valign: 'middle', fontFace: 'Pretendard',
  })

  // ── (4) 근거 + trade-off + 각주 ──
  const noteY = tblY + 0.36 + tableH + 0.14
  s.addText(
    [
      { text: '계산 근거  ', options: { bold: true, color: C.gray900, fontSize: 10 } },
      {
        text: `영업자 정산금 = 신세계 원가 ${formatCurrency(purchaseCost)} × (마진율 − 플랫폼수수료 ${pct(fee)})  ·  판매가 = 원가 × (1 + 마진율)  ·  유치원 제공 서비스 = 원장 현재가 − 판매가`,
        options: { color: C.gray500, fontSize: 10 },
      },
    ],
    { x: MARGIN, y: noteY, w: CONTENT_W, h: 0.26, valign: 'middle' },
  )
  s.addText(
    '마진율을 3%p 올릴 때마다 영업자 수익은 늘고, 그만큼 유치원 제공 서비스(절감 환원)는 줄어듭니다. 영업 난이도와 수익의 균형점을 선택하세요.',
    { x: MARGIN, y: noteY + 0.28, w: CONTENT_W, h: 0.26, fontSize: 10.5, bold: true, color: C.slate700, valign: 'middle' },
  )

  s.addText(
    `본 손익 보고서는 ${data.ssgPeriod ?? data.period} 신세계 단가·계약식(제4조) 기준 예상치입니다. 플랫폼 수수료 ${pct(fee)}(원가 대비) 적용. 발표자료의 '매출 15%'는 마진 20% 근사치이며 실제 정산은 마진율 연동입니다.`,
    { x: 0.5, y: 7.2, w: 12.33, h: 0.2, fontSize: 8.5, color: C.gray400, align: 'center' },
  )

  const fileName = `${data.proposedTo || '유치원'} 영업자 손익 보고서_${data.period.replace(/\s/g, '')}.pptx`
  await pptx.writeFile({ fileName })
}
