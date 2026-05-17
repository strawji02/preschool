import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/products/last-sync (2026-05-17)
 *
 * 신세계 DB의 가장 최근 sync 날짜 반환 — 제안서 푸터의
 * "{YYYY년 M월} 신세계 단가 기준" 문구용.
 *
 * Response:
 *   { success: true, period: '2026년 5월', date: '2026-05-09' }
 */
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('products')
      .select('last_synced_at')
      .eq('supplier', 'SHINSEGAE')
      .order('last_synced_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (error) return apiError(error, 500, 'last-sync')
    const iso = (data?.last_synced_at as string | undefined) ?? new Date().toISOString()
    const d = new Date(iso)
    const period = `${d.getFullYear()}년 ${d.getMonth() + 1}월`
    return NextResponse.json({
      success: true,
      period,
      date: iso.slice(0, 10),
    })
  } catch (e) {
    return apiError(e, 500, 'last-sync')
  }
}
