/**
 * 엑셀 파싱 유틸리티
 */
import * as XLSX from 'xlsx'

export interface CJProductRow {
  상품코드: string
  상품명: string
  판매단가: number
  단위: string
  상세분류?: string
  원산지?: string
  '과/면세'?: string
  온도조건?: string
  마감일?: string
  마감시간?: string
}

export interface ShinsegaeProductRow {
  코드: string
  품목명: string
  결정단가: number
  단위: string
  규격?: string
  카테고리?: string
  품목군?: string
  원산지?: string
  과면세?: string
}

/**
 * CJ 엑셀 파일 파싱
 */
export function parseCJExcel(filePath: string): CJProductRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<CJProductRow>(sheet)

  return rows.filter(row => row.상품코드 && row.상품명)
}

/**
 * 신세계 엑셀 파일 파싱
 */
export function parseShinsegaeExcel(filePath: string): ShinsegaeProductRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<ShinsegaeProductRow>(sheet)

  return rows.filter(row => row.코드 && row.품목명)
}

/**
 * 엑셀 시트 목록 조회
 */
export function getSheetNames(filePath: string): string[] {
  const workbook = XLSX.readFile(filePath)
  return workbook.SheetNames
}

/**
 * 엑셀 헤더 조회 (컬럼명 확인용)
 */
export function getHeaders(filePath: string, sheetIndex = 0): string[] {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[sheetIndex]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 })

  if (rows.length > 0) {
    return Object.values(rows[0] as Record<string, string>).filter(Boolean)
  }
  return []
}
