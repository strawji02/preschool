import { describe, it, expect } from 'vitest'
import { toArchiveKind } from '@/features/settlement/service/pick-sheets'

/**
 * [정산] 시트 판별 결과 → 보관 종류 (docs §20)
 *
 * ★ **판별기는 카멜, DB는 스네이크다.** `detectSheetKind`는 `cjStatement`를
 * 돌려주는데 `settlement_source_files.kind`의 CHECK 제약은 `cj_statement`만
 * 받는다. 라우트에서 `as SourceKind`로 캐스트해 **타입 검사를 침묵시킨 탓에**
 * 7월 원천(거래명세서 포함)이 통째로 저장되지 않았다 (2026-08-02).
 *
 * 6월은 거래명세서가 없어 안 걸렸다. 캐스트가 없었으면 컴파일에서 잡혔다.
 */
describe('toArchiveKind — 판별 결과를 DB 값으로', () => {
  it('cjStatement는 cj_statement로 바꾼다', () => {
    expect(toArchiveKind('cjStatement')).toBe('cj_statement')
  })

  it('나머지는 그대로 쓴다', () => {
    expect(toArchiveKind('shinsegae')).toBe('shinsegae')
    expect(toArchiveKind('cj')).toBe('cj')
  })
})
