import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ComparisonItem, MatchStatus, SupplierMatch } from '@/types/audit'
import { calculateComparisonSavings } from '@/lib/matching'

/**
 * GET /api/sessions/:id
 * 단일 세션 + 모든 audit_items + page_totals 반환 (state 복원용)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }
    const supabase = createAdminClient()

    const { data: session, error: sessErr } = await supabase
      .from('audit_sessions')
      .select(
        'id, name, kindergarten_name, supplier, status, total_pages, total_files, total_items, matched_items, current_step, page_totals, created_at, updated_at',
      )
      .eq('id', id)
      .single()
    if (sessErr || !session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    }

    const { data: itemsRaw, error: itemsErr } = await supabase
      .from('audit_items')
      .select('*')
      .eq('session_id', id)
      .order('page_number', { ascending: true })
      .order('row_index', { ascending: true })
    if (itemsErr) {
      return NextResponse.json({ success: false, error: itemsErr.message }, { status: 500 })
    }

    // ComparisonItem 형태로 매핑 (matched_product 정보는 product 테이블 join이 필요하나,
    // 실용 측면에서 standard_price/match_score로 충분 — 매칭 후보 재조회는 SplitView에서 처리)
    const items: ComparisonItem[] = (itemsRaw ?? []).map((it) => {
      const supplyAmount = it.extracted_supply_amount ?? undefined
      const taxAmount = it.extracted_tax_amount ?? undefined
      const totalPrice = it.extracted_total_price ?? undefined
      const matchStatus = (it.match_status ?? 'unmatched') as MatchStatus

      // 단일 매칭 정보 → cj/ssg 어느 쪽인지 식별 불가하므로 ssg_match로만 복원
      // (현재 supplier 컬럼이 audit_sessions에 있고 SHINSEGAE 단일 시나리오 가정)
      const ssgMatch: SupplierMatch | undefined = it.matched_product_id
        ? {
            id: it.matched_product_id,
            product_name: '',           // 실제 product 정보는 SplitView에서 lazy fetch
            standard_price: Number(it.standard_price ?? 0),
            match_score: Number(it.match_score ?? 0),
          }
        : undefined

      const savings = calculateComparisonSavings(
        it.extracted_unit_price ?? 0,
        it.extracted_quantity ?? 0,
        undefined,
        ssgMatch?.standard_price,
      )

      return {
        id: it.id,
        extracted_name: it.extracted_name ?? '',
        extracted_spec: it.extracted_spec ?? undefined,
        extracted_unit: it.extracted_unit ?? undefined,
        extracted_quantity: Number(it.extracted_quantity ?? 0),
        extracted_unit_price: Number(it.extracted_unit_price ?? 0),
        extracted_supply_amount: supplyAmount != null ? Number(supplyAmount) : undefined,
        extracted_tax_amount: taxAmount != null ? Number(taxAmount) : undefined,
        extracted_total_price: totalPrice != null ? Number(totalPrice) : undefined,
        page_number: it.page_number ?? undefined,
        source_file_name: it.source_file_name ?? undefined,
        cj_match: undefined,
        ssg_match: ssgMatch,
        cj_candidates: [],
        ssg_candidates: [],
        is_confirmed: !!it.matched_product_id,
        cj_confirmed: false,
        ssg_confirmed: !!it.matched_product_id,
        savings,
        match_status: matchStatus,
        is_excluded: it.is_excluded ?? false,
      }
    })

    return NextResponse.json({ success: true, session, items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/sessions/:id
 * 세션 메타데이터 업데이트 (이름, 업체명, 현재 단계)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const supabase = createAdminClient()

    const allowedFields = ['name', 'kindergarten_name', 'current_step', 'total_pages', 'total_files']
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const f of allowedFields) {
      if (body[f] !== undefined) update[f] = body[f]
    }

    const { error } = await supabase.from('audit_sessions').update(update).eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/sessions/:id
 * 세션 소프트 삭제 (is_archived=true)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase
      .from('audit_sessions')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
