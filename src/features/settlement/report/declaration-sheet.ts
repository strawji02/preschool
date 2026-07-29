import { percentRoundDownTo10 } from '../calc/rounding'
import { validateSplitDeclaration, type DeclarationSplit } from '../calc/split-declaration'

/**
 * 사업소득 지급명세서 (docs/systems/settlement.md §6-3) — 세무사 제출용.
 *
 * 근거 파일 `사업소득 신고내역` 시트를 그대로 재현한다 (2026-07-30 실측).
 *
 * ```
 *  1행: 26년 6월 사업소득 신고 내역_종합   (A1:H1 병합)
 *  6행: ◆ 키즈웰에듀푸드(831-05-03575)
 *  7행: 구분 성명 사업소득액 소득세 지방소득세 소득세계 실지급액 주민번호
 *  8행~: 1 김인순 5,000,000 150,000 15,000 165,000 4,835,000 (주민번호 빈칸)
 * 13행: 계 (A13:B13 병합)
 * 15행: 예성세무회계 / 16행: ysd8304@naver.com
 * ```
 *
 * ⚠️ 이 시트에는 `집계표_정산용`과 **다른 정의가 두 개** 있다. 같은 이름의 열이라도
 * 값이 다르니 두 문서를 나란히 놓고 비교할 때 주의해야 한다.
 *
 * 1. **세액을 명의별로 계산한다.** 영업자 전체 신고액이 아니라 분할된 각 명의의
 *    금액에 3%/10%를 적용한다 — 실제로 각 사람 앞으로 원천징수되기 때문이다.
 *    10원 내림을 명의별로 하므로 합계가 전체 기준과 어긋날 수 있다(경고로 알린다).
 * 2. **`실지급액` = 사업소득액 − 소득세계.** 집계표의 실지급(U)은
 *    `세전(R) − 소득세 − 지방세`라서 값이 다르다. 여기는 신고 문서이므로
 *    신고액에서 세금만 뺀 금액을 적는다.
 */

/** 사업소득세율 (%) */
const INCOME_TAX_PERCENT = 3
/** 지방소득세율 — 소득세의 % */
const LOCAL_TAX_PERCENT = 10

/** 열 위치 (0-based). 원본 A~H와 1:1 대응. */
export const DECLARATION_COL = {
  seq: 0,
  name: 1,
  amount: 2,
  incomeTax: 3,
  localTax: 4,
  taxTotal: 5,
  netPay: 6,
  /** 주민번호 — docs §7에 따라 **항상 빈칸**. 사용자가 다운로드 후 직접 채운다. */
  residentId: 7,
} as const

const COL_COUNT = DECLARATION_COL.residentId + 1

/** 제목행 다음 빈 행 수. 원본 2~5행이 비어 있다. */
const HEADER_ROW = 6
const BUSINESS_ROW = 5
const FIRST_ENTRY_ROW = HEADER_ROW + 1

/** 근거 파일의 사업자·세무사 정보. 운영에서 바뀌면 옵션으로 넘긴다. */
const DEFAULT_BUSINESS_LABEL = '◆ 키즈웰에듀푸드(831-05-03575)'
const DEFAULT_ACCOUNTANT_NAME = '예성세무회계'
const DEFAULT_ACCOUNTANT_EMAIL = 'ysd8304@naver.com'

export interface NameWithholding {
  /** 소득세 = 사업소득액 × 3% (10원 내림) */
  incomeTax: number
  /** 지방소득세 = 소득세 × 10% (10원 내림) */
  localTax: number
  /** 소득세계 = 소득세 + 지방소득세 */
  taxTotal: number
  /** ⚠️ 이 시트의 실지급액 = 사업소득액 − 소득세계 (집계표의 U와 다르다) */
  netPay: number
}

/**
 * 한 명의(名義)에 대한 원천징수.
 *
 * 영업자 단위가 아니라 **신고 명의 단위**로 계산한다 — 분할 신고를 하면
 * 각 사람 앞으로 따로 원천징수되므로 그 단위가 실제 신고 단위다.
 */
export function calcNameWithholding(amount: number): NameWithholding {
  const incomeTax = amount > 0 ? percentRoundDownTo10(amount, INCOME_TAX_PERCENT) : 0
  const localTax = incomeTax > 0 ? percentRoundDownTo10(incomeTax, LOCAL_TAX_PERCENT) : 0
  const taxTotal = incomeTax + localTax

  return { incomeTax, localTax, taxTotal, netPay: amount - taxTotal }
}

export interface DeclarationPartner {
  partnerName: string
  /** 신고액 V — 코파운더는 R+O, 일반은 R */
  declared: number
  /** 분할 신고 명의. 없으면 영업자 본인 명의 1건으로 본다 (docs §4) */
  splits?: readonly DeclarationSplit[]
}

export interface DeclarationLine extends NameWithholding {
  /** 구분 열의 일련번호 (1부터) */
  seq: number
  name: string
  /** 사업소득액 */
  amount: number
  /** 이 행이 어느 영업자에서 나왔는지 — 화면에서 묶어 보여줄 때 쓴다 */
  partnerName: string
}

export interface DeclarationTotals extends NameWithholding {
  amount: number
}

export interface DeclarationLinesResult {
  lines: DeclarationLine[]
  totals: DeclarationTotals
  /**
   * 마감 판단에 쓰는 경고. **시트에는 넣지 않는다** — 제출용 문서에 경고 문구가
   * 섞이면 그대로 세무사에게 갈 수 있다.
   */
  warnings: string[]
}

