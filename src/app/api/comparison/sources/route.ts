import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'
import { normalizeComparisonMatchKey } from '@/lib/comparison-match-learning'

const SOURCE_TYPES = new Set(['excel', 'pdf', 'image', 'mixed'])

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('session_id')
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'session_id가 필요합니다.' }, { status: 400 })
    }
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('comparison_sources')
      .select('id, supplier_name, source_type, display_name, file_names, is_append, item_count, source_total, status, created_at, completed_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
    if (error) return apiError(error, 500, 'comparison-sources-get')
    return NextResponse.json({ success: true, sources: data ?? [] })
  } catch (error) {
    return apiError(error, 500, 'comparison-sources-get')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const sessionId = String(body.session_id ?? '')
    const supplierName = String(body.supplier_name ?? '').trim()
    const sourceType = String(body.source_type ?? '')
    const fileNames = Array.isArray(body.file_names)
      ? body.file_names.map((name: unknown) => String(name)).filter(Boolean)
      : []
    const fileHash = body.file_hash ? String(body.file_hash).toLowerCase() : null

    if (!sessionId || !supplierName || !SOURCE_TYPES.has(sourceType) || fileNames.length === 0) {
      return NextResponse.json(
        { success: false, error: '세션·원본 공급사·파일 형식을 확인해주세요.' },
        { status: 400 },
      )
    }
    if (fileHash && !/^[a-f0-9]{64}$/.test(fileHash)) {
      return NextResponse.json({ success: false, error: '파일 해시 형식이 올바르지 않습니다.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: session } = await supabase
      .from('audit_sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ success: false, error: '세션을 찾을 수 없습니다.' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('comparison_sources')
      .insert({
        session_id: sessionId,
        supplier_name: supplierName,
        supplier_key: normalizeComparisonMatchKey(supplierName),
        source_type: sourceType,
        display_name: String(body.display_name ?? fileNames.join(', ')),
        file_names: fileNames,
        file_hash: fileHash,
        is_append: body.is_append === true,
        item_count: Math.max(0, Number(body.item_count ?? 0)),
        source_total: Number(body.source_total ?? 0),
        status: body.status === 'completed' ? 'completed' : 'processing',
        completed_at: body.status === 'completed' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (error?.code === '23505') {
      return NextResponse.json(
        { success: false, error: '같은 파일이 이 세션에 이미 추가되어 있습니다.' },
        { status: 409 },
      )
    }
    if (error) return apiError(error, 500, 'comparison-sources-post')
    return NextResponse.json({ success: true, source_id: data.id })
  } catch (error) {
    return apiError(error, 500, 'comparison-sources-post')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const sourceId = String(body.source_id ?? '')
    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'source_id가 필요합니다.' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    if (body.item_count !== undefined) update.item_count = Math.max(0, Number(body.item_count))
    if (body.source_total !== undefined) update.source_total = Number(body.source_total)
    if (body.status && ['processing', 'completed', 'error'].includes(body.status)) {
      update.status = body.status
      update.completed_at = body.status === 'completed' ? new Date().toISOString() : null
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: '변경할 값이 없습니다.' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('comparison_sources').update(update).eq('id', sourceId)
    if (error) return apiError(error, 500, 'comparison-sources-patch')
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 500, 'comparison-sources-patch')
  }
}
