/**
 * 시트 셀 읽기 헬퍼.
 *
 * ⚠️ SheetJS `sheet_to_json(sheet, { header: 1 })`은 각 행의 **trailing 빈 셀을
 * 배열에서 제거**한다. 따라서 행 길이가 헤더보다 짧을 수 있고, 인덱스 접근이
 * `undefined`를 반환할 수 있다. 아래 헬퍼는 그 경우를 0/빈문자로 흡수한다.
 * (기존 `src/lib/excel-parser.ts`에도 같은 취지의 주석이 있다)
 */

/** 금액 셀 → 숫자. 빈 셀·문자열·쉼표 포함 문자열을 모두 흡수한다. */
export function numCell(row: readonly unknown[], index: number): number {
  const raw = row[index]
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[,\s₩]/g, '')
    if (cleaned === '') return 0
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 코드/이름 셀 → 문자열. 숫자 코드도 문자열로 통일한다(엑셀이 1008을 숫자로 준다). */
export function textCell(row: readonly unknown[], index: number): string {
  const raw = row[index]
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}
