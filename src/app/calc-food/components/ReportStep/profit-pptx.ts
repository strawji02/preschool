/**
 * 영업자(파트너) 예상 손익 보고서 PPT 다운로드 (PptxGenJS) — 16:9 1슬라이드
 *
 * 급식 제안서(원장 제출용)와 별도로, 해당 유치원에 급식을 공급하는 영업자에게
 * 제공할 1장짜리 예상 손익 보고서. 리포트 데이터에서 일반화되어 생성된다.
 *
 *   파트너 연 수익 = 신세계 공급 연매출(annualSsgCost) × 배분율(15%)
 *
 * 구성:
 *   1. 헤더 navy band ("{유치원명} — 영업자 예상 손익 보고서")
 *   2. HERO 3카드 (연 수익 / 월 평균 / 원아당)
 *   3. 산출 근거 (공급 연매출 × 배분율 = 연 수익)
 *   4. 수익 구조 (절감액은 부가서비스 환원 → 파트너 수익과 별개 / 업무=영업만)
 *   5. 확장 시나리오 (3곳 / 5곳 / 10곳)
 */
import { formatCurrency, formatNumber } from '@/lib/format'
import { computePartnerProfit, PARTNER_SHARE_RATE } from '@/lib/partner-profit'

export interface ProfitPptxData {
  proposedTo: string
  period: string
  /** 신세계 공급 연매출 (= annualSsgCost) — 파트너 배분 기준 */
  annualSupplyRevenue: number
  /** 연간 절감액 (원장 부가서비스 환원분 — 파트너 수익과 별개) */
  annualSavings: number
  savingsPercent: number
  childrenCount: number
  /** 신세계 DB 단가 기준 연월 (푸터 표시용) */
  ssgPeriod?: string
  /** 배분율 (기본 15%) */
  shareRate?: number
}

