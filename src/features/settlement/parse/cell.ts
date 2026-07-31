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

/** 엑셀 기준일. 1900년 윤년 버그 때문에 1900-01-01이 아니라 1899-12-30이다. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

/**
 * 날짜 셀 → `YYYY-MM-DD`. 읽을 수 없으면 **null**.
 *
 * 세 가지 형태를 다 받는다 — 같은 열이 파일마다 다르게 온다:
 * - **숫자**: SheetJS가 `cellDates` 없이 읽으면 엑셀 시리얼을 준다 (46174 = 2026-06-01)
 * - **문자열**: 담당자가 손으로 고친 파일
 * - **Date**: `cellDates: true`로 읽는 경로가 생길 경우 대비
 *
 * ⚠️ **0을 날짜로 보지 않는다.** 빈 셀이 0으로 오는 일이 흔한데 그대로 환산하면
 * 1899-12-30이 되어 "1899년 자료"라는 엉뚱한 차단이 걸린다.
 */
export function dateCell(row: readonly unknown[], index: number): string | null {
  const raw = row[index]
  if (raw === null || raw === undefined) return null

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : format(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    const d = new Date(EXCEL_EPOCH_UTC + Math.floor(raw) * MS_PER_DAY)
    return format(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }

  if (typeof raw === 'string') {
    // `2026-06-01` `2026/6/1` `2026.6.1` 모두 받는다. 시각이 붙어 있으면 버린다.
    const m = raw.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
    if (!m) return null
    const [, y, mo, d] = m
    const year = Number(y)
    const month = Number(mo)
    const day = Number(d)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return format(year, month, day)
  }

  return null
}

function format(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
