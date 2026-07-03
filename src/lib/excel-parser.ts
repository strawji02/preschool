import * as XLSX from 'xlsx'
import { parseOrderUnit } from './spec-parser'

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
  /** 발주 단위 타입 (KG/EA/PK/BOX) — 규격/단위 파싱 결과 */
  unit_type?: string
  /** 총 발주 무게(g) = 단위당무게 × 수량. 산출 불가 시 undefined */
  total_weight_g?: number
  /** kg당 단가 = total_price / (total_weight_g/1000). 산출 불가 시 undefined */
  price_per_kg?: number
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
  quantity: [
    '수량', '갯수', '개수', 'qty', 'quantity', 'count',
    // (2026-05-11) 거래명세표 다양한 표기 추가 — 사용자 거래명세표 "주문량" 컬럼 케이스
    '주문량', '발주량', '주문수량', '발주수량', '주문', '발주',
    '출고량', '출고수량', '배송량', '납품량', '납품수량',
    // (2026-06-26) 공급사 거래내역서 표기 추가 — 풀무원 ERP "매출량", 일부 공급사 "판매량/공급량"
    '매출량', '판매량', '공급량', '판매수량', '공급수량', '매출수량',
  ],
  unit_price: [
    '단가', '개당가격', '단위가격', 'price', 'unit_price', 'unit price', '동행',
    // (2026-06-30) 아워홈 ERP "평균단가" 케이스 추가
    '평균단가', '평균 단가',
  ],
  // 세액 포함 최종 총액 (최우선)
  total_price: [
    '총액', '총계', '합계', '최종금액', 'grand_total', 'total_amount', 'total_price',
    // (2026-06-30) 아워홈 ERP "합계(VAT포함)", 과세 총액 표기 추가
    '합계(VAT포함)', '합계(vat포함)', 'VAT포함', 'vat포함', '합계 vat포함', 'VAT포함합계',
    '과세 계(VAT포함)', '과세계(VAT포함)', '과세계vat포함',
  ],
  // 세액 미포함 공급가액 (별도 파싱 → total 없으면 supply+tax로 합산)
  supply_amount: [
    '공급가액', '공급가', 'supply_amount',
    // (2026-06-30) 아워홈 ERP "계(VAT제외)", "VAT제외" 표기
    '계(VAT제외)', '계(vat제외)', 'VAT제외', 'vat제외', '순공급가',
  ],
  tax_amount: ['세액', '부가세', '부가가치세', 'tax_amount', 'vat', 'VAT'],
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

    // (2026-06-30 v2) 다중행 헤더 병합 — 조건 완화
    // 조건 변경 이유:
    //   v1은 total/supply/tax가 모두 -1일 때만 병합했으나,
    //   아워홈 ERP처럼 R1에 "공급가" (실은 단가/평균단가) 셀이 있으면
    //   supply_amount alias("공급가" 포함)에 substring 매칭되어 currSupply=6로 잡힘
    //   → missingImportant=false → 병합 안 됨
    //   → R2의 실제 "합계(VAT포함) / 계(VAT제외) / VAT" 컬럼 놓침
    // v2 조건: total 없으면 병합 (합계는 반드시 있어야 하는 필수 필드)
    if (headerRowIndex + 1 < rawData.length) {
      const nextRow = rawData[headerRowIndex + 1]
      if (nextRow) {
        const nextStrings = nextRow.map(cell => String(cell || '').trim())
        // 헤더성 키워드 존재 판단
        const HEADER_KEYWORDS = /합계|vat|공급가|면세|과세|부가세|계$|\(vat|평균단가|납품가|매입가/i
        const nextIsHeader = nextStrings.some(s => s.length > 0 && HEADER_KEYWORDS.test(s))
        // 다음 행에 숫자 데이터가 없어야 (데이터 행이면 병합하지 않음)
        const nextHasNumericData = nextStrings.some(s => {
          const trimmed = s.replace(/[,\s]/g, '')
          return /^-?\d+\.?\d*$/.test(trimmed) && trimmed.length > 0
        })
        // 조건 완화: total만 없어도 병합 (합계 표기는 반드시 필요)
        const currTotal = findColumnIndex(headers, COLUMN_ALIASES.total_price)
        const missingTotal = currTotal === -1

        if (nextIsHeader && !nextHasNumericData && missingTotal) {
          // 열별 병합: 빈 헤더 자리를 다음 행 텍스트로 채움. 둘 다 있으면 공백으로 결합.
          // (2026-07-03 fix) SheetJS의 sheet_to_json은 R1의 trailing 빈 셀을 배열에서 제거함
          //   → R1 길이=7, R2 길이=13인 경우 headers.map만 하면 [7]~[12] 놓침
          //   → max 길이로 iterate + 부족한 자리는 nextStrings 값으로 채움
          const maxLen = Math.max(headers.length, nextStrings.length)
          const merged: string[] = []
          for (let idx = 0; idx < maxLen; idx++) {
            const v = headers[idx] || ''
            const next = nextStrings[idx] || ''
            if (!v && next) merged.push(next)
            else if (v && next && v !== next) merged.push(`${v} ${next}`.trim())
            else merged.push(v)
          }
          headers = merged
          headerRowIndex = headerRowIndex + 1  // 데이터는 병합 헤더 다음 행부터
        }
      }
    }

    // 컬럼 인덱스 찾기 — 중복 매핑 방지 (2026-06-30 v2)
    //   병합 헤더 "공급가 평균단가" 같은 케이스에서 unit_price와 supply_amount가
    //   동일 인덱스에 잡힐 수 있음 → excludeIndexes로 방지
    // 순서: name/spec/qty/unit_price 먼저 → supply/tax/total (이미 잡힌 인덱스 제외)
    const nameIdx = findColumnIndex(headers, COLUMN_ALIASES.name)
    const specIdx = findColumnIndex(headers, COLUMN_ALIASES.spec)
    const originIdx = findColumnIndex(headers, COLUMN_ALIASES.origin)
    const unitIdx = findColumnIndex(headers, COLUMN_ALIASES.unit)
    const qtyIdx = findColumnIndex(headers, COLUMN_ALIASES.quantity)
    const unitPriceIdx = findColumnIndex(headers, COLUMN_ALIASES.unit_price)
    // supply_amount: unit_price 인덱스 제외 (병합 헤더 중복 매핑 방지)
    const supplyIdx = findColumnIndex(
      headers,
      COLUMN_ALIASES.supply_amount,
      [unitPriceIdx].filter(i => i !== -1),
    )
    const taxIdx = findColumnIndex(
      headers,
      COLUMN_ALIASES.tax_amount,
      [unitPriceIdx, supplyIdx].filter(i => i !== -1),
    )
    // total_price: 이미 잡힌 컬럼 모두 제외
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
      let quantity = qtyIdx !== -1 ? parseNumber(row[qtyIdx]) : 1
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

      // (2026-05-11) 수량 안전망 — quantity 컬럼 미검출(default 1) + supply/unit_price 정수비 일치 시 역산
      // 예: '주문량' 같은 미등록 헤더로 qtyIdx=-1 → default 1 → supply 28140, unit_price 9380 → ratio 3.0 → quantity=3 보정
      if (qtyIdx === -1 && unitPrice > 0 && supplyAmount > 0) {
        const ratio = supplyAmount / unitPrice
        if (Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - Math.round(ratio)) < 0.01) {
          quantity = Math.round(ratio)
        }
      }

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

      // 발주 단위 무게 환산 — 규격/단위 컬럼 (unit + spec 결합) 기준
      // 예: unit="PK" spec="개당60~68g/30ea_국내산" → "PK 개당60~68g/30ea" 로 결합
      const unitSpecStr = [unit, spec].filter(Boolean).join(' ')
      const orderUnit = parseOrderUnit(unitSpecStr)
      let totalWeightG: number | undefined
      let pricePerKg: number | undefined
      if (orderUnit.unitWeightG !== null && quantity > 0) {
        totalWeightG = orderUnit.unitWeightG * quantity
        if (totalWeightG > 0) {
          pricePerKg = Math.round(finalTotalPrice / (totalWeightG / 1000))
        }
      }

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
        unit_type: orderUnit.unitType || undefined,
        total_weight_g: totalWeightG,
        price_per_kg: pricePerKg,
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
