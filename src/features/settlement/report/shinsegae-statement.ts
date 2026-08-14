import type { StatementIssuer, VenueStatementItem } from './venue-statement'

/**
 * 신세계 유치원 거래명세표 — **원본 서식 그대로** (docs §19-2)
 *
 * ★ **공급자는 (주)신세계푸드다.** 유치원이 신세계에서 받던 문서를 그대로 원한다.
 * 우리 단가가 신세계 청구가와 **원단위로 같음을 확인**했으므로 사실과 어긋나지 않는다
 * (국제유치원 26년 6월: 8,897,920 / 889,792 / 16,401,559 / 26,189,271 전부 일치).
 *
 * 그래서 공급자 정보와 직인은 **템플릿 파일에 박혀 있고 이 모듈은 건드리지 않는다.**
 *
 * ★ **여기는 순수 계산만 한다.** 엑셀 쓰기는 `shinsegae-statement-workbook.ts`가
 * 템플릿(`templates/신세계_거래명세표.xlsx`)의 블록을 복제해 채운다. 서식을 코드로
 * 그리지 않는 이유는 원본이 43열·병합 7,309개짜리 **폼**이기 때문이다.
 *
 * ★ **명세서 시트는 전부 텍스트 서식(`@`)이다.** 신세계 시스템이 `'13,170'`처럼
 * 콤마까지 문자열로 찍는다. 그래서 표시 문자열을 여기서 만든다. 집계표만 숫자다.
 */

export interface ShinsegaeStatementBuyer {
  companyName: string
  bizRegNo: string
  /** 대표가 둘이면 둘 다 적는다 — 유치원 요청 (`이정철,김춘태`) */
  ceoName: string
  address: string
}

export interface ShinsegaeStatementInput {
  businessName: string
  /** `YYYY-MM` */
  period: string
  buyer: ShinsegaeStatementBuyer
  items: readonly VenueStatementItem[]
  /**
   * 품목코드 → 원산지 (docs §21).
   *
   * 신세계 월별 단가표에서 온다. 우리 원천에는 원산지가 없어 §19에서 열을
   * 비워 뒀는데, 단가표를 받게 되면서 채울 수 있게 됐다.
   *
   * ⚠️ **못 찾으면 빈칸으로 둔다.** 품목명에 `국내산`이 있다고 추정해 넣으면
   * **틀린 원산지를 유치원에 주는 문서**가 된다 (§19 원칙).
   */
  originByCode?: ReadonlyMap<string, string>
}

export interface ShinsegaeStatementRow {
  no: number
  temperature: string
  /** 단가표에서 찾은 원산지. 못 찾으면 빈 문자열 (§19 원칙) */
  origin: string
  productName: string
  spec: string
  unit: string
  quantity: number
  unitPrice: number
  supply: number
  vat: number
  total: number
}

/** 납품일 한 건 = 인쇄물 한 장 */
export interface ShinsegaeStatementBlock {
  /** `YYYY-MM-DD` */
  date: string
  items: ShinsegaeStatementRow[]
  /** 그날 과세 공급가 */
  taxableSupply: number
  /** 그날 면세 공급가 */
  exempt: number
  /** 과세 + 면세 */
  supply: number
  vat: number
  total: number
  /** 그날까지의 누계 — 원본의 `월합계` 행 */
  cumulativeSupply: number
  cumulativeVat: number
  cumulativeTotal: number
  /** `1/6` */
  page: string
}

export interface ShinsegaeStatementSheet {
  restaurantName: string
  blocks: ShinsegaeStatementBlock[]
}

export interface ShinsegaeSummaryRow {
  no: number
  name: string
  /** 공급가(A) — 과세만 */
  taxableSupply: number
  /** 부가세(B) */
  vat: number
  /** 계 = A + B */
  sum: number
  /** 면세(C) */
  exempt: number
  /** 합계액 = A + B + C */
  total: number
}

export interface OriginReport {
  /** 원천 품목 행 수 */
  total: number
  /** 단가표에서 원산지를 찾은 행 수 */
  filled: number
  /** 못 찾은 품목코드 (중복 제거) */
  missing: string[]
}

export interface ShinsegaeStatement {
  title: string
  /** 원산지를 얼마나 채웠는지 — 화면이 생성 전에 보여준다 */
  originReport: OriginReport
  buyer: ShinsegaeStatementBuyer
  summary: ShinsegaeSummaryRow[]
  summaryTotal: Omit<ShinsegaeSummaryRow, 'no' | 'name'>
  sheets: ShinsegaeStatementSheet[]
}

/**
 * 온도는 품목명 끝에서 뽑는다 (docs §19). 원천에 온도 열이 없다.
 * 못 찾으면 빈칸 — 틀린 값을 넣지 않는다.
 */
export function extractTemperature(productName: string): string {
  const m = productName.match(/(실온\(냉장 권장\)|실온|냉장|냉동|건냉)\s*$/)
  return m ? m[1] : ''
}

