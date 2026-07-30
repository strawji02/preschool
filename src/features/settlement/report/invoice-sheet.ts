import type { SettlementSource, TaxBreakdown } from '../parse/types'
import {
  applyInvoiceRounding,
  type InvoiceRoundingMode,
} from '../calc/invoice-rounding'

/**
 * 홈택스 전자(세금)계산서 일괄발행 엑셀 (docs/systems/settlement.md §6-1).
 *
 * 과세 → **세금계산서**(종류 `01`), 면세 → **계산서**(종류 `05`)로 파일을 2개 만든다.
 * 2026-07-30 실제 업로드 파일 2종을 실측해 열 위치·고정값을 그대로 재현했다.
 *
 * ⚠️ **발행 단위는 식당이 아니라 (유치원 사업자번호 × 품목 × 과세구분)** 이다.
 * 26년 6월 해밀유치원 과세에서 식당 2개가 한 장으로 합쳐졌다
 * (39,490 + 96,650 = 급식재료 136,140, 세액도 3,949 + 9,665 = 13,614).
 *
 * ⚠️ 행 순서는 원본과 맞추지 않는다. 원본은 `집계표_정산용`의 수작업 배열을 따르고
 * 재현할 근거가 없다. 홈택스는 **1행 = 독립 계산서**라 순서가 의미를 갖지 않는다.
 * 대신 실파일과 **(유치원 × 품목 × 금액) 집합**이 일치하는지로 검증한다.
 */

export type InvoiceTaxKind = 'taxable' | 'exempt'

/** 계산서 종류 코드 */
const KIND_CODE: Record<InvoiceTaxKind, string> = {
  taxable: '01', // 세금계산서 일반
  exempt: '05', // 계산서 일반
}

/** 영수(01) / 청구(02) — 원본은 전부 청구다 */
const RECEIPT_TYPE_BILLED = '02'

/**
 * 열 위치 (0-based). **양식별로 따로 둔다.**
 *
 * 과세에는 `세액합계`(U=20)가 있어서 그 뒤 모든 열이 1칸 밀린다.
 * 공통 오프셋 상수로 처리하면 반드시 어긋난다.
 */
export const INVOICE_COL = {
  taxable: {
    kind: 0,
    issueDate: 1,
    issuerBizRegNo: 2,
    issuerSubBusinessNo: 3,
    issuerCompanyName: 4,
    issuerCeoName: 5,
    issuerAddress: 6,
    issuerBizType: 7,
    issuerBizItem: 8,
    issuerEmail: 9,
    buyerBizRegNo: 10,
    buyerSubBusinessNo: 11,
    buyerCompanyName: 12,
    buyerCeoName: 13,
    buyerAddress: 14,
    buyerBizType: 15,
    buyerBizItem: 16,
    buyerEmail1: 17,
    buyerEmail2: 18,
    supplyTotal: 19,
    vatTotal: 20,
    note: 21,
    itemDay: 22,
    itemName: 23,
    itemSpec: 24,
    itemQuantity: 25,
    itemUnitPrice: 26,
    itemSupply: 27,
    itemVat: 28,
    itemNote: 29,
    cash: 54,
    check: 55,
    note2: 56,
    receivable: 57,
    receiptType: 58,
    width: 59,
  },
  exempt: {
    kind: 0,
    issueDate: 1,
    issuerBizRegNo: 2,
    issuerSubBusinessNo: 3,
    issuerCompanyName: 4,
    issuerCeoName: 5,
    issuerAddress: 6,
    issuerBizType: 7,
    issuerBizItem: 8,
    issuerEmail: 9,
    buyerBizRegNo: 10,
    buyerSubBusinessNo: 11,
    buyerCompanyName: 12,
    buyerCeoName: 13,
    buyerAddress: 14,
    buyerBizType: 15,
    buyerBizItem: 16,
    buyerEmail1: 17,
    buyerEmail2: 18,
    supplyTotal: 19,
    /** 면세 계산서에는 세액 열이 없다 */
    vatTotal: null,
    note: 20,
    itemDay: 21,
    itemName: 22,
    itemSpec: 23,
    itemQuantity: 24,
    itemUnitPrice: 25,
    itemSupply: 26,
    itemVat: null,
    itemNote: 27,
    cash: 49,
    check: 50,
    note2: 51,
    receivable: 52,
    receiptType: 53,
    width: 54,
  },
} as const

