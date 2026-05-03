import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findComparisonMatches } from '@/lib/matching'

/**
 * POST /api/sessions/:id/rematch-cj
 * 잘못된 CJ 매칭 / unmatched 항목을 SHINSEGAE 카탈로그에서 자동 재매칭.
 *
 * 동작:
 *  1) 세션의 audit_items 중 (matched_product가 CJ supplier) 또는 (matched_product 없음) 추출
 *  2) 각 item.extracted_name으로 SHINSEGAE 매칭 검색 (findComparisonMatches)
 *  3) ssg_match가 있고 점수가 임계값(0.005) 이상이면 matched_product_id 업데이트
 *  4) 점수 미만 또는 매칭 없음 → matched_product_id=NULL, match_status='unmatched'
 *
 * 반환: { rematched: number, stillUnmatched: number, total: number }
 */
const MIN_MATCH_SCORE = 0.005
export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }
    const supabase = createAdminClient()

    // 1) 대상 audit_items 가져오기 (CJ 매칭 + unmatched)
    const { data: itemsRaw, error: fetchErr } = await supabase
      .from('audit_items')
      .select(
        'id, extracted_name, extracted_spec, extracted_quantity, extracted_unit, extracted_unit_price, matched_product_id, match_status, matched_product:products!matched_product_id(supplier)',
      )
      .eq('session_id', id)

    if (fetchErr) {
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 })
    }

    // 재매칭 대상: CJ 공급사 매칭이거나, 매칭이 없는 항목
    type ItemRow = {
      id: string
      extracted_name: string
      extracted_spec?: string
      extracted_quantity?: number
      extracted_unit?: string
      extracted_unit_price?: number
      matched_product_id?: string
      match_status?: string
      matched_product?: { supplier?: string } | null
    }
    const targets = (itemsRaw as ItemRow[] | null ?? []).filter((it) => {
      const mp = it.matched_product
      return !mp || mp.supplier !== 'SHINSEGAE'
    })

    let rematched = 0
    let stillUnmatched = 0

    // 한 항목 처리 함수
    const processOne = async (it: ItemRow): Promise<'rematched' | 'unmatched'> => {
      const itemName = (it.extracted_name ?? '').trim()
      if (!itemName) return 'unmatched'

      try {
        const result = await findComparisonMatches(itemName, supabase, undefined, {
          name: itemName,
          spec: it.extracted_spec ?? undefined,
          unit: it.extracted_unit ?? undefined,
          quantity: Number(it.extracted_quantity ?? 1),
          unit_price: Number(it.extracted_unit_price ?? 0),
        })

        const ssgMatch = result.ssg_match
        if (ssgMatch && ssgMatch.id && (ssgMatch.match_score ?? 0) >= MIN_MATCH_SCORE) {
          await supabase
            .from('audit_items')
            .update({
              matched_product_id: ssgMatch.id,
              standard_price: ssgMatch.standard_price,
              match_score: ssgMatch.match_score,
              match_status: 'auto_matched',
              updated_at: new Date().toISOString(),
            })
            .eq('id', it.id)
          return 'rematched'
        } else {
          await supabase
            .from('audit_items')
            .update({
              matched_product_id: null,
              standard_price: null,
              match_score: null,
              match_status: 'unmatched',
              updated_at: new Date().toISOString(),
            })
            .eq('id', it.id)
          return 'unmatched'
        }
      } catch (e) {
        console.warn(`재매칭 실패 (item ${it.id}):`, e)
        return 'unmatched'
      }
    }

    // 2) 8건씩 병렬 처리 (Vercel 60s timeout 대응)
    const BATCH = 8
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH)
      const results = await Promise.allSettled(batch.map(processOne))
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value === 'rematched') rematched++
          else stillUnmatched++
        } else {
          stillUnmatched++
        }
      }
    }

    return NextResponse.json({
      success: true,
      rematched,
      stillUnmatched,
      total: targets.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