const C = {
  navy: '1A2B5C',
  blueHero: '2563EB',
  blueDark: '1E3A8A',
  blueText: '1E3A8A',
  blueLight: 'DBEAFE',
  amberSoft: 'FEF3C7',
  amber: 'F59E0B',
  amberDark: 'B45309',
  emerald50: 'ECFDF5',
  emerald500: '10B981',
  emeraldText: '047857',
  slate700: '334155',
  slate500: '64748B',
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

export async function downloadProfitReportPptx(data: ProfitPptxData) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 inch
  pptx.title = `${data.proposedTo} 영업자 예상 손익 보고서`
  pptx.author = '신세계푸드'
  pptx.company = '신세계푸드'

  const shareRate = data.shareRate ?? PARTNER_SHARE_RATE
  const profit = computePartnerProfit({
    annualSupplyRevenue: data.annualSupplyRevenue,
    childrenCount: data.childrenCount,
    shareRate,
  })
  const sharePctLabel = `${(shareRate * 100).toFixed(shareRate * 100 % 1 === 0 ? 0 : 1)}%`

  const s = pptx.addSlide()
  s.background = { color: C.white }

  const PAGE_W = 13.333
  const MARGIN = 0.6
  const CONTENT_W = PAGE_W - MARGIN * 2 // 12.13
  const BORDER_W = 1.5

  // ── (1) 헤더 navy band ──
  s.addShape('rect', {
    x: 0, y: 0, w: PAGE_W, h: 0.85,
    fill: { color: C.navy }, line: { type: 'none' },
  })
  s.addText(`${data.proposedTo || '유치원'} — 영업자 예상 손익 보고서`, {
    x: 0.7, y: 0.24, w: 9.5, h: 0.42,
    fontSize: 21, bold: true, color: C.white, fontFace: 'Pretendard',
  })
  s.addText(`원아 ${formatNumber(data.childrenCount)}명 · 배분율 ${sharePctLabel} · ${data.period}`, {
    x: 9.3, y: 0.30, w: 3.5, h: 0.32,
    fontSize: 11, color: 'BFDBFE', align: 'right', fontFace: 'Pretendard',
  })

  // ── (2) HERO 3카드: 연 수익 / 월 평균 / 원아당 ──
  const heroY = 1.15
  const heroH = 1.55
  const heroGap = 0.22
  const heroW = (CONTENT_W - heroGap * 2) / 3 // 약 3.90

  const heroCards: { label: string; value: string; sub: string; fill: string; valColor: string; labelColor: string; subColor: string }[] = [
    {
      label: '파트너 연 예상 수익',
      value: formatCurrency(profit.annual),
      sub: `공급 연매출 × 배분율 ${sharePctLabel}`,
      fill: C.blueHero, valColor: C.white, labelColor: 'BFDBFE', subColor: 'BFDBFE',
    },
    {
      label: '월 평균',
      value: formatCurrency(profit.monthly),
      sub: '연 수익 ÷ 12개월',
      fill: C.white, valColor: C.blueText, labelColor: C.gray500, subColor: C.gray500,
    },
    {
      label: '원아 1명당 (연)',
      value: formatCurrency(profit.perChild),
      sub: `원아 ${formatNumber(data.childrenCount)}명 기준`,
      fill: C.white, valColor: C.gray900, labelColor: C.gray500, subColor: C.gray500,
    },
  ]
  heroCards.forEach((c, i) => {
    const x = MARGIN + i * (heroW + heroGap)
    const isHero = i === 0
    s.addShape('roundRect', {
      x, y: heroY, w: heroW, h: heroH,
      fill: { color: c.fill },
      line: isHero ? { type: 'none' } : { color: C.border, width: BORDER_W },
      rectRadius: 0.12,
    })
    s.addText(c.label, {
      x: x + 0.25, y: heroY + 0.20, w: heroW - 0.5, h: 0.28,
      fontSize: 11, bold: true, color: c.labelColor, charSpacing: 1,
    })
    s.addText(c.value, {
      x: x + 0.25, y: heroY + 0.55, w: heroW - 0.5, h: 0.62,
      fontSize: isHero ? 30 : 26, bold: true, color: c.valColor, fontFace: 'Pretendard',
    })
    s.addText(c.sub, {
      x: x + 0.25, y: heroY + 1.20, w: heroW - 0.5, h: 0.25,
      fontSize: 10, color: c.subColor,
    })
  })

  // ── (3) 산출 근거 box ──
  const calcY = heroY + heroH + 0.28 // 2.98
  const calcH = 1.05
  s.addShape('roundRect', {
    x: MARGIN, y: calcY, w: CONTENT_W, h: calcH,
    fill: { color: C.gray50 }, line: { color: C.border, width: BORDER_W }, rectRadius: 0.10,
  })
  s.addText('산출 근거', {
    x: MARGIN + 0.25, y: calcY + 0.16, w: 3.0, h: 0.26,
    fontSize: 12, bold: true, color: C.gray900,
  })
  // 계산식: 공급 연매출 × 배분율 = 연 수익 (가로 배치)
  s.addText(
    [
      { text: '신세계 공급 연매출  ', options: { color: C.gray500, fontSize: 11 } },
      { text: formatCurrency(data.annualSupplyRevenue), options: { color: C.gray900, bold: true, fontSize: 15 } },
      { text: '   ×   배분율  ', options: { color: C.gray500, fontSize: 11 } },
      { text: sharePctLabel, options: { color: C.blueText, bold: true, fontSize: 15 } },
      { text: '   =   ', options: { color: C.gray500, fontSize: 11 } },
      { text: formatCurrency(profit.annual), options: { color: C.blueHero, bold: true, fontSize: 17 } },
      { text: ' / 년', options: { color: C.gray500, fontSize: 11 } },
    ],
    { x: MARGIN + 0.25, y: calcY + 0.50, w: CONTENT_W - 0.5, h: 0.42, valign: 'middle' },
  )

  // ── (4) 수익 구조 확인 + (5) 확장 시나리오 (2열 배치) ──
  const rowY = calcY + calcH + 0.28 // 4.31
  const rowH = 2.30
  const colGap = 0.28
  const colW = (CONTENT_W - colGap) / 2 // 5.92

  // (4) 수익 구조 — 좌측 (emerald 톤)
  s.addShape('roundRect', {
    x: MARGIN, y: rowY, w: colW, h: rowH,
    fill: { color: C.emerald50 }, line: { color: '6EE7B7', width: BORDER_W }, rectRadius: 0.10,
  })
  s.addText('수익 구조 (원장 절감액과 별개)', {
    x: MARGIN + 0.25, y: rowY + 0.16, w: colW - 0.5, h: 0.28,
    fontSize: 12, bold: true, color: C.emeraldText,
  })
  const structBullets = [
    `절감액 ${formatCurrency(data.annualSavings)}(▼${data.savingsPercent.toFixed(1)}%)은 전액 유치원 부가서비스로 환원 → 파트너 수익과 무관`,
    `파트너 수익은 신세계 공급가에 포함된 마진의 ${sharePctLabel} 배분에서 발생`,
    '파트너 업무 = 영업(명세서 수령·제안서 전달)뿐, 운영은 플랫폼 담당',
  ]
  structBullets.forEach((t, i) => {
    s.addText(t, {
      x: MARGIN + 0.30, y: rowY + 0.56 + i * 0.55, w: colW - 0.55, h: 0.52,
      fontSize: 10.5, color: C.gray700, valign: 'top',
      bullet: { code: '2022', indent: 12 },
    })
  })

  // (5) 확장 시나리오 — 우측 (amber 톤)
  const scX = MARGIN + colW + colGap
  s.addShape('roundRect', {
    x: scX, y: rowY, w: colW, h: rowH,
    fill: { color: C.amberSoft }, line: { color: 'FCD34D', width: BORDER_W }, rectRadius: 0.10,
  })
  s.addText('확장 시나리오 (거래처 확대 시 연 수익)', {
    x: scX + 0.25, y: rowY + 0.16, w: colW - 0.5, h: 0.28,
    fontSize: 12, bold: true, color: C.amberDark,
  })
  const scRowH = 0.50
  const scRowY0 = rowY + 0.58
  profit.scenarios.forEach((sc, i) => {
    const y = scRowY0 + i * (scRowH + 0.06)
    s.addShape('roundRect', {
      x: scX + 0.25, y, w: colW - 0.5, h: scRowH,
      fill: { color: C.white, transparency: 20 }, line: { type: 'none' }, rectRadius: 0.06,
    })
    s.addText(`거래처 ${sc.count}곳`, {
      x: scX + 0.42, y, w: 2.5, h: scRowH,
      fontSize: 12, bold: true, color: C.gray700, valign: 'middle',
    })
    s.addText(`${formatCurrency(sc.annual)} / 년`, {
      x: scX + colW - 3.4, y, w: 3.1, h: scRowH,
      fontSize: 13, bold: true, color: C.amberDark, align: 'right', valign: 'middle',
    })
  })

  // ── 푸터 ──
  s.addText(
    `본 손익 보고서는 ${data.ssgPeriod ?? data.period} 신세계 단가 기준 공급 매출 × 배분율 ${sharePctLabel}로 산출한 예상치입니다. 실제 조건은 계약 시 서면 안내됩니다.`,
    { x: 0.5, y: 7.18, w: 12.33, h: 0.22, fontSize: 9, color: C.gray400, align: 'center' },
  )

  const fileName = `${data.proposedTo || '유치원'} 영업자 손익 보고서_${data.period.replace(/\s/g, '')}.pptx`
  await pptx.writeFile({ fileName })
}