/**
 * 6행 헤더 — 홈택스 템플릿에서 그대로 가져왔다 (2026-07-30 실측).
 * 줄바꿈과 후행 공백까지 원본과 같다. 담당자가 원본과 나란히 대조하기 때문에
 * 임의로 다듬지 않는다.
 */
const HEADER: Record<InvoiceTaxKind, readonly string[]> = {
  taxable: [
    '전자(세금)계산서 종류\n(01:일반, 02:영세율)',
    '작성일자',
    '공급자 등록번호\n("-" 없이 입력)',
    '공급자\n 종사업장번호',
    '공급자 상호',
    '공급자 성명',
    '공급자 사업장주소',
    '공급자 업태',
    '공급자 종목',
    '공급자 이메일',
    '공급받는자 등록번호\n("-" 없이 입력)',
    '공급받는자 \n종사업장번호',
    '공급받는자 상호 ',
    '공급받는자 성명',
    '공급받는자 사업장주소',
    '공급받는자 업태',
    '공급받는자 종목',
    '공급받는자 이메일1',
    '공급받는자 이메일2',
    '공급가액\n합계',
    '세액\n합계',
    '비고',
    ...itemHeaders(1, true),
    ...itemHeaders(2, true),
    ...itemHeaders(3, true),
    ...itemHeaders(4, true),
    '현금',
    '수표',
    '어음',
    '외상미수금',
    '영수(01),\n청구(02)',
  ],
  exempt: [
    '전자(세금)계산서 종류\n(05::일반)',
    '작성일자',
    '공급자 등록번호\n("-" 없이 입력)',
    '공급자\n 종사업장번호',
    '공급자 상호',
    '공급자 성명',
    '공급자 사업장주소',
    '공급자 업태',
    '공급자 종목',
    '공급자 이메일',
    '공급받는자 등록번호\n("-" 없이 입력)',
    '공급받는자 \n종사업장번호',
    '공급받는자 상호',
    '공급받는자 성명',
    '공급받는자 사업장주소',
    '공급받는자 업태',
    '공급받는자 종목',
    '공급받는자 이메일1',
    '공급받는자 이메일2',
    '공급가액\n합계',
    '비고',
    ...itemHeaders(1, false),
    ...itemHeaders(2, false),
    ...itemHeaders(3, false),
    ...itemHeaders(4, false),
    '현금',
    '수표',
    '어음',
    '외상미수금',
    '영수(01),\n청구(02)',
  ],
}

function itemHeaders(n: number, withVat: boolean): string[] {
  const base = [
    `일자${n}\n(2자리, 작성년월 제외)`,
    `품목${n}`,
    `규격${n}`,
    `수량${n}`,
    `단가${n}`,
    `공급가액${n}`,
  ]
  if (withVat) base.push(`세액${n}`)
  base.push(`품목비고${n}`)
  return base
}

/** 데이터 시작 행 (0-based). 1~5행 비움 + 6행 헤더 */
const HEADER_ROW = 5
const FIRST_DATA_ROW = HEADER_ROW + 1

export interface InvoiceParty {
  /** 10자리, 하이픈 없음 */
  bizRegNo: string
  companyName: string
  ceoName: string
  address: string
  bizType: string
  bizItem: string
  email: string
  /** 원본 16곳 모두 미사용. 있으면 이메일2에 넣는다 */
  email2?: string | null
}

