import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReportDownloads from '@/app/app/settlement/report/downloads'

const venues = [
  { source: 'cj' as const, businessCode: '1016', businessName: '복자유치원' },
  { source: 'shinsegae' as const, businessCode: '89912', businessName: '나래유치원' },
]

describe('경영보고서 유치원 거래명세표 다운로드', () => {
  it('전체 ZIP과 기존 개별 유치원 다운로드를 함께 표시한다', () => {
    const html = renderToStaticMarkup(
      <ReportDownloads
        period="2026-08"
        taxableCount={2}
        exemptCount={2}
        partners={[]}
        closingRevision={3}
        statementVenues={venues}
      />
    )

    expect(html).toContain('유치원 거래명세표 ZIP (2곳)')
    expect(html).toContain('복자유치원 (CJ)')
    expect(html).toContain('나래유치원 (신세계)')
    expect(html).toContain('ZIP 파일 하나')
  })

  it('거래명세표 대상이 없으면 ZIP 버튼을 표시하지 않는다', () => {
    const html = renderToStaticMarkup(
      <ReportDownloads
        period="2026-08"
        taxableCount={0}
        exemptCount={0}
        partners={[]}
        closingRevision={1}
        statementVenues={[]}
      />
    )

    expect(html).not.toContain('유치원 거래명세표 ZIP')
  })
})
