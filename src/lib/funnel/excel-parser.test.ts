import { describe, it, expect } from 'vitest'
import { detectColumns, normalizeInvoiceData } from './excel-parser'

/**
 * [비교] 거래명세서 열 인식·정규화 (docs/systems/comparison.md §3)
 *
 * ★ 원래 `console.log` + `npx tsx` 수동 스크립트였다. 2026-07-31 vitest로 옮겼다.
 * 옮긴 배경은 `price-normalizer.test.ts` 주석 참조.
 *
 * 이 모듈은 `ExcelUploader.tsx`와 `matching.ts`가 쓰는 **운영 코드**다.
 * 여기서 열을 잘못 잡으면 그 뒤의 매칭·절감액이 전부 어긋난다.
 */

const COLS = {
  itemName: 0,
  spec: 1,
  quantity: 2,
  unitPrice: 3,
  amount: 4,
  taxType: null,
} as const

describe('detectColumns — 헤더에서 열 위치 찾기', () => {
  it('한글 헤더', () => {
    expect(detectColumns(['품명', '규격', '수량', '단가', '금액', '비고'])).toMatchObject({
      itemName: 0,
      spec: 1,
      quantity: 2,
      unitPrice: 3,
      amount: 4,
    })
  })

  it('영문 헤더', () => {
    expect(
      detectColumns(['Item Name', 'Spec', 'Qty', 'Unit Price', 'Total Amount'])
    ).toMatchObject({ itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4 })
  })

  it('과세구분 열을 잡는다', () => {
    expect(
      detectColumns(['품명', '규격', '수량', '단가', '금액', '과세구분'])
    ).toMatchObject({ taxType: 5 })
  })

  it('열 순서가 바뀌어도 찾는다 — 명세서마다 양식이 다르다', () => {
    expect(detectColumns(['금액', '품명', '단가', '수량', '규격'])).toMatchObject({
      itemName: 1,
      spec: 4,
      quantity: 3,
      unitPrice: 2,
      amount: 0,
    })
  })

  it('없는 열은 null — 0으로 채우면 엉뚱한 열을 읽는다', () => {
    expect(detectColumns(['품명', '비고', '메모'])).toMatchObject({
      itemName: 0,
      spec: null,
      quantity: null,
      unitPrice: null,
      amount: null,
    })
  })
})

describe('normalizeInvoiceData — 행 → 품목', () => {
  it('기본 케이스', () => {
    const rows = normalizeInvoiceData(
      [
        ['양파', '1kg', 10, 5000, 50000],
        ['당근', '500g', 20, 3000, 60000],
      ],
      { ...COLS }
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      itemName: '양파',
      spec: '1kg',
      quantity: 10,
      unitPrice: 5000,
      amount: 50000,
    })
  })

  it('과세구분을 읽는다', () => {
    const rows = normalizeInvoiceData(
      [
        ['양파', '1kg', 10, 5000, 50000, '과세'],
        ['쌀', '20kg', 5, 40000, 200000, '면세'],
      ],
      { ...COLS, taxType: 5 }
    )
    expect(rows.map((r) => r.taxType)).toEqual(['과세', '면세'])
  })

  it('빈 행을 걸러낸다', () => {
    const rows = normalizeInvoiceData(
      [
        ['양파', '1kg', 10, 5000, 50000],
        [],
        ['', '', '', '', ''],
        ['당근', '500g', 20, 3000, 60000],
      ],
      { ...COLS }
    )
    expect(rows).toHaveLength(2)
  })

  it('쉼표가 들어간 숫자를 읽는다 — 엑셀이 문자열로 넘기는 경우가 있다', () => {
    const rows = normalizeInvoiceData([['양파', '1kg', '10', '5,000', '50,000']], {
      ...COLS,
    })
    expect(rows[0]).toMatchObject({ quantity: 10, unitPrice: 5000, amount: 50000 })
  })

  it('품명이 없으면 건너뛴다 — 합계 행·소계 행이 섞여 들어온다', () => {
    const rows = normalizeInvoiceData([['', '1kg', 10, 5000, 50000]], { ...COLS })
    expect(rows).toHaveLength(0)
  })
})