/** 원천 식당 한 줄 + 계산서 발행에 필요한 마스터 */
export interface InvoiceVenueLine {
  source: SettlementSource
  businessCode: string
  /** 원천 사업장명. 계산서에는 쓰지 않고 화면에서 어느 유치원인지 알아보는 데 쓴다 */
  businessName: string
  restaurantCode: string
  restaurantName: string
  /** 유치원 청구액 (단가) */
  price: TaxBreakdown
  /** 정산 제외 사업장이면 계산서를 발행하지 않는다 */
  isExcluded: boolean
  /**
   * 계산서 총액을 10원 단위로 절사한다 (docs §6-2).
   *
   * ⚠️ **절사는 식당별이 아니라 계산서 한 장 단위다.** 여러 식당이 한 장으로
   * 합쳐지면(해밀 사례) 합친 뒤에 한 번만 깎는다 — 식당마다 깎으면 최대
   * 9원 × 식당수만큼 더 빠진다.
   */
  roundDown: boolean
  /** 계산서 정보. 필수 항목이 하나라도 없으면 null로 넘길 것 */
  buyer: InvoiceParty | null
  /** 과세구분별 품목명. 미지정이면 null */
  itemNames: { taxable: string | null; exempt: string | null }
}

/** 계산서 한 장 */
export interface InvoiceRow {
  taxKind: InvoiceTaxKind
  buyer: InvoiceParty
  itemName: string
  supply: number
  vat: number
  /** 몇 개 식당이 합쳐졌는지. 1이면 단독 (해밀 사례는 2) */
  mergedFrom: number
  /**
   * 원단위 절사로 깎인 금액 (docs §6-2). 절사 대상이 아니면 0.
   *
   * 정산(영업자 지급)은 원값을 쓰므로 이 금액은 **본사 몫에서 흡수된다.**
   */
  roundingDiff: number
}

/** 사업자 정보가 없어 계산서를 만들 수 없는 사업장 */
export interface PendingBuyer {
  source: SettlementSource
  businessCode: string
  /** 원천 사업장명 — 사람이 어느 유치원인지 알아보는 단서 */
  businessName: string
  /** 이 사업장에 걸린 식당 수 */
  restaurantCount: number
  /** 청구액 합계 — 고치지 않으면 이만큼이 계산서에서 빠진다 */
  priceTotal: number
}

/** 품목명이 지정되지 않은 식당 × 과세구분 */
export interface PendingItemName {
  source: SettlementSource
  businessCode: string
  businessName: string
  restaurantCode: string
  restaurantName: string
  taxKind: InvoiceTaxKind
  /** 이 과세구분의 청구액 */
  amount: number
}

export interface CollectInvoiceResult {
  rows: InvoiceRow[]
  /**
   * 원단위 절사로 깎인 금액의 총합 (docs §6-2).
   * 정산은 원값이므로 이만큼이 본사 몫에서 빠진다.
   */
  roundingTotal: number
  /**
   * 계산서를 만들 수 없는 항목. 마감 차단 사유다 (docs §14-2).
   *
   * **정산 제외와 금액 0은 문제가 아니다** — 매달 나오는 정상 상태이고,
   * 경고를 내면 담당자가 전부 무시하게 된다.
   */
  problems: string[]
  /**
   * 위와 같은 내용을 **화면에서 그 자리에서 고칠 수 있게** 구조화한 것 (docs §14-3).
   * 문자열 경고만 주면 담당자가 별도 화면을 찾아 헤매야 한다.
   */
  pending: {
    buyers: PendingBuyer[]
    itemNames: PendingItemName[]
  }
}

const KIND_LABEL: Record<InvoiceTaxKind, string> = {
  taxable: '과세',
  exempt: '면세',
}

/**
 * 식당 줄들을 계산서 단위로 묶는다.
 *
 * 묶는 키는 **사업자번호 + 품목명**이다. 상호로 묶으면 안 된다 —
 * 26년 6월에 `복자유치원`이라는 상호가 3곳 있다 (docs §6-1).
 */
