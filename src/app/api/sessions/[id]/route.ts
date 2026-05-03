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

    // products JOIN으로 매칭 제품의 supplier 검증 (2026-05-04)
    // SHINSEGAE-only 시스템 — CJ 매칭은 unmatched로 강등
    const { data: itemsRaw, error: itemsErr } = await supabase
      .from('audit_items')
      .select(
        '*, matched_product:products!matched_product_id(id, supplier, product_name, product_code, spec_quantity, spec_unit, unit_normalized, category, origin, tax_type)',
      )
      .eq('session_id', id)
      .order('page_number', { ascending: true })
      .order('row_index', { ascending: true })
    if (itemsErr) {
      return NextResponse.json({ success: false, error: itemsErr.message }, { status: 500 })
    }

    // ComparisonItem 형태로 매핑 — supplier 검증 통과한 매칭만 ssg_match로 복원
    let invalidCjMatchCount = 0
    const items: ComparisonItem[] = (itemsRaw ?? []).map((it) => {
      const supplyAmount = it.extracted_supply_amount ?? undefined
      const taxAmount = it.extracted_tax_amount ?? undefined
      const totalPrice = it.extracted_total_price ?? undefined

      // 매칭 supplier 검증: SHINSEGAE만 인정
      const mp = it.matched_product as
        | {
            id: string
            supplier: string
            product_name: string
            product_code?: string
            spec_quantity?: number
            spec_unit?: string
            unit_normalized?: string
            tax_type?: '과세' | '면세'
            category?: string
          }
        | null
      const isValidSsg = !!mp && mp.supplier === 'SHINSEGAE'
      if (mp && mp.supplier !== 'SHINSEGAE') invalidCjMatchCount++

      const ssgMatch: SupplierMatch | undefined = isValidSsg && it.matched_product_id
        ? {
            id: it.matched_product_id,
            product_name: mp!.product_name ?? '',
            standard_price: Number(it.standard_price ?? 0),
            match_score: Number(it.match_score ?? 0),
            spec_quantity: mp!.spec_quantity ?? undefined,
            spec_unit: mp!.spec_unit ?? undefined,
            unit_normalized: mp!.unit_normalized ?? undefined,
            tax_type: mp!.tax_type,
            category: mp!.category,
          }
        : undefined

      // 매칭 상태: 잘못된 CJ 매칭은 unmatched로 강등
      const matchStatus: MatchStatus = ssgMatch
        ? ((it.match_status ?? 'unmatched') as MatchStatus)
        : 'unmatched'

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
        is_confirmed: !!ssgMatch, // 잘못된 CJ 매칭은 미확정 처리
        cj_confirmed: false,
        ssg_confirmed: !!ssgMatch,
        savings,
        match_status: matchStatus,
        is_excluded: it.is_excluded ?? false,
        adjusted_quantity: it.adjusted_quantity ?? undefined,
        adjusted_unit_weight_g: it.adjusted_unit_weight_g ?? undefined,
        adjusted_pack_unit: it.adjusted_pack_unit ?? undefined,
        precision_reviewed_at: it.precision_reviewed_at ?? undefined,
      }
    })

    return NextResponse.json({ success: true, session, items, invalidCjMatchCount })
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
