import * as XLSX from 'xlsx'

export interface ExtractedExcelItem {
  name: string
  spec?: string
  /** 원산지 (2026-05-11) — D열 별도 컬럼에 있는 경우 추출 */
  origin?: string
  /** 단위 (KG, PAC, EA 등) - 규격 컬럼과 별도 존재 시 파싱 */
  unit?: string
  quantity: number
  unit_price: number
  /** 공급가액 (세액 미포함) - 컬럼이 명시돼 있으면 읽고, 없으면 quantity*unit_price */
  supply_amount?: number
  /** 세액 */
  tax_amount?: number
  /** 세액을 포함한 총액 (원장 총액) */
  total_price: number
  row_index: number
}

export interface ExcelParseResult {
  success: boolean
  items: ExtractedExcelItem[]
  fileName: string
  error?: string
}

// 숫자 파싱 (문자열에서 숫자만 추출)
function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    // 콤마, 원화 기호 제거
    const cleaned = value.replace(/[,원₩\s]/g, '')
    const num = parseFloat(cleaned)
    return isNaN(num) ? 0 : num
  }
  return 0
}

// 컬럼 이름 매핑 (다양한 형식 지원)
// 주의: 세액 포함 "총액" vs 세액 미포함 "공급가액"을 구분하기 위해 별도 키로 분리
const COLUMN_ALIASES: Record<string, string[]> = {
  no: ['no', 'NO', '번호', '순번', '#'],
  name: ['품명', '품목명', '상품명', '제품명', '품목', '상품', '제품', 'name', 'item', 'product'],
  // 규격: "규격" 전용 (별도 "단위" 컬럼이 있는 명세서를 위해 '단위' 제거)
  spec: ['규격', '용량', '사양', 'spec', 'size'],
  // 원산지 (2026-05-11) — 별도 D열 컬럼 케이스 (식자재 매칭 핵심 식별 요소)
  origin: ['원산지', '산지', '제조국', '생산지', 'origin', 'country', 'country of origin'],
  // 단위 전용 (PAC, KG, EA 등)
  unit: ['단위', 'unit', 'uom'],
  quantity: ['수량', '갯수', '개수', 'qty', 'quantity', 'count'],
  unit_price: ['단가', '개당가격', '단위가격', 'price', 'unit_price', 'unit price', '동행'],
  // 세액 포함 최종 총액 (최우선)
  total_price: ['총액', '총계', '합계', '최종금액', 'grand_total', 'total_amount', 'total_price'],
  // 세액 미포함 공급가액 (별도 파싱 → total 없으면 supply+tax로 합산)
  supply_amount: ['공급가액', '공급가', 'supply_amount'],
  tax_amount: ['세액', '부가세', '부가가치세', 'tax_amount', 'vat'],
  // 일반 "금액" (총액/공급가액 미검출 시 fallback)
  amount: ['금액', 'amount'],
}

// 컬럼 이름 찾기: exact match 우선, 그다음 substring match
// excludeIndexes: 이미 다른 컬럼으로 사용 중인 인덱스는 제외 (중복 매핑 방지)
function findColumnIndex(headers: string[], aliases: string[], excludeIndexes: number[] = []): number {
  const exclude = new Set(excludeIndexes)
  // 1차: exact match (대소문자/공백 정규화)
  for (const alias of aliases) {
    const target = alias.trim().toLowerCase()
    const index = headers.findIndex((h, i) =>
      !exclude.has(i) && h && typeof h === 'string' && h.trim().toLowerCase() === target,
    )
    if (index !== -1) return index
  }
  // 2차: substring match
  for (const alias of aliases) {
    const target = alias.toLowerCase()
    const index = headers.findIndex((h, i) =>
      !exclude.has(i) && h && typeof h === 'string' && h.toLowerCase().includes(target),
    )
    if (index !== -1) return index
  }
  return -1
}

