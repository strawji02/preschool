import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  WorkNoteError,
  createWorkNote,
  deletePendingWorkNote,
  getWorkNote,
  isValidPeriod,
  listWorkNotes,
  loadClosing,
  loadSettlementMaster,
  setWorkNoteStatus,
  type SettlementMaster,
  type WorkNoteStatus,
  type WorkNoteTargetType,
} from '@/features/settlement'

const STATUS = new Set<WorkNoteStatus>(['pending', 'applied', 'not_applied'])
const TARGET_TYPE = new Set<WorkNoteTargetType>(['supplier', 'partner', 'venue', 'other'])

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!isValidPeriod(period)) return badRequest('정산월이 올바르지 않습니다.')

  try {
    const [notes, master, closing] = await Promise.all([
      listWorkNotes(period),
      loadSettlementMaster(),
      loadClosing(period),
    ])
    return NextResponse.json({
      success: true,
      notes,
      targets: buildTargets(master),
      locked: closing?.status === 'closed',
    })
  } catch (error) {
    return handle(error)
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  try {
    const body = await readBody(request)
    const period = String(body.period ?? '')
    const targetType = String(body.targetType ?? '') as WorkNoteTargetType
    if (!isValidPeriod(period) || !TARGET_TYPE.has(targetType)) {
      return badRequest('정산월 또는 메모 대상이 올바르지 않습니다.')
    }
    await assertOpen(period)
    const master = await loadSettlementMaster()
    const target = canonicalTarget(master, targetType, String(body.targetKey ?? ''))
    const note = await createWorkNote(
      {
        period,
        targetType,
        targetKey: target.key,
        targetLabel: target.label,
        memo: String(body.memo ?? ''),
      },
      guard.user.email
    )
    return NextResponse.json({ success: true, note })
  } catch (error) {
    return handle(error)
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  try {
    const body = await readBody(request)
    const id = String(body.id ?? '').trim()
    const status = String(body.status ?? '') as WorkNoteStatus
    if (!id || !STATUS.has(status)) return badRequest('메모 처리 상태가 올바르지 않습니다.')
    const existing = await getWorkNote(id)
    if (!existing) return badRequest('정산 메모를 찾을 수 없습니다.')
    await assertOpen(existing.period)
    const note = await setWorkNoteStatus(id, status, guard.user.email)
    return NextResponse.json({ success: true, note })
  } catch (error) {
    return handle(error)
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
    if (!id) return badRequest('삭제할 메모를 선택해 주세요.')
    const existing = await getWorkNote(id)
    if (!existing) return badRequest('정산 메모를 찾을 수 없습니다.')
    await assertOpen(existing.period)
    await deletePendingWorkNote(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handle(error)
  }
}

async function assertOpen(period: string): Promise<void> {
  const closing = await loadClosing(period)
  if (closing?.status === 'closed') {
    throw new WorkNoteError('마감된 달의 정산 메모는 변경할 수 없습니다.')
  }
}

function canonicalTarget(
  master: SettlementMaster,
  type: WorkNoteTargetType,
  rawKey: string
): { key: string; label: string } {
  const key = rawKey.trim()
  if (type === 'other') return { key: 'other', label: '기타' }
  if (type === 'supplier') {
    if (key === 'cj') return { key, label: 'CJ프레시웨이' }
    if (key === 'shinsegae') return { key, label: '신세계푸드' }
  }
  if (type === 'partner') {
    const partner = master.partners.get(key)
    if (partner?.isActive) return { key: partner.id, label: partner.name }
  }
  if (type === 'venue') {
    const venue = master.venues.find((item) => `${item.source}:${item.businessCode}` === key)
    if (venue && !venue.isExcluded) {
      return {
        key,
        label: venue.invoice.companyName?.trim() || venue.businessName,
      }
    }
  }
  throw new WorkNoteError('메모 대상을 다시 선택해 주세요.')
}

function buildTargets(master: SettlementMaster) {
  const venues = new Map<string, { key: string; label: string }>()
  for (const venue of master.venues) {
    if (venue.isExcluded) continue
    const key = `${venue.source}:${venue.businessCode}`
    venues.set(key, {
      key,
      label: venue.invoice.companyName?.trim() || venue.businessName,
    })
  }
  return {
    suppliers: [
      { key: 'cj', label: 'CJ프레시웨이' },
      { key: 'shinsegae', label: '신세계푸드' },
    ],
    partners: [...master.partners.values()]
      .filter((partner) => partner.isActive)
      .map((partner) => ({ key: partner.id, label: partner.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
    venues: [...venues.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    throw new WorkNoteError('요청 형식이 올바르지 않습니다.')
  }
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}

function handle(error: unknown): NextResponse {
  if (error instanceof WorkNoteError) return badRequest(error.message)
  console.error('[settlement/work-note]', error)
  return NextResponse.json(
    { success: false, error: '정산 메모 처리 중 오류가 발생했습니다.' },
    { status: 500 }
  )
}