export function collectInvoiceRows(
  lines: readonly InvoiceVenueLine[],
  /** 차액을 어디서 뺄지. 기본 `vat` — 세무사 협의로 바뀔 수 있다 (docs §6-2) */
  roundingMode: InvoiceRoundingMode = 'vat'
): CollectInvoiceResult {
  const groups = new Map<string, InvoiceRow>()
  const problems: string[] = []
  const kinds: InvoiceTaxKind[] = ['taxable', 'exempt']
  // 사업장 단위로 모은다 — 식당이 3개여도 고칠 대상은 사업장 1개다
  const pendingBuyers = new Map<string, PendingBuyer>()
  const pendingItemNames: PendingItemName[] = []
  // 절사 대상 계산서. **합치기가 끝난 뒤에** 한 번만 깎아야 하므로 키를 모아 둔다.
  const roundDownKeys = new Set<string>()

  for (const line of lines) {
    // 의도적 제외는 조용히 건너뛴다 (본사 = 마케팅비)
    if (line.isExcluded) continue

    const amounts: Record<InvoiceTaxKind, { supply: number; vat: number }> = {
      taxable: { supply: line.price.taxableSupply, vat: line.price.vat },
      exempt: { supply: line.price.exempt, vat: 0 },
    }

    const hasAnyAmount = kinds.some((k) => amounts[k].supply !== 0)
    if (!hasAnyAmount) continue

    const where = `${line.source}:${line.businessCode} ${line.restaurantName}`

    if (!line.buyer) {
      problems.push(`${where} — 유치원 사업자 정보가 없어 계산서를 만들 수 없습니다.`)
      // 사업자 정보부터 채워야 계산서가 나온다. 품목명까지 같이 띄우면 소음이므로
      // 여기서 끊는다 — 한 번에 하나씩 고치게 한다.
      const bkey = `${line.source}:${line.businessCode}`
      const prev = pendingBuyers.get(bkey)
      if (prev) {
        prev.restaurantCount += 1
        prev.priceTotal += line.price.total
      } else {
        pendingBuyers.set(bkey, {
          source: line.source,
          businessCode: line.businessCode,
          businessName: line.businessName,
          restaurantCount: 1,
          priceTotal: line.price.total,
        })
      }
      continue
    }

    for (const kind of kinds) {
      const { supply, vat } = amounts[kind]
      if (supply === 0) continue

      const itemName = line.itemNames[kind]
      if (!itemName) {
        problems.push(
          `${where} — ${KIND_LABEL[kind]} 품목명이 지정되지 않았습니다 ` +
            `(${supply.toLocaleString()}원).`
        )
        pendingItemNames.push({
          source: line.source,
          businessCode: line.businessCode,
          businessName: line.businessName,
          restaurantCode: line.restaurantCode,
          restaurantName: line.restaurantName,
          taxKind: kind,
          amount: supply,
        })
        continue
      }

      const key = `${kind} ${line.buyer.bizRegNo} ${itemName}`
      const existing = groups.get(key)
      if (existing) {
        existing.supply += supply
        existing.vat += vat
        existing.mergedFrom += 1
      } else {
        groups.set(key, {
          taxKind: kind,
          buyer: line.buyer,
          itemName,
          supply,
          vat,
          mergedFrom: 1,
          roundingDiff: 0,
        })
        if (line.roundDown) roundDownKeys.add(key)
      }
    }
  }

  // ── 원단위 절사 (docs §6-2) ──
  // 합치기가 끝난 **계산서 한 장**을 대상으로 한다. 위 루프 안에서 깎으면
  // 식당마다 최대 9원씩 빠져 유치원이 요청한 금액과 달라진다.
  let roundingTotal = 0
  for (const [key, row] of groups) {
    if (!roundDownKeys.has(key)) continue
    const r = applyInvoiceRounding(row, roundingMode, true)
    row.supply = r.supply
    row.vat = r.vat
    row.roundingDiff = r.diff
    roundingTotal += r.diff
  }

  return {
    rows: [...groups.values()],
    roundingTotal,
    problems,
    pending: { buyers: [...pendingBuyers.values()], itemNames: pendingItemNames },
  }
}

