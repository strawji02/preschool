import * as XLSX from 'xlsx'

export interface ExtractedExcelItem {
  name: string
  spec?: string
  quantity: number
  unit_price: number
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
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['품명', '품목명', '상품명', '제품명', '품목', '상품', '제품', 'name', 'item', 'product'],
  spec: ['규격', '단위', '용량', '사양', 'spec', 'unit', 'size'],
  quantity: ['수량', '갯수', '개수', 'qty', 'quantity', 'count'],
  unit_price: ['단가', '개당가격', '단위가격', 'price', 'unit_price', 'unit price'],
  total_price: ['금액', '합계', '총액', '공급가', 'total', 'amount', 'total_price'],
}

// 컬럼 이름 찾기
function findColumnIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const index = headers.findIndex(h => 
      h && typeof h === 'string' && h.toLowerCase().includes(alias.toLowerCase())
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
                       findColumnIndex(rowStrings, COLUMN_ALIASES.total_price) !== -1
      
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
    const nameIdx = findColumnIndex(headers, COLUMN_ALIASES.name)
    const specIdx = findColumnIndex(headers, COLUMN_ALIASES.spec)
    const qtyIdx = findColumnIndex(headers, COLUMN_ALIASES.quantity)
    const unitPriceIdx = findColumnIndex(headers, COLUMN_ALIASES.unit_price)
    const totalPriceIdx = findColumnIndex(headers, COLUMN_ALIASES.total_price)

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
      const quantity = qtyIdx !== -1 ? parseNumber(row[qtyIdx]) : 1
      const unitPrice = unitPriceIdx !== -1 ? parseNumber(row[unitPriceIdx]) : 0
      const totalPrice = totalPriceIdx !== -1 ? parseNumber(row[totalPriceIdx]) : 0

      // 단가 또는 금액 중 하나라도 있어야 함
      if (unitPrice === 0 && totalPrice === 0) continue

      // 단가가 없으면 금액/수량으로 계산
      const finalUnitPrice = unitPrice || (quantity > 0 ? Math.round(totalPrice / quantity) : 0)
      // 금액이 없으면 단가*수량으로 계산
      const finalTotalPrice = totalPrice || finalUnitPrice * quantity

      items.push({
        name,
        spec: spec || undefined,
        quantity,
        unit_price: finalUnitPrice,
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
