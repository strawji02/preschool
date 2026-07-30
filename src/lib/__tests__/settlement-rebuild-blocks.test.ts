import { describe, it, expect } from 'vitest'
import {
  buildSettlementSheet,
  rebuildClosingBlocks,
  type ClosingPartnerRow,
  type ClosingVenueRow,
} from '@/features/settlement'

/**
 * [정산] 마감된 달의 내역서 재생성 (docs §8-2)
 *
 * ★ 확정·마감한 달의 산출물은 **원천 파일 없이도** 다시 받을 수 있어야 한다.
 *
 * 지금까지는 다운로드가 업로드 화면에만 있었다. 브라우저를 닫았다 열면 분석
 * 결과가 사라져 계산서도 내역서도 받을 수 없었다 — 세무사가 며칠 뒤 "그 파일
 * 다시 주세요"라고 하면 엑셀을 찾아 다시 올려야 했다.
 *
 * 계산서는 스냅샷의 `invoiceRows`를 그대로 쓰면 되지만, 내역서는 `blocks`
 * (영업자별 식당 줄 + 정산 결과)가 필요하다. 스냅샷에는 flat한
 * `closingVenues` · `closingPartners`만 있으므로 여기서 되살린다.
 *
 * ⚠️ **되살린 블록으로 만든 내역서는 업로드로 만든 것과 한 셀도 달라선 안 된다.**
 * 세무사에게 이미 보낸 파일과 다르면 그때부터 어느 쪽이 맞는지 알 수 없다.
 */

const zero = { taxableSupply: 0, vat: 0, exempt: 0, total: 0 }

function venue(over: Partial<ClosingVenueRow> = {}): ClosingVenueRow {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: '1000',
    restaurantName: '해밀유치원',
    companyName: '해밀유치원',
    partnerId: 'p1',
    partnerName: '김영업',
    isExcluded: false,
    exclusionReason: null,
    cost: { ...zero, total: 1_000_000 },
    price: { ...zero, total: 1_300_000 },
    ...over,
  }
}

function partner(over: Partial<ClosingPartnerRow> = {}): ClosingPartnerRow {
  return {
    partnerId: 'p1',
    partnerName: '김영업',
    partnerType: 'partner',
    commissionPercent: 5,
    costTotal: 1_000_000,
    costVat: 0,
    priceTotal: 1_300_000,
    priceVat: 0,
    margin: 300_000,
    platformFee: 65_000,
    vatDiff: 0,
    businessDeduction: 0,
    preTax: 235_000,
    declared: 235_000,
    incomeTax: 7_050,
    localTax: 700,
    netPay: 227_250,
    ...over,
  }
}

describe('rebuildClosingBlocks — 블록 구성', () => {
  it('영업자별로 담당 식당을 모은다', () => {
    const blocks = rebuildClosingBlocks(
      [
        venue({ restaurantCode: '1000', restaurantName: 'A유치원' }),
        venue({ restaurantCode: '1001', restaurantName: 'B유치원' }),
      ],
      [partner()]
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].partnerName).toBe('김영업')
    expect(blocks[0].lines.map((l) => l.venueName)).toEqual(['A유치원', 'B유치원'])
  })

  it('정산 제외(본사)가 맨 앞에 온다 — 원본 레이아웃 순서다', () => {
    const blocks = rebuildClosingBlocks(
      [
        venue({ partnerId: 'p1' }),
        venue({
          restaurantCode: '9999',
          restaurantName: '키즈웰에듀푸드(본사)',
          partnerId: null,
          partnerName: null,
          isExcluded: true,
          exclusionReason: '마케팅비',
        }),
      ],
      [partner()]
    )
    expect(blocks[0].partnerName).toBe('본사')
    expect(blocks[0].settlement).toBeNull()
    expect(blocks[1].partnerName).toBe('김영업')
  })

  it('제외 식당이 없으면 본사 블록을 만들지 않는다', () => {
    const blocks = rebuildClosingBlocks([venue()], [partner()])
    expect(blocks.map((b) => b.partnerName)).toEqual(['김영업'])
  })

  it('영업자 순서는 `closingPartners` 배열 순서를 따른다', () => {
    const blocks = rebuildClosingBlocks(
      [venue({ partnerId: 'p2', partnerName: '이영업' }), venue({ partnerId: 'p1' })],
      [
        partner({ partnerId: 'p1', partnerName: '김영업' }),
        partner({ partnerId: 'p2', partnerName: '이영업' }),
      ]
    )
    expect(blocks.map((b) => b.partnerName)).toEqual(['김영업', '이영업'])
  })
})

