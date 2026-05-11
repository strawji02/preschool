import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embedding'
import { expandWithSynonyms } from '@/lib/synonyms'
import { dualNormalize, extractCoreKeyword } from '@/lib/preprocessing'
import { getTokenMatchRatio, SUPPLIER_BRANDS, GENERIC_MODIFIERS, isProcessedProduct, cleanProductQuery } from '@/lib/token-match'
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
    // broad=true: 다중 필드 ILIKE (spec/origin/category/subcategory/supplier_partner)
    // — 신세계 DB 직접 검색용 (manual search). 자동 매칭은 사용 X (의미적 매칭 유지)
    const broad = searchParams.get('broad') === 'true'

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

    // Query 정제 (2026-05-10) — 검수 품목 OCR이 spec/원산지 메타를 포함한 긴 텍스트인 경우
    // BM25/임베딩이 노이즈 토큰("한국Wn※국내산"의 한국 → 한우 매칭)으로 깨지는 것 방지
    // broad mode (manual search)는 사용자 직접 입력이라 정제 X
    const cleanedQuery = broad ? query.trim() : cleanProductQuery(query.trim())

    // Synonym expansion for better search recall
    const { forKeyword } = dualNormalize(cleanedQuery)
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
        search_term_raw: cleanedQuery,
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
        const embedding = await generateEmbedding(cleanedQuery)
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

    // ── Fallback search (2026-05-04): 결과 점수 너무 낮으면 핵심 키워드로 재검색 ──
    // 예: "이츠웰아이누리 느타리버섯" → 무관한 결과 → 마지막 어절 "느타리버섯"으로 재검색
    // 한국어 식자재명 관행: 브랜드명이 앞에 오고 식자재명이 뒤에 옴
    // (2026-05-11) threshold 0.015 → 0.025로 상향 — '수수' 같은 짧은 query에서
    //              top score가 임계값 살짝 위로 떨어져 fallback 활성화 안 되는 케이스 대응
    // (2026-05-11) synonyms 동의어 있는 query는 무조건 fallback — '국물용멸치' BM25가 '국물/용' 분리로
    //              점수 높게 잡혀도 동의어 검색은 항상 필요 (국멸치/다시멸치 등 별도 매칭)
    const topScore = results[0]?.match_score ?? 0
    const hasSynonyms = synonymTerms.length > 1 && synonymTerms.some((s) => s.toLowerCase() !== forKeyword.toLowerCase())
    if ((topScore < 0.025 || hasSynonyms) && searchMode !== 'semantic') {
      // 후보 키워드 (우선순위):
      // 1) 마지막 어절 (예: "이츠웰 신선한계란" → "신선한계란")
      // 2) 마지막 어절의 suffix 2~3자 (한국어 합성어 분해, 예: "신선한계란" → "계란")
      // 3) extractCoreKeyword
      // (2026-05-11) cleanedQuery 사용 — raw에는 '팝콘치킨(약6g*(166±5)입' 같은 노이즈 토큰이 섞여
      // BM25 fallback이 무의미한 키워드로 검색 → 정답 후보 못 찾음
      // 1자 한국어 토큰 (쌀/무/콩/팥/파)도 식자재 핵심이므로 보존
      const tokens = cleanedQuery
        .split(/\s+/)
        .filter((t) => t.length >= 2 || /^[가-힣]$/.test(t))
      const candidateKws: string[] = []
      // brand/modifier 제외한 의미있는 토큰만 fallback 후보로 (식자재명만)
      // "삼승 프리미엄 닭다리살(1등급) 덩어리" → ["닭다리살"]
      const meaningfulTokens = tokens.filter(
        (t) => !SUPPLIER_BRANDS.has(t) && !GENERIC_MODIFIERS.has(t),
      )
      // (2026-05-11) 1자 한국어 식자재 토큰 (쌀/무/콩/팥/파)도 candidateKw로 허용
      const validKwLen = (t: string) => t.length >= 2 || /^[가-힣]$/.test(t)
      if (meaningfulTokens.length > 0) {
        for (const t of meaningfulTokens) {
          if (validKwLen(t) && t !== cleanedQuery) candidateKws.push(t)
        }
      }
      // (2026-05-11) synonym 동의어도 candidateKws에 추가 — '수수' → '차수수/찰수수' 별도 RPC 검색
      // BM25/trigram이 한국어 합성어 (차수수, 옥수수전분 등)를 단일 토큰으로 인식 못 하는 케이스 보강
      for (const syn of synonymTerms) {
        const synLower = syn.toLowerCase()
        if (validKwLen(synLower) && synLower !== cleanedQuery.toLowerCase() && !candidateKws.includes(synLower)) {
          candidateKws.push(synLower)
        }
      }
      // 마지막 어절 fallback (의미있는 토큰이 없을 때만)
      if (candidateKws.length === 0 && tokens.length > 0) {
        const lastTok = tokens[tokens.length - 1]
        if (validKwLen(lastTok) && lastTok !== cleanedQuery) candidateKws.push(lastTok)
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
      const coreKw = extractCoreKeyword(cleanedQuery)
      if (coreKw && coreKw !== cleanedQuery && coreKw.length >= 2 && !candidateKws.includes(coreKw)) {
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
          // (2026-05-11) fallback 결과 무조건 누적 — score 비교 제거
          // 동의어 fallback의 경우 BM25 score가 원본 query보다 낮을 수 있지만 토큰 매칭에는 적절
          // (예: "국물용멸치" → "국멸치" 동의어 검색 점수 낮아도 토큰 ratio 1.5로 정렬 상위)
          // 최종 sort에서 ratio로 정렬되므로 누적 후 sort에 위임
          if (filteredFb.length > 0) {
            const existing = new Set(results.map((p) => p.id))
            const newOnes = filteredFb.filter((p) => !existing.has(p.id))
            results = [...results, ...newOnes].slice(0, fbLimit)
          }
        } catch (e) {
          console.warn(`Fallback search "${fbKw}" 실패:`, e)
        }
      }

      // ILIKE 직접 쿼리 — RPC가 못 가져오는 substring 매칭 보강
      // 예: "수수" 검색 → trigram에서 "차수수 국내산" 누락 → ILIKE %수수%로 보강
      // (2026-05-11) 1자 한국어 식자재 (쌀/무/콩/팥/파)도 ILIKE fallback 허용
      if (subjectTok && (subjectTok.length >= 2 || /^[가-힣]$/.test(subjectTok))) {
        try {
          // GENERIC_MODIFIERS 제거된 핵심어로 ILIKE
          let coreSearch = subjectTok
          for (const m of GENERIC_MODIFIERS) {
            if (coreSearch.startsWith(m) && coreSearch.length > m.length + 1) coreSearch = coreSearch.slice(m.length)
            if (coreSearch.endsWith(m) && coreSearch.length > m.length + 1) coreSearch = coreSearch.slice(0, coreSearch.length - m.length)
          }
          if (coreSearch.length >= 2 || /^[가-힣]$/.test(coreSearch)) {
            const { data: likeData } = await supabase
              .from('products')
              .select('id, product_name, standard_price, unit_normalized, spec_quantity, spec_unit, supplier')
              .eq('supplier', supplier ?? 'SHINSEGAE')
              .or('is_active.eq.true,is_active.is.null') // 단종 제외, 레거시 NULL은 통과
              .or('is_food.eq.true,is_food.is.null') // 비식자재(용기/조리도구 등) 제외, NULL은 안전망 (2026-05-11)
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

      // ── broad search (manual search 전용) ──
      // 사용자가 spec/origin/category/품목군/협력사 키워드로 검색하는 경우 매칭 (예: "찌게용", "국내산", "주식회사명천")
      // 자동 매칭은 사용 X (의미적 매칭이 우선)
      if (broad) {
        try {
          const q = query.trim()
          if (q.length >= 2) {
            const { data: broadData } = await supabase
              .from('products')
              .select('id, product_name, standard_price, unit_normalized, spec_quantity, spec_unit, supplier')
              .eq('supplier', supplier ?? 'SHINSEGAE')
              .or('is_active.eq.true,is_active.is.null')
              .or('is_food.eq.true,is_food.is.null') // 비식자재 제외 (2026-05-11)
              .or(
                `product_name.ilike.%${q}%,spec_raw.ilike.%${q}%,origin.ilike.%${q}%,origin_detail.ilike.%${q}%,category.ilike.%${q}%,subcategory.ilike.%${q}%,supplier_partner.ilike.%${q}%`,
              )
              .limit(60)
            if (broadData && broadData.length > 0) {
              const seen = new Set(results.map((p) => p.id))
              const broadResults: RpcResult[] = broadData
                .filter((p) => !seen.has(p.id as string))
                .map((p) => ({
                  id: p.id as string,
                  product_name: p.product_name as string,
                  standard_price: p.standard_price as number,
                  unit_normalized: p.unit_normalized as string,
                  spec_quantity: p.spec_quantity as number | null,
                  spec_unit: p.spec_unit as string | null,
                  supplier: p.supplier as string,
                  match_score: 0.0005, // 가장 낮은 점수 — 토큰 정렬에서 product_name 매칭 우선
                }))
              results = [...results, ...broadResults]
            }
          }
        } catch (e) {
          console.warn('broad search 실패:', e)
        }
      }

      // 누적 결과를 토큰 매칭 비율로 재정렬 (정확한 매칭이 위로)
      // 예: "칼집비엔나" → "칼집비엔나 진주햄"(ratio=1.0)이 일반 "비엔나"(ratio=0.7)보다 위로
      // 동률 시: 가공품(한컵과일/샌드위치/도시락 등)을 후순위로 → 메인 식자재 우선
      // 단, 검색어 자체가 가공품 키워드면 적용 X (예: "한컵 사과" 검색 시 한컵류가 정답)
      // 정렬 (2026-05-10 강화):
      // 1) 토큰 매칭 비율에서 가공품 페널티 차감 (-0.3)
      //    → 가공품 ratio 0.6, 식자재 0.4 케이스에서도 식자재(0.4) > 가공품(0.3) 정렬
      //    → substring 매칭(1.5) 가공품도 1.2로 떨어져 식자재 1.0과 비슷한 영역
      // 2) 검수 query 자체가 가공품이면 페널티 X (정상 매칭 유지)
      // (2026-05-11) cleanedQuery 사용 — raw에는 "아이누리 쌀(엄선 20Kg/EA)" 같은 노이즈 토큰
      // 이 영향으로 ratio 계산이 부정확해짐. cleanedQuery는 "아이누리 쌀"로 정제되어 매칭 향상
      const queryIsProcessed = isProcessedProduct(cleanedQuery)
      const PROC_PENALTY = 0.3
      const adjusted = (name: string, baseRatio: number) =>
        !queryIsProcessed && isProcessedProduct(name) ? baseRatio - PROC_PENALTY : baseRatio
      results.sort((a, b) => {
        const aR = adjusted(a.product_name, getTokenMatchRatio(cleanedQuery, a.product_name))
        const bR = adjusted(b.product_name, getTokenMatchRatio(cleanedQuery, b.product_name))
        if (aR !== bR) return bR - aR
        return (b.match_score ?? 0) - (a.match_score ?? 0)
      })
      results = results.slice(0, limit)
    }

    // ── 단종 + 비식자재 품목 제외 (2026-05-09 단종, 2026-05-11 비식자재) ──
    // 모든 fallback search가 끝난 최종 결과 직후에 한 번 적용 (재추가 방지).
    // RPC가 is_active/is_food를 알지 못하므로 후처리로 차단. NULL은 active/식자재로 간주 (안전망).
    // 비식자재 = 용기/조리도구/유니폼/사무용품 등 (거래명세표는 식자재 only)
    if (results.length > 0) {
      const checkIds = results.map((p) => p.id).filter(Boolean)
      if (checkIds.length > 0) {
        const { data: activeData } = await supabase
          .from('products')
          .select('id, is_active, is_food')
          .in('id', checkIds)
        if (activeData) {
          const blocked = new Set(
            activeData
              .filter((r) => r.is_active === false || r.is_food === false)
              .map((r) => r.id as string),
          )
          if (blocked.size > 0) {
            results = results.filter((p) => !blocked.has(p.id))
          }
        }
      }
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
