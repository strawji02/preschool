/**
 * 깔때기(Funnel) 알고리즘 2단계: 거래명세표 엑셀 파일 리딩
 *
 * xlsx/xls 파일을 파싱하여 거래명세표 데이터를 추출하고 표준 형식으로 변환합니다.
 */

import * as XLSX from 'xlsx'

/**
 * 거래명세표 항목
 */
export interface InvoiceItem {
  /** 행 번호 (1부터 시작) */
  rowNumber: number
  /** 품명 */
  itemName: string
  /** 규격 */
  spec: string
  /** 수량 */
  quantity: number
  /** 단가 */
  unitPrice: number
  /** 금액 */
  amount: number
  /** 과세 구분 */
  taxType?: '과세' | '면세'
}

/**
 * 컬럼 매핑 정보
 */
export interface ColumnMapping {
  /** 품명 컬럼 인덱스 */
  itemName: number | null
  /** 규격 컬럼 인덱스 */
  spec: number | null
  /** 수량 컬럼 인덱스 */
  quantity: number | null
  /** 단가 컬럼 인덱스 */
  unitPrice: number | null
  /** 금액 컬럼 인덱스 */
  amount: number | null
  /** 과세 구분 컬럼 인덱스 */
  taxType: number | null
}

/**
 * 파싱 결과
 */
export interface ParseResult {
  /** 성공 여부 */
  success: boolean
  /** 파싱된 데이터 */
  data: InvoiceItem[]
  /** 컬럼 매핑 정보 */
  mapping: ColumnMapping
  /** 에러 메시지 */
  error?: string
  /** 원본 헤더 */
  headers?: string[]
}

/**
 * 컬럼명 패턴 (정규식)
 */
const COLUMN_PATTERNS = {
  itemName: /품명|상품명|제품명|품목|아이템|item\s*name|product\s*name|item|product/i,
  spec: /규격|사양|specification|spec(?!.*price)/i, // price가 뒤에 오지 않는 spec만
  quantity: /수량|qty|quantity|개수|갯수/i,
  unitPrice: /단가|unit\s*price|price\s*unit|가격|price/i,
  amount: /금액|합계|소계|total\s*amount|amount|total|sum/i,
  taxType: /과세|면세|구분|세금|tax\s*type|tax/i,
}

/**
 * 엑셀 파일에서 헤더 행을 찾습니다
 *
 * @param sheet 워크시트
 * @returns 헤더 행 인덱스 (0부터 시작)
 */
function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')

  // 처음 10행 이내에서 헤더 찾기
  for (let row = range.s.r; row <= Math.min(range.e.r, 10); row++) {
    let matchCount = 0

    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = sheet[cellAddress]

      if (!cell || !cell.v) continue

      const value = String(cell.v).trim()

      // 주요 컬럼명 패턴 매칭
      if (
        COLUMN_PATTERNS.itemName.test(value) ||
        COLUMN_PATTERNS.spec.test(value) ||
        COLUMN_PATTERNS.quantity.test(value) ||
        COLUMN_PATTERNS.unitPrice.test(value) ||
        COLUMN_PATTERNS.amount.test(value)
      ) {
        matchCount++
      }
    }

    // 3개 이상의 주요 컬럼이 발견되면 헤더로 간주
    if (matchCount >= 3) {
      return row
    }
  }

  // 기본값: 첫 번째 행
  return 0
}

/**
 * 헤더에서 컬럼 매핑 자동 감지
 *
 * @param headers 헤더 배열
 * @returns 컬럼 매핑 정보
 *
 * @example
 * detectColumns(['품명', '규격', '수량', '단가', '금액'])
 * // { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    itemName: null,
    spec: null,
    quantity: null,
    unitPrice: null,
    amount: null,
    taxType: null,
  }

  headers.forEach((header, index) => {
    const normalized = header.trim()

    // 우선순위: unitPrice > amount > spec (Unit Price가 spec보다 먼저 체크되도록)
    if (COLUMN_PATTERNS.itemName.test(normalized)) {
      mapping.itemName = index
    } else if (COLUMN_PATTERNS.unitPrice.test(normalized) && mapping.unitPrice === null) {
      // 단가를 먼저 체크 (Unit Price가 spec으로 잘못 매칭되는 것 방지)
      mapping.unitPrice = index
    } else if (COLUMN_PATTERNS.amount.test(normalized)) {
      mapping.amount = index
    } else if (COLUMN_PATTERNS.quantity.test(normalized)) {
      mapping.quantity = index
    } else if (COLUMN_PATTERNS.spec.test(normalized)) {
      mapping.spec = index
    } else if (COLUMN_PATTERNS.taxType.test(normalized)) {
      mapping.taxType = index
    }
  })

  return mapping
}

/**
 * 셀 값을 숫자로 변환
 *
 * @param value 셀 값
 * @returns 숫자 또는 0
 */