describe('rebuildClosingBlocks — 식당 표기 (venueDisplayName)', () => {
  it('CJ는 식당명만 쓴다', () => {
    const blocks = rebuildClosingBlocks(
      [venue({ source: 'cj', businessName: '키즈웰에듀푸드(해밀)', restaurantName: '해밀유치원' })],
      [partner()]
    )
    expect(blocks[0].lines[0].venueName).toBe('해밀유치원')
  })

  it('신세계는 사업장명 + 식당명을 붙이고 `EDU)키즈_` 접두를 뗀다', () => {
    const blocks = rebuildClosingBlocks(
      [
        venue({
          source: 'shinsegae',
          businessName: 'EDU)키즈_나래유치원',
          restaurantName: '원아급간식',
        }),
      ],
      [partner()]
    )
    expect(blocks[0].lines[0].venueName).toBe('나래유치원 원아급간식')
  })
})

describe('rebuildClosingBlocks — 정산 결과', () => {
  it('내역서 `계` 행에 쓰이는 값이 그대로 실린다', () => {
    const blocks = rebuildClosingBlocks([venue()], [partner()])
    const s = blocks[0].settlement!
    expect(s.margin).toBe(300_000)
    expect(s.platformFee).toBe(65_000)
    expect(s.vatDiff).toBe(0)
    expect(s.businessDeduction).toBe(0)
    expect(s.preTax).toBe(235_000)
    expect(s.declared).toBe(235_000)
    expect(s.incomeTax).toBe(7_050)
    expect(s.localTax).toBe(700)
    expect(s.netPay).toBe(227_250)
  })

  it('금액을 다시 계산하지 않는다 — 마감된 값을 그대로 쓴다', () => {
    // 산식으로 다시 돌리면 마스터(수수료율)가 바뀐 뒤에 과거 내역서가 달라진다.
    // 마감의 존재 이유가 무너지므로, 저장된 숫자를 그대로 옮기기만 한다.
    const odd = partner({ platformFee: 999_999, preTax: 1, netPay: 2, declared: 3 })
    const s = rebuildClosingBlocks([venue()], [odd])[0].settlement!
    expect(s.platformFee).toBe(999_999)
    expect(s.preTax).toBe(1)
    expect(s.netPay).toBe(2)
    expect(s.declared).toBe(3)
  })
})

describe('rebuildClosingBlocks — 내역서 시트가 실제로 만들어진다', () => {
  it('되살린 블록으로 시트를 만들 수 있다', () => {
    const blocks = rebuildClosingBlocks(
      [
        venue({ restaurantName: 'A유치원' }),
        venue({
          restaurantCode: '9999',
          restaurantName: '본사',
          partnerId: null,
          partnerName: null,
          isExcluded: true,
        }),
      ],
      [partner()]
    )
    const sheet = buildSettlementSheet(blocks)
    // 공백 2 + 헤더 2 + 본사(1줄 + 계) + 영업자(1줄 + 계) + 합계
    expect(sheet.rows.length).toBe(2 + 2 + 2 + 2 + 1)
    expect(sheet.merges.length).toBeGreaterThan(0)
  })

  it('담당 식당이 없는 영업자도 블록은 만든다 — 계 행에 정산액이 남는다', () => {
    // 이번 달 매출이 0인데 공제만 있는 경우가 있다. 블록을 빼면 그 금액이
    // 합계에서 사라져 내역서 총액이 안 맞는다.
    const blocks = rebuildClosingBlocks([], [partner()])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual([])
    expect(blocks[0].settlement?.preTax).toBe(235_000)
  })
})
