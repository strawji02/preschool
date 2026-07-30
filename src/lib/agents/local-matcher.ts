/**
 * Local Matcher
 *
 * Supabase 대신 로컬 엑셀 파일을 사용하여 매칭합니다.
 * 신세계 DB 파일: test-data/extracted/키즈웰에듀푸드 단가_신세계푸드.xlsx
 */

import * as XLSX from 'xlsx'
import { stringSimilarity } from 'string-similarity-js'
import { normalizeText } from '@/lib/preprocessing'
import type { MatchCandidate } from './generator'

export interface LocalProduct {
  id: number
  product_name: string
  standard_price: number
  spec: string
  category?: string
}

let cachedProducts: LocalProduct[] | null = null

/**
 * 로컬 엑셀 파일에서 신세계 상품 로드
 */
export async function loadLocalProducts(filePath: string): Promise<LocalProduct[]> {
  if (cachedProducts) {
    return cachedProducts
  }

  try {
    const workbook = XLSX.readFile(filePath)
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(worksheet) as any[]

    cachedProducts = data.map((row, index) => ({
      id: index + 1,
      product_name: String(row['상품명'] || row['품목명'] || ''),
      standard_price: Number(row['단가'] || row['가격'] || 0),
      spec: String(row['규격'] || row['단위'] || ''),
      category: String(row['카테고리'] || row['분류'] || ''),
    }))

    console.log(`[LocalMatcher] Loaded ${cachedProducts.length} products from local file`)
    return cachedProducts
  } catch (error) {
    console.error('[LocalMatcher] Failed to load local products:', error)
    return []
  }
}

/**
 * 로컬 상품 검색
 */
export function searchLocalProducts(
  searchTerm: string,
  products: LocalProduct[],
  limit: number = 10
): MatchCandidate[] {
  const normalized = normalizeText(searchTerm).toLowerCase()

  // 텍스트 유사도 계산 및 정렬
  const scored = products.map(product => {
    const productName = normalizeText(product.product_name).toLowerCase()
    const similarity = stringSimilarity(normalized, productName)

    return {
      ...product,
      text_similarity: similarity,
      match_score: similarity,
    } as MatchCandidate
  })

  // 유사도 순 정렬 및 상위 N개 반환
  scored.sort((a, b) => (b.text_similarity || 0) - (a.text_similarity || 0))

  return scored.slice(0, limit)
}

/**
 * 여러 검색어로 병합 검색
 */
export function searchLocalProductsMulti(
  searchTerms: string[],
  products: LocalProduct[],
  limit: number = 10
): MatchCandidate[] {
  const allResults: MatchCandidate[] = []

  for (const term of searchTerms) {
    const results = searchLocalProducts(term, products, limit)
    allResults.push(...results)
  }

  // 중복 제거 (ID 기준)
  const uniqueResults = Array.from(
    new Map(allResults.map(item => [item.id, item])).values()
  )

  // 유사도 순 정렬
  uniqueResults.sort((a, b) => (b.text_similarity || 0) - (a.text_similarity || 0))

  return uniqueResults.slice(0, limit)
}

/**
 * Mock SupabaseClient for local mode
 */
export class LocalSupabaseClient {
  private products: LocalProduct[]

  constructor(products: LocalProduct[]) {
    this.products = products
  }

  from(table: string) {
    if (table !== 'ssg_products') {
      throw new Error('Only ssg_products table is supported in local mode')
    }

    return {
      select: (columns: string) => {
        return {
          ilike: (column: string, pattern: string) => {
            return {
              limit: (limit: number) => {
                const searchTerm = pattern.replace(/%/g, '')
                const results = searchLocalProducts(searchTerm, this.products, limit)
                return Promise.resolve({
                  data: results,
                  error: null,
                })
              },
            }
          },
          textSearch: (column: string, query: string, options: any) => {
            return {
              limit: (limit: number) => {
                const results = searchLocalProducts(query, this.products, limit)
                return Promise.resolve({
                  data: results,
                  error: null,
                })
              },
            }
          },
          limit: (limit: number) => {
            return Promise.resolve({
              data: this.products.slice(0, limit),
              error: null,
            })
          },
        }
      },
    }
  }
}
