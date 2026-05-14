import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findComparisonMatches } from '@/lib/matching'
import { getTokenMatchRatio, MIN_VALID_MATCH_RATIO } from '@/lib/token-match'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/sessions/:id/rematch-cj
 * 잘못된 매칭 (CJ + 저신뢰 SHINSEGAE) + unmatched 항목을 SHINSEGAE 카탈로그에서 자동 재매칭.
 *
 * 재매칭 대상 (3종):
 *  1) matched_product가 CJ supplier (잘못된 공급사)
 *  2) matched_product가 SHINSEGAE이지만 토큰 매칭 비율 < 0.3 (콩나물 → 파인애플 같은 무관 매칭)
 *  3) matched_product 없음 (unmatched)
 *
 * 매칭 채택 기준 (양 조건 모두 만족):
 *  - hybrid score >= MIN_MATCH_SCORE (0.005)
 *  - 토큰 매칭 비율 >= MIN_VALID_MATCH_RATIO (0.3)
 *
 * 반환: { rematched, stillUnmatched, total, ... }
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

    // 1) 대상 audit_items 가져오기 — product_name까지 가져와서 토큰 매칭 검증
    const { data: itemsRaw, error: fetchErr } = await supabase
      .from('audit_items')
      .select(
        'id, extracted_name, extracted_spec, extracted_quantity, extracted_unit, extracted_unit_price, matched_product_id, match_status, matched_product:products!matched_product_id(supplier, product_name)',
      )
      .eq('session_id', id)

    if (fetchErr) {
      return apiError(fetchErr, 500, 'rematch-cj-fetch')
    }

    // 재매칭 대상 분류:
    //  - 1) CJ 매칭 (잘못된 공급사)
    //  - 2) 매칭 없음 (unmatched)
    //  - 3) SHINSEGAE 매칭이지만 토큰 비율 < 0.3 (콩나물 → 파인애플 같은 무관 매칭)
    type ItemRow = {
      id: string
      extracted_name: string
      extracted_spec?: string
      extracted_quantity?: number
      extracted_unit?: string
      extracted_unit_price?: number
      matched_product_id?: string
      match_status?: string
      matched_product?: { supplier?: string; product_name?: string } | null
    }
    let cjMatchTargets = 0
    let unmatchedTargets = 0
    let lowConfidenceTargets = 0
    const targets = (itemsRaw as ItemRow[] | null ?? []).filter((it) => {
      const mp = it.matched_product
      // 1) 매칭 없음
      if (!mp) {
        unmatchedTargets++
        return true
      }
      // 2) CJ 매칭
      if (mp.supplier !== 'SHINSEGAE') {
        cjMatchTargets++
        return true
      }
      // 3) SHINSEGAE 매칭이지만 토큰 매칭 비율 낮음 (저신뢰)
      const ratio = getTokenMatchRatio(it.extracted_name ?? '', mp.product_name ?? '')
      if (ratio < MIN_VALID_MATCH_RATIO) {
        lowConfidenceTargets++
        return true
      }
      return false
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
        // 채택 기준: hybrid score >= 0.005 AND 토큰 매칭 비율 >= 0.3
        const tokenRatio = ssgMatch
          ? getTokenMatchRatio(itemName, ssgMatch.product_name ?? '')
          : 0
        const isAccepted =
          !!ssgMatch &&
          !!ssgMatch.id &&
          (ssgMatch.match_score ?? 0) >= MIN_MATCH_SCORE &&
          tokenRatio >= MIN_VALID_MATCH_RATIO

        if (isAccepted && ssgMatch) {
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
      breakdown: {
        cjMatchTargets,
        unmatchedTargets,
        lowConfidenceTargets,
      },
    })
  } catch (e) {
    return apiError(e, 500, 'rematch-cj')
  }
}
