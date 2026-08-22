import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  addManualItemEvidence,
  downloadManualItemEvidence,
  getManualItem,
  loadClosing,
} from '@/features/settlement'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ success: false, error: '증빙을 지정해 주세요.' }, { status: 400 })
  try {
    const file = await downloadManualItemEvidence(id)
    if (!file) return NextResponse.json({ success: false, error: '증빙을 찾지 못했습니다.' }, { status: 404 })
    return new NextResponse(file.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '증빙 조회 실패' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const itemId = String(form.get('itemId') ?? '')
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (!itemId || files.length === 0) {
    return NextResponse.json({ success: false, error: '외부 사입과 증빙 파일을 지정해 주세요.' }, { status: 400 })
  }
  if (files.some((f) => {
    const allowedByName = /\.(pdf|jpe?g|png|xlsx)$/i.test(f.name)
    return f.size <= 0 || f.size > MAX_FILE_SIZE || (!ALLOWED.has(f.type) && !allowedByName)
  })) {
    return NextResponse.json(
      { success: false, error: 'PDF·JPG·PNG·XLSX 파일만 가능하며 파일당 10MB 이하여야 합니다.' },
      { status: 400 }
    )
  }
  try {
    const item = await getManualItem(itemId)
    if (!item) return NextResponse.json({ success: false, error: '외부 사입을 찾지 못했습니다.' }, { status: 404 })
    const closing = await loadClosing(item.period)
    if (closing?.status === 'closed') {
      return NextResponse.json({ success: false, error: '마감된 달에는 증빙을 추가할 수 없습니다.' }, { status: 409 })
    }
    const evidence = []
    for (const file of files) {
      evidence.push(await addManualItemEvidence({
        itemId,
        period: item.period,
        fileName: file.name,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        actor: guard.user.email,
      }))
    }
    return NextResponse.json({ success: true, evidence })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '증빙 저장 실패' },
      { status: 500 }
    )
  }
}