/** 금액 — 명세서 셀이 텍스트라 콤마를 우리가 만든다 */
export function formatStatementAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** 수량 — 원본이 `2.00` 형식이다 */
export function formatStatementQuantity(n: number): string {
  return n.toFixed(2)
}

/** 날짜 — 원본이 `2026년 06월 05일` 형식이다 */
export function formatStatementDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${y}년 ${m}월 ${d}일`
}

export function buildShinsegaeStatement(input: ShinsegaeStatementInput): ShinsegaeStatement {
  /** 원산지를 얼마나 채웠는지 — 생성 전에 사용자에게 보여준다 */
  let originFilled = 0
  const originMissing = new Set<string>()

  const byRestaurant = new Map<string, VenueStatementItem[]>()
  for (const it of input.items) {
    const list = byRestaurant.get(it.restaurantName)
    if (list) list.push(it)
    else byRestaurant.set(it.restaurantName, [it])
  }

  const sheets: ShinsegaeStatementSheet[] = []
  const summary: ShinsegaeSummaryRow[] = []

  for (const [restaurantName, items] of byRestaurant) {
    const byDate = new Map<string, VenueStatementItem[]>()
    for (const it of items) {
      const list = byDate.get(it.date)
      if (list) list.push(it)
      else byDate.set(it.date, [it])
    }
    const dates = [...byDate.keys()].sort()

    const blocks: ShinsegaeStatementBlock[] = []
    let cumSupply = 0
    let cumVat = 0
    let cumTotal = 0

    for (const date of dates) {
      const dayItems = byDate.get(date) ?? []
      let taxableSupply = 0
      let exempt = 0
      let vat = 0

      const rows: ShinsegaeStatementRow[] = dayItems.map((it, i) => {
        const code = it.productCode ?? ''
        const origin = input.originByCode?.get(code) ?? ''
        if (origin) originFilled++
        else originMissing.add(code)
        if (it.taxable) {
          taxableSupply += it.supply
          vat += it.vat
        } else {
          exempt += it.supply
        }
        return {
          no: i + 1,
          temperature: extractTemperature(it.productName),
          origin: origin,
          productName: it.productName,
          spec: it.spec,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          supply: it.supply,
          vat: it.vat,
          total: it.total,
        }
      })

      const supply = taxableSupply + exempt
      const total = supply + vat
      cumSupply += supply
      cumVat += vat
      cumTotal += total

      blocks.push({
        date,
        items: rows,
        taxableSupply,
        exempt,
        supply,
        vat,
        total,
        cumulativeSupply: cumSupply,
        cumulativeVat: cumVat,
        cumulativeTotal: cumTotal,
        page: '', // 아래에서 채운다 — 전체 장수를 알아야 한다
      })
    }

    for (let i = 0; i < blocks.length; i++) {
      blocks[i].page = `${i + 1}/${blocks.length}`
    }

    sheets.push({ restaurantName, blocks })

    /*
      집계표의 `계`는 **A+B**(과세공급가 + 부가세)다. 명세서의 `월합계` 공급
      (과세 + 면세)과 뜻이 다르다 — 원본 실측에서 확인했다:
        오전간식  계 579,172 = 526,520 + 52,652
                 월합계 579,200 = 526,520 + 52,680
      두 숫자가 비슷해서 헷갈리기 쉽다. 섞으면 유치원 청구서가 틀린다.
    */
    const taxableSupply = blocks.reduce((a, b) => a + b.taxableSupply, 0)
    const vat = blocks.reduce((a, b) => a + b.vat, 0)
    const exempt = blocks.reduce((a, b) => a + b.exempt, 0)
    summary.push({
      no: summary.length + 1,
      name: restaurantName,
      taxableSupply,
      vat,
      sum: taxableSupply + vat,
      exempt,
      total: taxableSupply + vat + exempt,
    })
  }

  const summaryTotal = summary.reduce(
    (a, r) => ({
      taxableSupply: a.taxableSupply + r.taxableSupply,
      vat: a.vat + r.vat,
      sum: a.sum + r.sum,
      exempt: a.exempt + r.exempt,
      total: a.total + r.total,
    }),
    { taxableSupply: 0, vat: 0, sum: 0, exempt: 0, total: 0 }
  )

  const [year, month] = input.period.split('-')
  const title = `${input.businessName}_${year.slice(2)}년 ${Number(month)}월 급식 청구`

  return {
    title,
    originReport: {
      total: input.items.length,
      filled: originFilled,
      // ⚠️ 못 찾은 코드는 **빈칸으로 둔다** — 추정해 넣으면 틀린 원산지가 나간다
      missing: [...originMissing].filter((c) => c !== '').sort(),
    },
    buyer: input.buyer,
    summary,
    summaryTotal,
    sheets,
  }
}

export type { StatementIssuer }
