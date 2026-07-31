import { describe, it, expect } from 'vitest'
import { dateCell } from '@/features/settlement/parse/cell'
import { checkSourcePeriod } from '@/features/settlement/calc/period-guard'

/**
 * [정산] 원천 파일 기간 검증 (docs/systems/settlement/마감.md §8-4)
 *
 * ★ 왜 만들었나 — 2026-07-31, **7월 원천 파일이 `2026-06`으로 확정됐다.**
 * 정산월은 화면에서 따로 고르고 원천 파일의 날짜와 한 번도 대조하지 않아서,
 * 시스템은 아무 말도 하지 않았다. 6월 계산서를 다시 뽑으면 7월 숫자가 나오는
 * 상태로 하루가 지났다.
 *
 * 숫자가 다 맞아 보여도 **달이 틀리면 전부 틀린 것**이다. 그래서 경고가 아니라
 * 차단이다.
 */

describe('dateCell — 엑셀 날짜 셀 읽기', () => {
  // SheetJS는 `cellDates` 없이 읽으면 날짜를 **시리얼 숫자**로 준다.
  // 46174 = 2026-06-01 (엑셀 기준일 1899-12-30)
  it('엑셀 시리얼 숫자를 읽는다', () => {
    expect(dateCell([46174], 0)).toBe('2026-06-01')
    expect(dateCell([46203], 0)).toBe('2026-06-30')
  })

  it('문자열 날짜를 읽는다 — 담당자가 손으로 고친 파일이 온다', () => {
    expect(dateCell(['2026-06-01'], 0)).toBe('2026-06-01')
    expect(dateCell(['2026/6/1'], 0)).toBe('2026-06-01')
  })

  it('Date 객체를 읽는다', () => {
    expect(dateCell([new Date(2026, 5, 1)], 0)).toBe('2026-06-01')
  })

  it('빈 칸·해석 불가는 null — 0으로 만들지 않는다', () => {
    // 0을 1899-12-30으로 읽으면 "1899년 자료"라는 엉뚱한 차단이 걸린다
    expect(dateCell([], 0)).toBeNull()
    expect(dateCell([null], 0)).toBeNull()
    expect(dateCell([''], 0)).toBeNull()
    expect(dateCell(['소계'], 0)).toBeNull()
    expect(dateCell([0], 0)).toBeNull()
  })
})

describe('checkSourcePeriod — 원천 날짜 vs 정산월', () => {
  const june = { min: '2026-06-01', max: '2026-06-30', months: ['2026-06'] }
  const july = { min: '2026-07-01', max: '2026-07-31', months: ['2026-07'] }

  it('같은 달이면 통과', () => {
    expect(checkSourcePeriod('2026-06', [{ label: '신세계', dateRange: june }])).toEqual([])
  })

  it('★ 7월 파일을 6월로 올리면 잡는다 — 이 사고 때문에 만들었다', () => {
    const found = checkSourcePeriod('2026-06', [{ label: '신세계', dateRange: july }])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      label: '신세계',
      expected: '2026-06',
      months: ['2026-07'],
    })
  })

  it('여러 원천 중 하나만 어긋나도 잡는다', () => {
    const found = checkSourcePeriod('2026-06', [
      { label: '신세계', dateRange: june },
      { label: 'CJ', dateRange: july },
    ])
    expect(found.map((f) => f.label)).toEqual(['CJ'])
  })

  it('여러 달이 섞여 있으면 잡는다 — 하나라도 다르면 안 된다', () => {
    const mixed = { min: '2026-05-30', max: '2026-06-30', months: ['2026-05', '2026-06'] }
    const found = checkSourcePeriod('2026-06', [{ label: '신세계', dateRange: mixed }])
    expect(found).toHaveLength(1)
    expect(found[0].months).toEqual(['2026-05', '2026-06'])
  })

  it('날짜 열이 없는 원천은 통과 — CJ 집계표에는 날짜가 없다', () => {
    // 검사할 수 없는 것과 검사해서 맞는 것은 다르지만, 여기서 막으면
    // CJ 집계표를 영영 올릴 수 없다. 대신 거래명세서 교차검증이 이 구멍을 메운다.
    expect(checkSourcePeriod('2026-06', [{ label: 'CJ', dateRange: null }])).toEqual([])
  })

  it('정산월을 아직 안 골랐으면 검사하지 않는다', () => {
    // 업로드 먼저 하고 월을 고르는 순서도 가능하다. 빈 값에 대고 틀렸다고 하면 안 된다.
    expect(checkSourcePeriod('', [{ label: '신세계', dateRange: july }])).toEqual([])
  })
})
