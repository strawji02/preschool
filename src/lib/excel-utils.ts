import * as XLSX from 'xlsx'
import type { ComparisonItem } from '@/types/audit'

/**
 * 엑셀 행 데이터 타입
 */
interface ExcelRow {
  No: number
  품명: string
  규격: string
  수량: number
  '단가(동행)': number
  '단가(CJ)': number | string
  '단가(신세계)': number | string
  '금액(동행)': number
  '금액(CJ)': number | string
  '금액(신세계)': number | string
  'CJ-동행(차액)': number | string
  'CJ-동행(율)': string
  '신세계-동행(차액)': number | string
  '신세계-동행(율)': string
  '신세계-CJ(차액)': number | string
  '신세계-CJ(율)': string
}

/**
 * 합계 행 데이터 타입
 */
interface SummaryRow {
  No: string
  품명: string
  규격: string
  수량: string
  '단가(동행)': string
  '단가(CJ)': string
  '단가(신세계)': string
  '금액(동행)': number
  '금액(CJ)': number
  '금액(신세계)': number
  'CJ-동행(차액)': number
  'CJ-동행(율)': string
  '신세계-동행(차액)': number
  '신세계-동행(율)': string
  '신세계-CJ(차액)': number
  '신세계-CJ(율)': string
}

/**
 * ComparisonItem을 엑셀 행으로 변환
 */
function itemToExcelRow(item: ComparisonItem, index: number): ExcelRow | null {
  // 미매칭 품목 제외 (CJ와 신세계 둘 다 없는 경우)
  if (!item.cj_match && !item.ssg_match) {
    return null
  }

  const ourPrice = item.extracted_unit_price
  const quantity = item.extracted_quantity
  const ourAmount = ourPrice * quantity

  // CJ 데이터
  const cjPrice = item.cj_match?.standard_price ?? 0
  const cjAmount = item.cj_match ? cjPrice * quantity : 0
  const cjDiff = item.cj_match ? cjAmount - ourAmount : 0
  const cjRate = item.cj_match && ourAmount !== 0
    ? `${((cjDiff / ourAmount) * 100).toFixed(1)}%`
    : '-'

  // 신세계 데이터
  const ssgPrice = item.ssg_match?.standard_price ?? 0
  const ssgAmount = item.ssg_match ? ssgPrice * quantity : 0
  const ssgDiff = item.ssg_match ? ssgAmount - ourAmount : 0
  const ssgRate = item.ssg_match && ourAmount !== 0
    ? `${((ssgDiff / ourAmount) * 100).toFixed(1)}%`
    : '-'

  // 신세계-CJ 비교
  const ssgCjDiff = item.cj_match && item.ssg_match ? ssgAmount - cjAmount : 0
  const ssgCjRate = item.cj_match && item.ssg_match && cjAmount !== 0
    ? `${((ssgCjDiff / cjAmount) * 100).toFixed(1)}%`
    : '-'

  return {
    No: index + 1,
    품명: item.extracted_name,
    규격: item.extracted_spec || '-',
    수량: quantity,
    '단가(동행)': ourPrice,
    '단가(CJ)': item.cj_match ? cjPrice : '-',
    '단가(신세계)': item.ssg_match ? ssgPrice : '-',
    '금액(동행)': ourAmount,
    '금액(CJ)': item.cj_match ? cjAmount : '-',
    '금액(신세계)': item.ssg_match ? ssgAmount : '-',
    'CJ-동행(차액)': item.cj_match ? cjDiff : '-',
    'CJ-동행(율)': cjRate,
    '신세계-동행(차액)': item.ssg_match ? ssgDiff : '-',
    '신세계-동행(율)': ssgRate,
    '신세계-CJ(차액)': item.cj_match && item.ssg_match ? ssgCjDiff : '-',
    '신세계-CJ(율)': ssgCjRate,
  }
}

/**
 * 합계 행 생성
 */
function createSummaryRow(rows: ExcelRow[]): SummaryRow {
  const totalOurAmount = rows.reduce((sum, row) => sum + row['금액(동행)'], 0)

  const totalCjAmount = rows.reduce((sum, row) => {
    const amount = row['금액(CJ)']
    return sum + (typeof amount === 'number' ? amount : 0)
  }, 0)

  const totalSsgAmount = rows.reduce((sum, row) => {
    const amount = row['금액(신세계)']
    return sum + (typeof amount === 'number' ? amount : 0)
  }, 0)

  const totalCjDiff = rows.reduce((sum, row) => {
    const diff = row['CJ-동행(차액)']
    return sum + (typeof diff === 'number' ? diff : 0)
  }, 0)

  const totalSsgDiff = rows.reduce((sum, row) => {
    const diff = row['신세계-동행(차액)']
    return sum + (typeof diff === 'number' ? diff : 0)
  }, 0)

  const totalSsgCjDiff = rows.reduce((sum, row) => {
    const diff = row['신세계-CJ(차액)']
    return sum + (typeof diff === 'number' ? diff : 0)
  }, 0)

  const totalCjRate = totalOurAmount !== 0
    ? `${((totalCjDiff / totalOurAmount) * 100).toFixed(1)}%`
    : '-'

  const totalSsgRate = totalOurAmount !== 0
    ? `${((totalSsgDiff / totalOurAmount) * 100).toFixed(1)}%`
    : '-'

  const totalSsgCjRate = totalCjAmount !== 0
    ? `${((totalSsgCjDiff / totalCjAmount) * 100).toFixed(1)}%`
    : '-'

  return {
    No: '합계',
    품명: '',
    규격: '',
    수량: '',
    '단가(동행)': '',
    '단가(CJ)': '',
    '단가(신세계)': '',
    '금액(동행)': totalOurAmount,
    '금액(CJ)': totalCjAmount,
    '금액(신세계)': totalSsgAmount,
    'CJ-동행(차액)': totalCjDiff,
    'CJ-동행(율)': totalCjRate,
    '신세계-동행(차액)': totalSsgDiff,
    '신세계-동행(율)': totalSsgRate,
    '신세계-CJ(차액)': totalSsgCjDiff,
    '신세계-CJ(율)': totalSsgCjRate,
  }
}

