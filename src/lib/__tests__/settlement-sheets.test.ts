import { describe, it, expect } from 'vitest'
import { detectSheetKind, pickSourceSheets } from '@/features/settlement'

/**
 * [정산] 업로드된 워크북에서 원천 시트를 찾아낸다.
 *
 * 시트명에 의존하지 않고 **헤더 내용으로 판별**한다. 담당자가 매월 신세계/CJ에서
 * 직접 내려받아 편집하는 파일이라 시트명이 바뀔 수 있고, 통합 파일 하나로 올릴 수도
 * 있고 두 파일로 나눠 올릴 수도 있다 (docs §5의 `정산 작업순서` 참고).
 *
 * 판별 근거 (2026-07-29 실측):
 * - 신세계 `신세계_전체 일반` 1행에 `면과세`·`품목코드`가 있다 (품목 단위 시트)
 * - CJ `CJ_전체 집계표` 1행에 `사업장코드`가 있다
 * - ⚠️ `신세계_전체 집계표`도 이름에 '신세계'가 들어가지만 우리가 쓸 시트가 아니다.
 *   이름 기반 판별이 위험한 이유가 이것이다.
 */

const SS_HEADER = [
  '순번', '사업장', null, '식당', null, '입고일자', '카테고리', '품목코드', '품목명',
  '규격', '단위', '면과세', '수량', '납품', null, null, null, '가맹점',
]
const SS_SUB = [null, '코드', '명', '코드', '명', null, null, null, null, null, null, null, null,
  '단가', '금액', '세액', '총액', '단가', '금액', '세액', '총금액']
const SS_DATA = [
  1, 88689, 'EDU)키즈_키즈웰에듀푸드(본사)', '01', '본사', '2026-06-24', '농산가공품',
  168427, '쌀떡볶이', '1KG', '봉', '과세', 5, 1810, 9050, 905, 9955, 2350, 11750, 1175, 12925,
]

const CJ_HEADER = [
  '번호', '사업장코드', '사업장', '식당코드', '식당명', '사업부', '팀',
  '원가/과세/공급가', '원가/과세/부가세', '원가/과세/금액', '원가/면세', '원가/합계(a)',
  '단가/과세/공급가', '단가/과세/부가세', '단가/과세/금액', '단가/면세', '단가/합계(b)', '차액(b-a)',
]
const CJ_SUBTOTAL = ['총계', null, null, null, null, null, null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
const CJ_DATA = [
  1, 1008, '키즈웰에듀푸드(선경유치원)', 1000, '키즈웰에듀푸드(선경유치원)', '기본사업부', '기본팀',
  1478110, 147811, 1625921, 2046990, 3672911, 1773040, 177304, 1950344, 2455760, 4406104, 733193,
]

/** 신세계 집계표 — 이름은 비슷하지만 우리가 쓰는 시트가 아니다 */
const SS_SUMMARY_HEADER = ['순번', '사업장', '식당', '원가', null, null, '단가']

describe('detectSheetKind', () => {
  it('면과세가 있으면 신세계 품목 시트다', () => {
    expect(detectSheetKind([SS_HEADER, SS_SUB, SS_DATA])).toBe('shinsegae')
  })

  it('사업장코드가 있으면 CJ 집계표다', () => {
    expect(detectSheetKind([CJ_HEADER, CJ_SUBTOTAL, CJ_DATA])).toBe('cj')
  })

  it('신세계 집계표는 어느 쪽도 아니다 (이름이 비슷해도 걸러진다)', () => {
    expect(detectSheetKind([SS_SUMMARY_HEADER])).toBeNull()
  })

  it('빈 시트는 null이다', () => {
    expect(detectSheetKind([])).toBeNull()
    expect(detectSheetKind([[]])).toBeNull()
  })

  it('헤더가 2행 아래에 있어도 찾는다 (앞에 제목 행이 있는 경우)', () => {
    expect(detectSheetKind([[], ['26년 6월'], SS_HEADER, SS_SUB, SS_DATA])).toBe('shinsegae')
  })

  it('공백이 섞인 헤더도 인식한다', () => {
    const spaced = [...CJ_HEADER]
    spaced[1] = ' 사업장 코드 '
    expect(detectSheetKind([spaced, CJ_DATA])).toBe('cj')
  })
})

describe('pickSourceSheets', () => {
  it('통합 파일 하나에서 두 시트를 모두 찾는다', () => {
    const r = pickSourceSheets([
      {
        fileName: '정산종합.xlsx',
        sheets: [
          { name: '정산 작업순서', rows: [['순서', '항목']] },
          { name: '신세계_전체 일반', rows: [SS_HEADER, SS_SUB, SS_DATA] },
          { name: '신세계_전체 집계표', rows: [SS_SUMMARY_HEADER] },
          { name: 'CJ_전체 집계표', rows: [CJ_HEADER, CJ_SUBTOTAL, CJ_DATA] },
        ],
      },
    ])
    expect(r.shinsegae?.sheetName).toBe('신세계_전체 일반')
    expect(r.cj?.sheetName).toBe('CJ_전체 집계표')
    expect(r.errors).toEqual([])
  })

  it('파일을 두 개로 나눠 올려도 찾는다', () => {
    const r = pickSourceSheets([
      { fileName: '신세계.xlsx', sheets: [{ name: 'Sheet1', rows: [SS_HEADER, SS_SUB, SS_DATA] }] },
      { fileName: 'cj.xlsx', sheets: [{ name: '집계', rows: [CJ_HEADER, CJ_DATA] }] },
    ])
    expect(r.shinsegae?.fileName).toBe('신세계.xlsx')
    expect(r.cj?.fileName).toBe('cj.xlsx')
    expect(r.errors).toEqual([])
  })

  it('신세계만 올리면 CJ가 없다고 알려준다', () => {
    const r = pickSourceSheets([
      { fileName: '신세계.xlsx', sheets: [{ name: 'Sheet1', rows: [SS_HEADER, SS_SUB, SS_DATA] }] },
    ])
    expect(r.shinsegae).not.toBeNull()
    expect(r.cj).toBeNull()
    expect(r.errors.join()).toContain('CJ')
  })

  it('둘 다 못 찾으면 둘 다 알려준다', () => {
    const r = pickSourceSheets([
      { fileName: '엉뚱.xlsx', sheets: [{ name: 'Sheet1', rows: [['아무것도', '아님']] }] },
    ])
    expect(r.errors).toHaveLength(2)
  })

  it('같은 종류가 여러 개면 첫 번째를 쓰고 경고한다', () => {
    const r = pickSourceSheets([
      {
        fileName: 'a.xlsx',
        sheets: [
          { name: '신세계1', rows: [SS_HEADER, SS_SUB, SS_DATA] },
          { name: '신세계2', rows: [SS_HEADER, SS_SUB, SS_DATA] },
          { name: 'CJ', rows: [CJ_HEADER, CJ_DATA] },
        ],
      },
    ])
    expect(r.shinsegae?.sheetName).toBe('신세계1')
    expect(r.warnings.join()).toContain('신세계2')
  })

  it('찾은 시트의 행을 그대로 전달한다 (파서가 바로 쓸 수 있게)', () => {
    const r = pickSourceSheets([
      { fileName: 'a.xlsx', sheets: [{ name: 'S', rows: [SS_HEADER, SS_SUB, SS_DATA] }] },
    ])
    expect(r.shinsegae?.rows).toHaveLength(3)
    expect(r.shinsegae?.rows[2]).toBe(SS_DATA)
  })
})