function toNumber(value: any): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    // 쉼표 제거 후 파싱
    const cleaned = value.replace(/,/g, '').trim()
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/**
 * 원본 데이터를 InvoiceItem 배열로 변환
 *
 * @param rawData 원본 데이터 배열
 * @param mapping 컬럼 매핑 정보
 * @returns 정규화된 InvoiceItem 배열
 *
 * @example
 * normalizeInvoiceData(
 *   [['양파', '1kg', 10, 5000, 50000]],
 *   { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
 * )
 */
export function normalizeInvoiceData(
  rawData: any[][],
  mapping: ColumnMapping
): InvoiceItem[] {
  const items: InvoiceItem[] = []

  rawData.forEach((row, index) => {
    // 빈 행 스킵
    if (!row || row.length === 0 || row.every(cell => !cell)) {
      return
    }

    // 필수 컬럼 값 추출
    const itemName =
      mapping.itemName !== null ? String(row[mapping.itemName] || '').trim() : ''
    const spec = mapping.spec !== null ? String(row[mapping.spec] || '').trim() : ''
    const quantity = mapping.quantity !== null ? toNumber(row[mapping.quantity]) : 0
    const unitPrice = mapping.unitPrice !== null ? toNumber(row[mapping.unitPrice]) : 0
    const amount = mapping.amount !== null ? toNumber(row[mapping.amount]) : 0

    // 품명이 비어있으면 스킵
    if (!itemName) {
      return
    }

    // 과세 구분 (선택적)
    let taxType: '과세' | '면세' | undefined
    if (mapping.taxType !== null) {
      const taxValue = String(row[mapping.taxType] || '').trim()
      if (taxValue.includes('면세')) {
        taxType = '면세'
      } else if (taxValue.includes('과세')) {
        taxType = '과세'
      }
    }

    items.push({
      rowNumber: index + 1,
      itemName,
      spec,
      quantity,
      unitPrice,
      amount,
      taxType,
    })
  })

  return items
}

/**
 * 엑셀 파일 파싱
 *
 * @param file 엑셀 파일 (File 객체)
 * @returns 파싱 결과 Promise
 *
 * @example
 * const file = new File([...], 'invoice.xlsx')
 * const result = await parseExcelFile(file)
 * if (result.success) {
 *   console.log(result.data) // InvoiceItem[]
 * }
 */
export async function parseExcelFile(file: File): Promise<ParseResult> {
  try {
    // 파일을 ArrayBuffer로 읽기
    const arrayBuffer = await file.arrayBuffer()

    // 워크북 읽기
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
    })

    // 첫 번째 시트 가져오기
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]

    if (!sheet || !sheet['!ref']) {
      return {
        success: false,
        data: [],
        mapping: {
          itemName: null,
          spec: null,
          quantity: null,
          unitPrice: null,
          amount: null,
          taxType: null,
        },
        error: '시트가 비어있습니다',
      }
    }

    // 헤더 행 찾기
    const headerRowIndex = findHeaderRow(sheet)

    // 시트를 배열로 변환 (헤더 포함)
    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    })

    if (rawData.length === 0) {
      return {
        success: false,
        data: [],
        mapping: {
          itemName: null,
          spec: null,
          quantity: null,
          unitPrice: null,
          amount: null,
          taxType: null,
        },
        error: '데이터가 비어있습니다',
      }
    }

    // 헤더 추출
    const headers = rawData[headerRowIndex].map(h => String(h || '').trim())

    // 컬럼 매핑 자동 감지
    const mapping = detectColumns(headers)

    // 필수 컬럼 검증
    if (mapping.itemName === null) {
      return {
        success: false,
        data: [],
        mapping,
        error: '품명 컬럼을 찾을 수 없습니다',
        headers,
      }
    }

    // 데이터 행 추출 (헤더 다음 행부터)
    const dataRows = rawData.slice(headerRowIndex + 1)

    // 정규화
    const items = normalizeInvoiceData(dataRows, mapping)

    if (items.length === 0) {
      return {
        success: false,
        data: [],
        mapping,
        error: '유효한 데이터가 없습니다',
        headers,
      }
    }

    return {
      success: true,
      data: items,
      mapping,
      headers,
    }
  } catch (error) {
    return {
      success: false,
      data: [],
      mapping: {
        itemName: null,
        spec: null,
        quantity: null,
        unitPrice: null,
        amount: null,
        taxType: null,
      },
      error: error instanceof Error ? error.message : '파일 파싱 중 오류가 발생했습니다',
    }
  }
}