export function buildDeclarationLines(
  partners: readonly DeclarationPartner[]
): DeclarationLinesResult {
  const lines: DeclarationLine[] = []
  const warnings: string[] = []

  for (const partner of partners) {
    if (partner.declared <= 0) {
      warnings.push(
        `${partner.partnerName}의 신고액이 ${partner.declared.toLocaleString()}원이어서 지급명세서에서 제외했습니다.`
      )
      continue
    }

    const splits =
      partner.splits && partner.splits.length > 0
        ? partner.splits
        : [{ name: partner.partnerName, amount: partner.declared }]

    if (partner.splits && partner.splits.length > 0) {
      const check = validateSplitDeclaration(partner.declared, partner.splits)
      if (!check.valid) {
        const gap = Math.abs(check.diff).toLocaleString()
        const direction = check.diff > 0 ? '초과' : '부족'
        warnings.push(
          `${partner.partnerName}의 분할 신고 합계가 신고액과 ${gap}원 ${direction}합니다 ` +
            `(신고액 ${partner.declared.toLocaleString()}원, 분할 합계 ${check.total.toLocaleString()}원). 마감할 수 없습니다.`
        )
      }
    }

    let splitTaxTotal = 0
    for (const split of splits) {
      const w = calcNameWithholding(split.amount)
      splitTaxTotal += w.taxTotal
      lines.push({
        seq: lines.length + 1,
        name: split.name,
        amount: split.amount,
        partnerName: partner.partnerName,
        ...w,
      })
    }

    // 명의별 10원 내림 때문에 합계가 전체 기준과 어긋날 수 있다. 원천징수 총액이
    // 달라지면 집계표의 실지급액과 신고 문서가 맞지 않으므로 그냥 넘기지 않는다.
    const whole = calcNameWithholding(partner.declared)
    if (splits.length > 1 && splitTaxTotal !== whole.taxTotal) {
      warnings.push(
        `${partner.partnerName}의 원천징수 합계가 분할 때문에 ${Math.abs(
          splitTaxTotal - whole.taxTotal
        ).toLocaleString()}원 어긋납니다 ` +
          `(명의별 합 ${splitTaxTotal.toLocaleString()}원, 전체 기준 ${whole.taxTotal.toLocaleString()}원).`
      )
    }
  }

  const totals = lines.reduce<DeclarationTotals>(
    (acc, l) => ({
      amount: acc.amount + l.amount,
      incomeTax: acc.incomeTax + l.incomeTax,
      localTax: acc.localTax + l.localTax,
      taxTotal: acc.taxTotal + l.taxTotal,
      netPay: acc.netPay + l.netPay,
    }),
    { amount: 0, incomeTax: 0, localTax: 0, taxTotal: 0, netPay: 0 }
  )

  return { lines, totals, warnings }
}

export type DeclarationCell = string | number | null

export interface DeclarationSheetMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

export interface DeclarationSheet {
  rows: DeclarationCell[][]
  merges: DeclarationSheetMerge[]
  lines: DeclarationLine[]
  totals: DeclarationTotals
  warnings: string[]
}

export interface DeclarationSheetInput {
  /** 제목에 들어갈 기간 표기. 예 `26년 6월` */
  periodLabel: string
  partners: readonly DeclarationPartner[]
  businessLabel?: string
  accountantName?: string
  accountantEmail?: string
}

export function buildDeclarationSheet(input: DeclarationSheetInput): DeclarationSheet {
  const { lines, totals, warnings } = buildDeclarationLines(input.partners)

  const rows: DeclarationCell[][] = []
  const merges: DeclarationSheetMerge[] = []
  const emptyRow = (): DeclarationCell[] => new Array<DeclarationCell>(COL_COUNT).fill(null)

  const title = emptyRow()
  title[0] = `${input.periodLabel} 사업소득 신고 내역_종합`
  rows.push(title)
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: DECLARATION_COL.residentId } })

  while (rows.length < BUSINESS_ROW) rows.push(emptyRow())

  const business = emptyRow()
  business[0] = input.businessLabel ?? DEFAULT_BUSINESS_LABEL
  rows.push(business)

  rows.push([
    '구분',
    '성명',
    '사업소득액',
    '소득세',
    '지방소득세',
    '소득세계',
    '실지급액',
    '주민번호',
  ])

  for (const line of lines) {
    const row = emptyRow()
    row[DECLARATION_COL.seq] = line.seq
    row[DECLARATION_COL.name] = line.name
    row[DECLARATION_COL.amount] = line.amount
    row[DECLARATION_COL.incomeTax] = line.incomeTax
    row[DECLARATION_COL.localTax] = line.localTax
    row[DECLARATION_COL.taxTotal] = line.taxTotal
    row[DECLARATION_COL.netPay] = line.netPay
    // 주민번호는 비워 둔다 (docs §7)
    rows.push(row)
  }

  const totalRowIndex = FIRST_ENTRY_ROW + lines.length
  const totalRow = emptyRow()
  totalRow[DECLARATION_COL.seq] = '계'
  totalRow[DECLARATION_COL.amount] = totals.amount
  totalRow[DECLARATION_COL.incomeTax] = totals.incomeTax
  totalRow[DECLARATION_COL.localTax] = totals.localTax
  totalRow[DECLARATION_COL.taxTotal] = totals.taxTotal
  totalRow[DECLARATION_COL.netPay] = totals.netPay
  rows.push(totalRow)
  merges.push({
    s: { r: totalRowIndex, c: DECLARATION_COL.seq },
    e: { r: totalRowIndex, c: DECLARATION_COL.name },
  })

  rows.push(emptyRow())

  const accountant = emptyRow()
  accountant[0] = input.accountantName ?? DEFAULT_ACCOUNTANT_NAME
  rows.push(accountant)

  const email = emptyRow()
  email[0] = input.accountantEmail ?? DEFAULT_ACCOUNTANT_EMAIL
  rows.push(email)

  return { rows, merges, lines, totals, warnings }
}
