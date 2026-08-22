import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  createZipArchive,
  isValidPeriod,
  loadClosingSnapshot,
  partnerReportFileName,
  writePartnerSettlementWorkbook,
  type AdjustmentRecord,
  type ClosingPartnerRow,
  type ClosingVenueRow,
  type DeclarationSplit,
  type DeductionItem,
  type ManualItemRecord,
} from '@/features/settlement'

interface PartnerSnapshot {
  closingVenues?: ClosingVenueRow[]
  closingPartners?: ClosingPartnerRow[]
  deductionItems?: Record<string, DeductionItem[]>
  splits?: Record<string, DeclarationSplit[]>
  adjustments?: AdjustmentRecord[]
  adjustmentAmounts?: Record<string, number>
  manualItems?: ManualItemRecord[]
  manualDeductionItems?: Record<string, DeductionItem[]>
}

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const period = request.nextUrl.searchParams.get('period') ?? ''
  const selectedId = request.nextUrl.searchParams.get('partnerId')
  if (!isValidPeriod(period)) {
    return NextResponse.json({ success: false, error: '정산월을 확인해 주세요.' }, { status: 400 })
  }
  try {
    const loaded = await loadClosingSnapshot(period)
    if (!loaded) {
      return NextResponse.json({ success: false, error: '먼저 정산을 확정해 주세요.' }, { status: 404 })
    }
    const snap = loaded.snapshot as PartnerSnapshot
    if (!Array.isArray(snap.closingVenues) || !Array.isArray(snap.closingPartners)) {
      return NextResponse.json({ success: false, error: '파트너 파일 재현 정보가 없습니다. 다시 확정해 주세요.' }, { status: 409 })
    }
    const partners = selectedId
      ? snap.closingPartners.filter((p) => p.partnerId === selectedId)
      : snap.closingPartners
    if (partners.length === 0) {
      return NextResponse.json({ success: false, error: '거래가 있는 파트너를 찾지 못했습니다.' }, { status: 404 })
    }

    const duplicateNames = new Set(
      partners
        .map((p) => p.partnerName)
        .filter((name, index, all) => all.indexOf(name) !== index)
    )
    const files = partners.map((partner) => {
      const bytes = writePartnerSettlementWorkbook({
        period,
        status: loaded.closing.status,
        partner,
        venues: snap.closingVenues!,
        deductionItems: [
          ...(snap.deductionItems?.[partner.partnerId] ?? []),
          ...(snap.manualDeductionItems?.[partner.partnerId] ?? []),
        ],
        adjustments: snap.adjustments ?? [],
        adjustmentAmounts: snap.adjustmentAmounts ?? {},
        manualItems: snap.manualItems ?? [],
      })
      const nameForFile = duplicateNames.has(partner.partnerName)
        ? `${partner.partnerName}_${partner.partnerId.slice(0, 8)}`
        : partner.partnerName
      return {
        name: partnerReportFileName(period, nameForFile, loaded.closing.status),
        bytes,
      }
    })

    if (selectedId) return fileResponse(files[0].bytes, files[0].name, 'xlsx')
    const zip = createZipArchive(files)
    return fileResponse(zip, `${period}_파트너정산서_전체.zip`, 'zip')
  } catch (err) {
    console.error('[settlement/partner-report]', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '파트너 파일 생성 실패' },
      { status: 500 }
    )
  }
}

function fileResponse(bytes: Uint8Array, name: string, kind: 'xlsx' | 'zip'): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': kind === 'zip'
        ? 'application/zip'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