// 거래명세서 엑셀 파싱
export async function parseInvoiceExcel(file: File): Promise<ExcelParseResult> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    
    // 첫 번째 시트 사용
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    
    // 시트를 2D 배열로 변환 (헤더 포함)
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    
    if (rawData.length < 2) {
      return {
        success: false,
        items: [],
        fileName: file.name,
        error: '데이터가 충분하지 않습니다. 헤더와 데이터 행이 필요합니다.',
      }
    }

    // 헤더 행 찾기 (처음 10행 내에서)
    let headerRowIndex = -1
    let headers: string[] = []
    
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i]
      if (!row || row.length < 3) continue
      
      const rowStrings = row.map(cell => String(cell || '').trim())
      
      // 필수 컬럼 (품명, 수량, 단가) 중 2개 이상 있으면 헤더로 인식
      const hasName = findColumnIndex(rowStrings, COLUMN_ALIASES.name) !== -1
      const hasQty = findColumnIndex(rowStrings, COLUMN_ALIASES.quantity) !== -1
      const hasPrice = findColumnIndex(rowStrings, COLUMN_ALIASES.unit_price) !== -1 ||
                       findColumnIndex(rowStrings, COLUMN_ALIASES.total_price) !== -1 ||
                       findColumnIndex(rowStrings, COLUMN_ALIASES.supply_amount) !== -1 ||
                       findColumnIndex(rowStrings, COLUMN_ALIASES.amount) !== -1
      
      if ((hasName && hasQty) || (hasName && hasPrice) || (hasQty && hasPrice)) {
        headerRowIndex = i
        headers = rowStrings
        break
      }
    }

    if (headerRowIndex === -1) {
      return {
        success: false,
        items: [],
        fileName: file.name,
        error: '헤더 행을 찾을 수 없습니다. 품명, 수량, 단가 컬럼이 필요합니다.',
      }
    }

    // 컬럼 인덱스 찾기
    // 순서: 공급가액·세액 먼저 → 총액 → 금액(fallback)
    // 이렇게 해야 "공급가액"이 "금액" alias에 잘못 잡히지 않음
    const nameIdx = findColumnIndex(headers, COLUMN_ALIASES.name)
    const specIdx = findColumnIndex(headers, COLUMN_ALIASES.spec)
    const originIdx = findColumnIndex(headers, COLUMN_ALIASES.origin)
    const unitIdx = findColumnIndex(headers, COLUMN_ALIASES.unit)
    const qtyIdx = findColumnIndex(headers, COLUMN_ALIASES.quantity)
    const unitPriceIdx = findColumnIndex(headers, COLUMN_ALIASES.unit_price)
    const supplyIdx = findColumnIndex(headers, COLUMN_ALIASES.supply_amount)
    const taxIdx = findColumnIndex(headers, COLUMN_ALIASES.tax_amount)
    // total_price: "공급가액/세액/단가"가 이미 잡힌 컬럼은 제외
    const totalPriceIdx = findColumnIndex(
      headers,
      COLUMN_ALIASES.total_price,
      [supplyIdx, taxIdx, unitPriceIdx].filter(i => i !== -1),
    )
    // fallback "금액" (총액 미검출 시 공급가액 대체용으로만 사용)
    const amountIdx = findColumnIndex(
      headers,
      COLUMN_ALIASES.amount,
      [supplyIdx, taxIdx, unitPriceIdx, totalPriceIdx].filter(i => i !== -1),
    )

    if (nameIdx === -1) {
      return {
        success: false,
        items: [],
        fileName: file.name,
        error: '품명 컬럼을 찾을 수 없습니다.',
      }
    }

    // 데이터 행 파싱
    const items: ExtractedExcelItem[] = []
    
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i]
      if (!row || row.length === 0) continue
      
      const name = String(row[nameIdx] || '').trim()
      
      // 빈 품명, 합계/소계 행 스킵
      if (!name || name === '' || 
          /^(합계|소계|총계|total|sum)$/i.test(name)) {
        continue
      }

      const spec = specIdx !== -1 ? String(row[specIdx] || '').trim() : undefined
      const origin = originIdx !== -1 ? String(row[originIdx] || '').trim() : undefined
      const unit = unitIdx !== -1 ? String(row[unitIdx] || '').trim() : undefined
      const quantity = qtyIdx !== -1 ? parseNumber(row[qtyIdx]) : 1
      const unitPrice = unitPriceIdx !== -1 ? parseNumber(row[unitPriceIdx]) : 0

      // 총액(세액 포함) 우선 추출:
      //   1) 명시적 "총액" 컬럼이 있으면 사용
      //   2) 없으면 공급가액 + 세액
      //   3) 그것도 없으면 fallback "금액" 컬럼
      //   4) 그것도 없으면 단가 × 수량
      const supplyAmount = supplyIdx !== -1 ? parseNumber(row[supplyIdx]) : 0
      const taxAmount = taxIdx !== -1 ? parseNumber(row[taxIdx]) : 0
      const explicitTotal = totalPriceIdx !== -1 ? parseNumber(row[totalPriceIdx]) : 0
      const fallbackAmount = amountIdx !== -1 ? parseNumber(row[amountIdx]) : 0

      let totalPrice = 0
      if (explicitTotal > 0) {
        totalPrice = explicitTotal
      } else if (supplyAmount > 0) {
        totalPrice = supplyAmount + taxAmount
      } else if (fallbackAmount > 0) {
        totalPrice = fallbackAmount
      }

      // 단가 또는 총액 중 하나라도 있어야 함
      if (unitPrice === 0 && totalPrice === 0) continue

      // 단가가 없으면 (공급가액/수량) 또는 (총액/수량)
      const finalUnitPrice = unitPrice || (quantity > 0
        ? Math.round((supplyAmount || totalPrice) / quantity)
        : 0)
      // 총액이 없으면 (단가×수량) + 세액
      const finalTotalPrice = totalPrice || (finalUnitPrice * quantity + taxAmount)

      // 공급가액 최종값: 명시적 컬럼 우선, 없으면 단가×수량
      const finalSupplyAmount = supplyIdx !== -1 && supplyAmount > 0
        ? supplyAmount
        : finalUnitPrice * quantity

      items.push({
        name,
        spec: spec || undefined,
        origin: origin || undefined,
        unit: unit || undefined,
        quantity,
        unit_price: finalUnitPrice,
        supply_amount: finalSupplyAmount,
        tax_amount: taxIdx !== -1 ? taxAmount : undefined,
        total_price: finalTotalPrice,
        row_index: i - headerRowIndex - 1,
      })
    }

    if (items.length === 0) {
      return {
        success: false,
        items: [],
        fileName: file.name,
        error: '추출된 품목이 없습니다. 파일 형식을 확인해주세요.',
      }
    }

    return {
      success: true,
      items,
      fileName: file.name,
    }
  } catch (error) {
    return {
      success: false,
      items: [],
      fileName: file.name,
      error: error instanceof Error ? error.message : '엑셀 파싱 중 오류가 발생했습니다.',
    }
  }
}

// 엑셀 파일 여부 확인
export function isExcelFile(file: File): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel' ||
    file.name.endsWith('.xlsx') ||
    file.name.endsWith('.xls')
  )
}
