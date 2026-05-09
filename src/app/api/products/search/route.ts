import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embedding'
import { expandWithSynonyms } from '@/lib/synonyms'
import { dualNormalize, extractCoreKeyword } from '@/lib/preprocessing'
import { getTokenMatchRatio, SUPPLIER_BRANDS, GENERIC_MODIFIERS } from '@/lib/token-match'
import type { SearchProductsResponse, MatchCandidate, Supplier } from '@/types/audit'

interface RpcResult {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity: number | null
  spec_unit: string | null
  supplier: string
  match_score: number
  similarity?: number // For semantic search
  bm25_rank?: number // For BM25 search
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const supplier = searchParams.get('supplier') as Supplier | null
    const limit = parseInt(searchParams.get('limit') || '10', 10)

    // Validate query
    if (!query || query.trim().length === 0) {
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: 'Query parameter "q" is required' },
        { status: 400 }
      )
    }

    if (supplier && !['CJ', 'SHINSEGAE'].includes(supplier)) {
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: 'Invalid supplier. Must be CJ or SHINSEGAE' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const searchMode = process.env.NEXT_PUBLIC_SEARCH_MODE || 'hybrid'

    // Synonym expansion for better search recall
    const { forKeyword } = dualNormalize(query)
    const synonymTerms = expandWithSynonyms(forKeyword)
    const expandedQuery = synonymTerms.length > 1
      ? synonymTerms.slice(0, 3).join(' ')
      : forKeyword

    let results: RpcResult[] = []
    let error: any = null

    // Choose search strategy based on mode
    if (searchMode === 'hybrid') {
      // Hybrid Search: BM25 + Trigram (matching.ts와 동일한 함수 사용)
      const { data, error: rpcError } = await supabase.rpc('search_products_hybrid', {
        search_term_raw: query,
        search_term_clean: expandedQuery,
        limit_count: Math.min(limit, 50),
        supplier_filter: supplier || undefined,
        bm25_weight: 0.5,
        semantic_weight: 0.5,
      })
      results = data as RpcResult[] || []
      error = rpcError
    } else if (searchMode === 'semantic') {
      // Semantic-only Search: Vector similarity
      try {
        const embedding = await generateEmbedding(query)
        const { data, error: rpcError } = await supabase.rpc('search_products_vector', {
          query_embedding: embedding,
          limit_count: Math.min(limit, 50),
          supplier_filter: supplier || undefined,
          similarity_threshold: 0.3,
        })
        results = (data as RpcResult[] || []).map(r => ({
          ...r,
          match_score: r.similarity ?? 0,
        }))
        error = rpcError
      } catch (embedError) {
        console.error('Embedding generation failed:', embedError)
        return NextResponse.json<SearchProductsResponse>(
          { success: false, products: [], error: 'Embedding generation failed' },
          { status: 500 }
        )
      }
    } else if (searchMode === 'bm25') {
      // BM25-only Search: Keyword matching
      const { data, error: rpcError } = await supabase.rpc('search_products_bm25', {
        search_term: query,
        limit_count: Math.min(limit, 50),
        supplier_filter: supplier || undefined,
      })
      results = (data as RpcResult[] || []).map(r => ({
        ...r,
        match_score: r.bm25_rank ?? 0,
      }))
      error = rpcError
    } else {
      // Trigram Search (fallback for legacy mode)
      const { data, error: rpcError } = await supabase.rpc('search_products_fuzzy', {
        search_term_raw: query,
        limit_count: Math.min(limit, 50),
      })
      results = data as RpcResult[] || []
      error = rpcError
    }

    if (error) {
      console.error('Search RPC error:', error)
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: `Search failed: ${error.message}` },
        { status: 500 }
      )
    }

    // supplier 필터가 있으면 결과에서 필터링 (semantic 모드는 이미 RPC에서 필터링됨)
    if (supplier && searchMode !== 'semantic') {
      results = results.filter((p) => p.supplier === supplier)
    }

    // 단종 품목 제외 (2026-05-09, migration 042) — 신규 매칭 차단
    // RPC가 is_active를 알지 못하므로 후처리로 차단. 레거시 NULL은 active로 간주.
    if (results.length > 0) {
      const ids = results.map((p) => p.id)
      const { data: activeData } = await supabase
        .from('products')
        .select('id, is_active')
        .in('id', ids)
      if (activeData) {
        const deactivated = new Set(
          activeData.filter((r) => r.is_active === false).map((r) => r.id as string),
        )
        if (deactivated.size > 0) {
          results = results.filter((p) => !deactivated.has(p.id))
        }
      }
    }

    // ── Fallback search (2026-05-04): 결과 점수 너무 낮으면 핵심 키워드로 재검색 ──
    // 예: "이츠웰아이누리 느타리버섯" → 무관한 결과 → 마지막 어절 "느타리버섯"으로 재검색
    // 한국어 식자재명 관행: 브랜드명이 앞에 오고 식자재명이 뒤에 옴
    const topScore = results[0]?.match_score ?? 0
    if (topScore < 0.015 && searchMode !== 'semantic') {
      // 후보 키워드 (우선순위):
      // 1) 마지막 어절 (예: "이츠웰 신선한계란" → "신선한계란")
      // 2) 마지막 어절의 suffix 2~3자 (한국어 합성어 분해, 예: "신선한계란" → "계란")
      // 3) extractCoreKeyword
      const tokens = query.trim().split(/\s+/).filter((t) => t.length >= 2)
      const candidateKws: string[] = []
      // brand/modifier 제외한 의미있는 토큰만 fallback 후보로 (식자재명만)
      // "삼승 프리미엄 닭다리살(1등급) 덩어리" → ["닭다리살"]
      const meaningfulTokens = tokens.filter(
        (t) => !SUPPLIER_BRANDS.has(t) && !GENERIC_MODIFIERS.has(t),
      )
      if (meaningfulTokens.length > 0) {
        for (const t of meaningfulTokens) {
          if (t.length >= 2 && t !== query) candidateKws.push(t)
        }
      }
      // 마지막 어절 fallback (의미있는 토큰이 없을 때만)
      if (candidateKws.length === 0 && tokens.length > 0) {
        const lastTok = tokens[tokens.length - 1]
        if (lastTok.length >= 2 && lastTok !== query) candidateKws.push(lastTok)
      }
      // 한국어 합성어 suffix/prefix 분해 (각 의미있는 토큰의)
      const subjectTok = meaningfulTokens.length > 0 ? meaningfulTokens[meaningfulTokens.length - 1] : tokens[tokens.length - 1]
      if (subjectTok && subjectTok.length >= 4) {
        // GENERIC_MODIFIERS substring 제거 (예: "신선한계란" → "계란", "특제소스" → "소스")
        // 토큰 자체는 GENERIC_MODIFIERS에 없지만 그 안에 modifier가 prefix/suffix로 붙은 경우
        let stripped = subjectTok
        for (const m of GENERIC_MODIFIERS) {
          if (stripped.startsWith(m) && stripped.length > m.length + 1) {
            stripped = stripped.slice(m.length)
          }
          if (stripped.endsWith(m) && stripped.length > m.length + 1) {
            stripped = stripped.slice(0, stripped.length - m.length)
          }
        }
        if (stripped !== subjectTok && stripped.length >= 2 && !candidateKws.includes(stripped)) {
          candidateKws.unshift(stripped)  // 가장 우선
        }
        for (let len = 3; len >= 2; len--) {
          const suffix = subjectTok.slice(subjectTok.length - len)
          if (!candidateKws.includes(suffix)) candidateKws.push(suffix)
        }
        for (let len = 3; len >= 2; len--) {
          const prefix = subjectTok.slice(0, len)
          if (!candidateKws.includes(prefix)) candidateKws.push(prefix)
        }
      }
      const coreKw = extractCoreKeyword(query)
      if (coreKw && coreKw !== query && coreKw.length >= 2 && !candidateKws.includes(coreKw)) {
        candidateKws.push(coreKw)
      }
      // fallback에서는 충분히 많이 가져오기 (정확한 매칭이 limit 밖에 있으면 누락 — 최종 sort 후 slice)
      const fbLimit = Math.max(limit * 3, 30)
      for (const fbKw of candidateKws) {
        try {
          const { data: fbData } = await supabase.rpc('search_products_hybrid', {
            search_term_raw: fbKw,
            search_term_clean: fbKw,
            limit_count: Math.min(fbLimit, 50),
            supplier_filter: supplier || undefined,
            bm25_weight: 0.5,
            semantic_weight: 0.5,
          })
          const fb = (fbData as RpcResult[] | null) ?? []
          const filteredFb = supplier ? fb.filter((p) => p.supplier === supplier) : fb
          const fbTopScore = filteredFb[0]?.match_score ?? 0
          // fallback 결과를 항상 누적 (>= 비교) — 토큰 매칭 sort에서 정확한 매칭이 위로 가도록
          // 예: "수수(상품)" → 1차에 "차수수 국내산" 없어도 "수수" fallback에서 가져와 누적
          if (fbTopScore >= topScore && filteredFb.length > 0) {
            // fallback 결과 누적 (sort 전이라 fbLimit으로 자르기)
            const seen = new Set(filteredFb.map((p) => p.id))
            results = [
              ...filteredFb,
              ...results.filter((p) => !seen.has(p.id)),
            ].slice(0, fbLimit)
            console.log(`  [Search] Fallback applied: "${query}" → "${fbKw}" (score ${topScore.toFixed(4)} → ${fbTopScore.toFixed(4)})`)
            // ⚠️ break 제거 — 모든 fallback 후보 시도해서 결과 누적 (예: 칼집비엔나 → 비엔나 + 칼집 둘 다)
          }
        } catch (e) {
          console.warn(`Fallback search "${fbKw}" 실패:`, e)
        }
      }

      // ILIKE 직접 쿼리 — RPC가 못 가져오는 substring 매칭 보강
      // 예: "수수" 검색 → trigram에서 "차수수 국내산" 누락 → ILIKE %수수%로 보강
      if (subjectTok && subjectTok.length >= 2) {
        try {
          // GENERIC_MODIFIERS 제거된 핵심어로 ILIKE
          let coreSearch = subjectTok
          for (const m of GENERIC_MODIFIERS) {
            if (coreSearch.startsWith(m) && coreSearch.length > m.length + 1) coreSearch = coreSearch.slice(m.length)
            if (coreSearch.endsWith(m) && coreSearch.length > m.length + 1) coreSearch = coreSearch.slice(0, coreSearch.length - m.length)
          }
          if (coreSearch.length >= 2) {
            const { data: likeData } = await supabase
              .from('products')
              .select('id, product_name, standard_price, unit_normalized, spec_quantity, spec_unit, supplier')
              .eq('supplier', supplier ?? 'SHINSEGAE')
              .or('is_active.eq.true,is_active.is.null') // 단종 제외, 레거시 NULL은 통과
              .ilike('product_name', `%${coreSearch}%`)
              .limit(100)
            if (likeData && likeData.length > 0) {
              const seen = new Set(results.map((p) => p.id))
              const likeResults: RpcResult[] = likeData
                .filter((p) => !seen.has(p.id as string))
                .map((p) => ({
                  id: p.id as string,
                  product_name: p.product_name as string,
                  standard_price: p.standard_price as number,
                  unit_normalized: p.unit_normalized as string,
                  spec_quantity: p.spec_quantity as number | null,
                  spec_unit: p.spec_unit as string | null,
                  supplier: p.supplier as string,
                  match_score: 0.001, // 낮은 점수 — 토큰 sort로 평가
                }))
              results = [...results, ...likeResults]
            }
          }
        } catch (e) {
          console.warn('ILIKE fallback 실패:', e)
        }
      }

      // 누적 결과를 토큰 매칭 비율로 재정렬 (정확한 매칭이 위로)
      // 예: "칼집비엔나" → "칼집비엔나 진주햄"(ratio=1.0)이 일반 "비엔나"(ratio=0.7)보다 위로
      results.sort((a, b) => {
        const aR = getTokenMatchRatio(query, a.product_name)
        const bR = getTokenMatchRatio(query, b.product_name)
        if (aR !== bR) return bR - aR
        return (b.match_score ?? 0) - (a.match_score ?? 0)
      })
      results = results.slice(0, limit)
    }

    // ── 자세한 규격 정보 enrichment (2026-05-04 추가) ──
    // RPC가 반환하지 않는 컬럼들 (product_code/spec_raw/origin/subcategory/storage_temp/tax_type)을 별도 SELECT로 fetch.
    const ids = results.map((p) => p.id).filter(Boolean)
    let extraMap: Record<string, {
      product_code?: string
      spec_raw?: string
      unit_raw?: string
      origin?: string
      origin_detail?: string
      category?: string
      subcategory?: string
      tax_type?: '과세' | '면세'
      storage_temp?: string
    }> = {}
    if (ids.length > 0) {
      const { data: extras } = await supabase
        .from('products')
        .select('id, product_code, spec_raw, unit_raw, origin, origin_detail, category, subcategory, tax_type, storage_temp')
        .in('id', ids)
      if (extras) {
        extraMap = Object.fromEntries(
          extras.map((e) => [
            e.id as string,
            {
              product_code: e.product_code as string | undefined,
              spec_raw: e.spec_raw as string | undefined,
              unit_raw: e.unit_raw as string | undefined,
              origin: e.origin as string | undefined,
              origin_detail: e.origin_detail as string | undefined,
              category: e.category as string | undefined,
              subcategory: e.subcategory as string | undefined,
              tax_type: e.tax_type as '과세' | '면세' | undefined,
              storage_temp: e.storage_temp as string | undefined,
            },
          ]),
        )
      }
    }

    const products = results.map((p) => {
      const extra = extraMap[p.id] ?? {}
      return {
        id: p.id,
        product_name: p.product_name,
        standard_price: p.standard_price,
        unit_normalized: p.unit_normalized,
        spec_quantity: p.spec_quantity ?? undefined,
        spec_unit: p.spec_unit ?? undefined,
        supplier: p.supplier as Supplier,
        match_score: p.match_score,
        // 자세한 규격 정보
        product_code: extra.product_code,
        spec_raw: extra.spec_raw,
        unit_raw: extra.unit_raw,
        origin: extra.origin,
        origin_detail: extra.origin_detail,
        category: extra.category,
        subcategory: extra.subcategory,
        tax_type: extra.tax_type,
        storage_temp: extra.storage_temp,
      }
    })

    return NextResponse.json<SearchProductsResponse>({
      success: true,
      products: products as unknown as MatchCandidate[],
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json<SearchProductsResponse>(
      { success: false, products: [], error: 'Internal server error' },
      { status: 500 }
    )
  }
}
