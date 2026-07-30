import type { ClosingPartnerRow, ClosingVenueRow } from '../calc/closing'
import type { SettlementResult } from '../calc/settlement-formula'
import type { ReportPartnerBlock, ReportVenueLine } from './settlement-sheet'

/**
 * 마감 스냅샷 → 내역서 블록 되살리기 (docs §8-2).
 *
 * ★ 확정·마감한 달의 산출물은 **원천 파일 없이도** 다시 받을 수 있어야 한다.
 *
 * 다운로드가 업로드 화면에만 있어서, 브라우저를 닫으면 계산서도 내역서도 받을
 * 수 없었다. 세무사가 며칠 뒤 "그 파일 다시 주세요"라고 하면 엑셀을 찾아 다시
 * 올려야 했다 — 게다가 그사이 마스터가 바뀌었으면 **다른 파일이 나온다.**
 *
 * 계산서는 스냅샷의 `invoiceRows`를 그대로 쓰면 되지만, 내역서는 영업자별
 * 블록이 필요하다. 스냅샷에는 flat한 `closingVenues` · `closingPartners`만
 * 있으므로 여기서 조립한다.
 *
 * ⚠️ **금액을 다시 계산하지 않는다.** 산식으로 다시 돌리면 수수료율이 바뀐 뒤에
 * 과거 내역서가 달라진다 — 마감의 존재 이유가 무너진다. 저장된 숫자를 그대로
 * 옮기기만 한다.
 */

/**
 * 원본 `집계표_정산용` B열 표기.
 *
 * `venueDisplayName()`과 같은 규칙이지만 입력 타입이 다르다 (`NormalizedVenue`
 * 대신 `ClosingVenueRow`). 규칙이 갈라지지 않도록 한쪽만 고치는 일이 없어야 한다.
 */
function venueName(v: ClosingVenueRow): string {
  if (v.source === 'cj') return v.restaurantName
  const business = v.businessName.replace(/^EDU\)키즈_/, '')
  return `${business} ${v.restaurantName}`.trim()
}

function toLine(v: ClosingVenueRow): ReportVenueLine {
  return { venueName: venueName(v), cost: v.cost, price: v.price }
}

/**
 * 마감된 값을 `SettlementResult` 모양으로 옮긴다.
 *
 * `preTaxRaw`·`warnings`는 스냅샷에 없다. 둘 다 내역서 시트에 쓰이지 않는
 * 진단용 필드라 여기서는 채우지 않는다 — 없는 값을 지어내지 않는다.
 */
function toSettlement(p: ClosingPartnerRow): SettlementResult {
  return {
    margin: p.margin,
    platformFee: p.platformFee,
    vatDiff: p.vatDiff,
    businessDeduction: p.businessDeduction,
    preTaxRaw: p.preTax,
    preTax: p.preTax,
    declared: p.declared,
    incomeTax: p.incomeTax,
    localTax: p.localTax,
    netPay: p.netPay,
    warnings: [],
  }
}

export function rebuildClosingBlocks(
  venues: readonly ClosingVenueRow[],
  partners: readonly ClosingPartnerRow[]
): ReportPartnerBlock[] {
  const blocks: ReportPartnerBlock[] = []

  // 정산 제외(본사)를 맨 앞에 두는 것이 원본 레이아웃이다
  const excluded = venues.filter((v) => v.isExcluded)
  if (excluded.length > 0) {
    blocks.push({ partnerName: '본사', lines: excluded.map(toLine), settlement: null })
  }

  // 영업자 순서는 `closingPartners` 배열 순서를 따른다. 스냅샷은 JSON 배열이라
  // 마감 당시 순서가 그대로 보존된다 (DB 테이블은 정렬이 보장되지 않는다).
  for (const p of partners) {
    blocks.push({
      partnerName: p.partnerName,
      lines: venues.filter((v) => !v.isExcluded && v.partnerId === p.partnerId).map(toLine),
      settlement: toSettlement(p),
    })
  }

  return blocks
}
