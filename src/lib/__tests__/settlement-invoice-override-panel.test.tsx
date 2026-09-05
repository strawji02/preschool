import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import InvoiceOverridePanel from '@/app/app/settlement/invoice-override-panel'

const candidate = {
  taxKind: 'taxable' as const,
  itemName: '급식재료',
  supply: 505_830,
  vat: 50_583,
  restaurantNames: ['키즈웰에듀푸드(복자유치원)'],
}

describe('복자유치원 요청 금액 UI', () => {
  it('업무 순서와 원본·요청·변경 영역을 식당명과 함께 표시한다', () => {
    const html = renderToStaticMarkup(
      <InvoiceOverridePanel
        period="2026-08"
        candidates={[candidate]}
        overrides={[]}
        locked={false}
        closingStatus="draft"
        onChanged={() => undefined}
      />
    )

    expect(html).toContain('공급사 원본 확인')
    expect(html).toContain('유치원 요청값 입력')
    expect(html).toContain('키즈웰에듀푸드(복자유치원)')
    expect(html).toContain('공급사 원본')
    expect(html).toContain('유치원 요청 금액')
    expect(html).toContain('변경 내역')
    expect(html).toContain('변경된 금액이 없습니다')
  })

  it('확정된 달은 저장 후 월 마감 재확정이 필요함을 미리 표시한다', () => {
    const html = renderToStaticMarkup(
      <InvoiceOverridePanel
        period="2026-08"
        candidates={[candidate]}
        overrides={[]}
        locked={false}
        closingStatus="confirmed"
        onChanged={() => undefined}
      />
    )

    expect(html).toContain('현재 확정된 달입니다')
    expect(html).toContain('8. 월 마감')
  })
})