export type InvoiceCell = string | number | null

export interface InvoiceSheet {
  rows: InvoiceCell[][]
  /** 계산서 장수 (헤더 제외) */
  count: number
  supplyTotal: number
  vatTotal: number
}

export interface InvoiceSheets {
  taxable: InvoiceSheet
  exempt: InvoiceSheet
}

export interface BuildInvoiceInput {
  /** 작성일자 `YYYYMMDD` — 월말일 */
  issueDate: string
  /** 일자1 — 2자리, 작성년월 제외 */
  day: string
  issuer: InvoiceParty
  rows: readonly InvoiceRow[]
}

/** 월말일 기준 작성일자. 홈택스는 8자리 문자열을 받고 일자1은 2자리다. */
export function monthEndIssueDate(
  year: number,
  month: number
): { issueDate: string; day: string } {
  // 다음 달 0일 = 이번 달 말일. 윤년도 자동으로 맞는다.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  const dd = String(last).padStart(2, '0')
  return { issueDate: `${year}${mm}${dd}`, day: dd }
}

export function buildInvoiceSheets(input: BuildInvoiceInput): InvoiceSheets {
  return {
    taxable: buildOne('taxable', input),
    exempt: buildOne('exempt', input),
  }
}

function buildOne(kind: InvoiceTaxKind, input: BuildInvoiceInput): InvoiceSheet {
  const C = INVOICE_COL[kind]
  const rows: InvoiceCell[][] = []

  // 1~5행 비움 — 원본과 같은 레이아웃이라야 담당자가 나란히 대조할 수 있다
  for (let i = 0; i < HEADER_ROW; i++) {
    rows.push(new Array<InvoiceCell>(C.width).fill(null))
  }
  rows.push([...HEADER[kind]])

  const mine = input.rows.filter((r) => r.taxKind === kind)
  let supplyTotal = 0
  let vatTotal = 0

  for (const row of mine) {
    const cells = new Array<InvoiceCell>(C.width).fill(null)
    cells[C.kind] = KIND_CODE[kind]
    cells[C.issueDate] = input.issueDate

    cells[C.issuerBizRegNo] = input.issuer.bizRegNo
    cells[C.issuerCompanyName] = input.issuer.companyName
    cells[C.issuerCeoName] = input.issuer.ceoName
    cells[C.issuerAddress] = input.issuer.address
    cells[C.issuerBizType] = input.issuer.bizType
    cells[C.issuerBizItem] = input.issuer.bizItem
    cells[C.issuerEmail] = input.issuer.email

    cells[C.buyerBizRegNo] = row.buyer.bizRegNo
    cells[C.buyerCompanyName] = row.buyer.companyName
    cells[C.buyerCeoName] = row.buyer.ceoName
    cells[C.buyerAddress] = row.buyer.address
    cells[C.buyerBizType] = row.buyer.bizType
    cells[C.buyerBizItem] = row.buyer.bizItem
    cells[C.buyerEmail1] = row.buyer.email
    cells[C.buyerEmail2] = row.buyer.email2 ?? null

    cells[C.supplyTotal] = row.supply
    if (C.vatTotal !== null) cells[C.vatTotal] = row.vat

    // 품목1만 쓴다 — 원본도 1행 = 1품목이다 (현행 유지, docs §13-4)
    cells[C.itemDay] = input.day
    cells[C.itemName] = row.itemName
    cells[C.itemSupply] = row.supply
    if (C.itemVat !== null) cells[C.itemVat] = row.vat
    // 규격·수량·단가·품목비고는 원본도 비어 있다

    cells[C.receiptType] = RECEIPT_TYPE_BILLED

    rows.push(cells)
    supplyTotal += row.supply
    vatTotal += row.vat
  }

  return { rows, count: mine.length, supplyTotal, vatTotal }
}