/**
 * 셀 색상 적용 (차액 컬럼에만)
 */
function applyCellColors(
  worksheet: XLSX.WorkSheet,
  dataRows: ExcelRow[],
  startRow: number
) {
  const diffColumns = [
    { col: 'K', key: 'CJ-동행(차액)' },
    { col: 'M', key: '신세계-동행(차액)' },
    { col: 'O', key: '신세계-CJ(차액)' },
  ] as const

  dataRows.forEach((row, rowIndex) => {
    const excelRow = startRow + rowIndex

    diffColumns.forEach(({ col, key }) => {
      const cellRef = `${col}${excelRow}`
      const value = row[key]

      if (typeof value === 'number' && value !== 0) {
        if (!worksheet[cellRef]) worksheet[cellRef] = { t: 'n', v: value }

        // 음수(절감) = 녹색, 양수(증가) = 빨간색
        const fillColor = value < 0 ? 'C6EFCE' : 'FFC7CE' // 녹색 : 빨간색
        const fontColor = value < 0 ? '006100' : '9C0006' // 진한 녹색 : 진한 빨강

        worksheet[cellRef].s = {
          fill: { fgColor: { rgb: fillColor } },
          font: { color: { rgb: fontColor }, bold: true },
          alignment: { horizontal: 'right' },
        }
      }
    })
  })

  // 합계 행 색상 적용
  const summaryRow = startRow + dataRows.length
  diffColumns.forEach(({ col }) => {
    const cellRef = `${col}${summaryRow}`
    if (worksheet[cellRef]) {
      const value = worksheet[cellRef].v as number
      if (typeof value === 'number' && value !== 0) {
        const fillColor = value < 0 ? 'C6EFCE' : 'FFC7CE'
        const fontColor = value < 0 ? '006100' : '9C0006'

        worksheet[cellRef].s = {
          fill: { fgColor: { rgb: fillColor } },
          font: { color: { rgb: fontColor }, bold: true },
          alignment: { horizontal: 'right' },
        }
      }
    }
  })
}

/**
 * 보고서 엑셀 생성 및 다운로드
 */
export function downloadReportAsExcel(items: ComparisonItem[], fileName: string = '가격비교_보고서') {
  // 1. 데이터 변환 (미매칭 제외)
  const excelRows: ExcelRow[] = items
    .map((item, index) => itemToExcelRow(item, index))
    .filter((row): row is ExcelRow => row !== null)

  if (excelRows.length === 0) {
    alert('다운로드할 데이터가 없습니다. (모든 품목이 미매칭 상태입니다)')
    return
  }

  // 2. 합계 행 생성
  const summaryRow = createSummaryRow(excelRows)

  // 3. 워크시트 생성
  const allData = [...excelRows, summaryRow]
  const worksheet = XLSX.utils.json_to_sheet(allData)

  // 4. 색상 적용 (헤더는 row 1, 데이터는 row 2부터)
  applyCellColors(worksheet, excelRows, 2)

  // 5. 합계 행 스타일 (굵게)
  const summaryRowNum = excelRows.length + 2
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']
  cols.forEach(col => {
    const cellRef = `${col}${summaryRowNum}`
    if (worksheet[cellRef]) {
      worksheet[cellRef].s = {
        ...worksheet[cellRef].s,
        font: { ...worksheet[cellRef].s?.font, bold: true },
        fill: { fgColor: { rgb: 'F2F2F2' } }, // 회색 배경
      }
    }
  })

  // 6. 컬럼 너비 설정
  worksheet['!cols'] = [
    { wch: 5 },  // No
    { wch: 30 }, // 품명
    { wch: 15 }, // 규격
    { wch: 8 },  // 수량
    { wch: 12 }, // 단가(동행)
    { wch: 12 }, // 단가(CJ)
    { wch: 12 }, // 단가(신세계)
    { wch: 12 }, // 금액(동행)
    { wch: 12 }, // 금액(CJ)
    { wch: 12 }, // 금액(신세계)
    { wch: 12 }, // CJ-동행(차액)
    { wch: 10 }, // CJ-동행(율)
    { wch: 12 }, // 신세계-동행(차액)
    { wch: 12 }, // 신세계-동행(율)
    { wch: 12 }, // 신세계-CJ(차액)
    { wch: 10 }, // 신세계-CJ(율)
  ]

  // 7. 워크북 생성
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '가격비교')

  // 8. 파일 다운로드
  const timestamp = new Date().toISOString().split('T')[0]
  const fullFileName = `${fileName}_${timestamp}.xlsx`
  XLSX.writeFile(workbook, fullFileName)
}
