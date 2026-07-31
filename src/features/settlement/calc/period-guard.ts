/**
 * 원천 파일 기간 검증 — docs/systems/settlement/마감.md §8-4
 *
 * ★ **2026-07-31 사고 대응.** 7월 원천 파일이 `2026-06`으로 확정됐다.
 * 정산월은 화면에서 따로 고르고 원천의 날짜와 한 번도 대조하지 않아서,
 * 시스템은 아무 말도 하지 않았다. 마감 스냅샷·계산서·지급명세서가 전부
 * 엉뚱한 달의 숫자로 채워진 채 하루가 지났다.
 *
 * 합계가 맞고 매핑이 다 돼 있어도 **달이 틀리면 전부 틀린 것**이다.
 * 그래서 이 검사는 경고가 아니라 **차단**이다 (`errors`에 들어간다).
 */

/** 원천 파일이 실제로 담고 있는 기간. 날짜 열이 없는 원천은 `null`. */
export interface SourceDateRange {
  /** 가장 이른 날짜 `YYYY-MM-DD` */
  min: string
  /** 가장 늦은 날짜 `YYYY-MM-DD` */
  max: string
  /** 등장한 월 목록 (오름차순·중복 없음). 대조는 이걸로 한다. */
  months: string[]
}

export interface PeriodCheckSource {
  /** 사람이 알아볼 이름 (예: `신세계 (신세계_전체 일반)`) */
  label: string
  dateRange: SourceDateRange | null
}

export interface PeriodMismatch {
  label: string
  /** 화면에서 고른 정산월 */
  expected: string
  /** 파일에 실제로 들어 있는 월 */
  months: string[]
  min: string
  max: string
}

/**
 * 정산월과 원천 날짜를 대조한다. 어긋난 원천만 돌려준다 (빈 배열이면 정상).
 *
 * 통과시키는 두 경우를 분명히 해 둔다 — 둘 다 "검사할 수 없다"이지 "맞다"가 아니다:
 *
 * 1. **정산월이 비어 있을 때.** 파일을 먼저 올리고 월을 고르는 순서도 가능하다.
 *    아직 안 고른 값에 대고 틀렸다고 할 수는 없다.
 * 2. **날짜 열이 없는 원천.** CJ 집계표에는 날짜가 아예 없다. 여기서 막으면
 *    CJ를 영영 못 올린다. 이 구멍은 거래명세서 교차검증으로 따로 메운다.
 */
export function checkSourcePeriod(
  period: string,
  sources: readonly PeriodCheckSource[]
): PeriodMismatch[] {
  if (!/^\d{4}-\d{2}$/.test(period)) return []

  const out: PeriodMismatch[] = []
  for (const src of sources) {
    const range = src.dateRange
    if (!range || range.months.length === 0) continue
    if (range.months.every((m) => m === period)) continue

    out.push({
      label: src.label,
      expected: period,
      months: range.months,
      min: range.min,
      max: range.max,
    })
  }
  return out
}

/** 차단 문구. 무엇을 어떻게 고쳐야 하는지까지 적는다 — 사용자가 다음 행동을 알아야 한다. */
export function periodMismatchMessage(m: PeriodMismatch): string {
  const found = m.months.join(', ')
  return (
    `${m.label}: 정산월은 ${m.expected}인데 파일에는 ${found} 자료가 들어 있습니다 ` +
    `(${m.min} ~ ${m.max}). 정산월을 바꾸거나 올바른 달의 파일을 올려 주세요.`
  )
}

/**
 * 날짜 목록 → 기간. 날짜가 하나도 없으면 `null`.
 *
 * 파서가 행을 훑으며 모은 날짜를 그대로 넘기면 된다.
 */
export function toDateRange(dates: readonly string[]): SourceDateRange | null {
  if (dates.length === 0) return null
  let min = dates[0]
  let max = dates[0]
  const months = new Set<string>()
  for (const d of dates) {
    if (d < min) min = d
    if (d > max) max = d
    months.add(d.slice(0, 7))
  }
  return { min, max, months: [...months].sort() }
}
