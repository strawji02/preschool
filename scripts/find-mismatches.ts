#!/usr/bin/env tsx
/**
 * 실제 거래명세서에서 오매칭 케이스 찾기
 *
 * 목적: 실제 문제 사례 추출 → 테스트 케이스 강화
 */

import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { preprocessKoreanFoodName, dualNormalize, extractCategoryKeywords } from '../src/lib/preprocessing.js'
import * as fs from 'fs'
import * as path from 'path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface ExtractedItem {
  file: string
  row: number
  name: string
  spec?: string
  quantity?: number
  unit_price?: number
}

interface MatchResult {
  item: ExtractedItem
  top_match: {
    product_name: string
    match_score: number
    supplier: string
  } | null
  is_mismatch: boolean
  mismatch_reason?: string
}

// Excel 파일에서 품목명 추출
function extractItemsFromExcel(filePath: string): ExtractedItem[] {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]

  const items: ExtractedItem[] = []
  const fileName = path.basename(filePath)

  // 헤더 찾기
  let headerRow = -1
  const possibleHeaders = ['품명', '품목명', '제품명', '상품명', '물품명', '품목', '상품']

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i]
    if (!row) continue

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').trim()
      if (possibleHeaders.some(h => cell === h || cell.includes(h))) {
        headerRow = i
        break
      }
    }
    if (headerRow !== -1) break
  }

  if (headerRow === -1) {
    console.warn(`⚠️ ${fileName}: 헤더를 찾을 수 없음`)
    return items
  }

  const headers = data[headerRow].map((h: any) => String(h || '').trim())
  const nameColIndex = headers.findIndex((h: string) =>
    possibleHeaders.some(ph => h.includes(ph))
  )

  if (nameColIndex === -1) {
    console.warn(`⚠️ ${fileName}: 품목명 컬럼을 찾을 수 없음`)
    return items
  }

  // 데이터 추출 (헤더 다음 행부터)
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i]
    if (!row || row.length === 0) continue

    const name = String(row[nameColIndex] || '').trim()
    if (!name || name.length < 2) continue

    // 숫자만 있는 행 스킵
    if (/^\d+$/.test(name)) continue

    items.push({
      file: fileName,
      row: i + 1,
      name,
    })
  }

  return items
}

// Trigram 검색
async function searchTrigram(itemName: string): Promise<any> {
  const { forSemantic } = dualNormalize(itemName)
  const { data, error } = await supabase.rpc('search_products_fuzzy', {
    search_term_raw: itemName,
    search_term_clean: forSemantic,
    limit_count: 1,
  })

  if (error) {
    console.error('Search error:', error)
    return null
  }

  return data && data.length > 0 ? data[0] : null
}

// 카테고리 불일치 감지
function isCategoryMismatch(itemName: string, matchedName: string): boolean {
  const itemCategories = extractCategoryKeywords(itemName)
  const matchCategories = extractCategoryKeywords(matchedName)

  // 카테고리가 완전히 다르면 오매칭
  if (itemCategories.length > 0 && matchCategories.length > 0) {
    const hasCommon = itemCategories.some(c => matchCategories.includes(c))
    if (!hasCommon) {
      return true // 카테고리 불일치
    }
  }

  // 명시적 오매칭 패턴
  const mismatches = [
    { item: /만두/, match: /양동이|그릇|컵|용기/ },
    { item: /고기|육류/, match: /채소|과일|음료/ },
    { item: /채소/, match: /고기|육류|음료/ },
    { item: /과일/, match: /고기|육류|채소/ },
    { item: /우유|유제품/, match: /고기|채소|과일/ },
    { item: /라면|면류/, match: /고기|채소|과일/ },
  ]

  for (const { item, match } of mismatches) {
    if (item.test(itemName) && match.test(matchedName)) {
      return true
    }
  }

  return false
}

async function analyzeMatching() {
  console.log('\n🔍 실제 거래명세서 오매칭 분석\n')
  console.log('='.repeat(80))

  // 거래명세서 파일 목록
  const testDataDir = path.join(process.cwd(), 'test-data', 'extracted', '거래명세서')
  const files = fs.readdirSync(testDataDir)
    .filter(f => f.endsWith('.xlsx'))
    .map(f => path.join(testDataDir, f))

  console.log(`\n📂 분석 대상 파일: ${files.length}개\n`)

  const allItems: ExtractedItem[] = []
  const mismatches: MatchResult[] = []

  // 각 파일에서 품목 추출
  for (const filePath of files) {
    console.log(`📄 ${path.basename(filePath)} 읽는 중...`)
    const items = extractItemsFromExcel(filePath)
    console.log(`   → ${items.length}개 품목 추출`)
    allItems.push(...items)
  }

  console.log(`\n✅ 총 ${allItems.length}개 품목 추출됨`)
  console.log('\n' + '='.repeat(80))
  console.log('\n🔍 매칭 분석 시작...\n')

  // 각 품목 매칭 테스트
  let processedCount = 0
  const batchSize = 10

  for (let i = 0; i < allItems.length; i += batchSize) {
    const batch = allItems.slice(i, i + batchSize)

    await Promise.all(batch.map(async (item) => {
      try {
        const topMatch = await searchTrigram(item.name)

        if (!topMatch) {
          mismatches.push({
            item,
            top_match: null,
            is_mismatch: true,
            mismatch_reason: '매칭 결과 없음',
          })
          return
        }

        const isMismatch = isCategoryMismatch(item.name, topMatch.product_name)

        if (isMismatch) {
          mismatches.push({
            item,
            top_match: {
              product_name: topMatch.product_name,
              match_score: topMatch.match_score,
              supplier: topMatch.supplier,
            },
            is_mismatch: true,
            mismatch_reason: '카테고리 불일치',
          })
        }
      } catch (error) {
        console.error(`Error processing "${item.name}":`, error)
      }
    }))

    processedCount += batch.length
    process.stdout.write(`\r   진행: ${processedCount}/${allItems.length} (${Math.round(processedCount / allItems.length * 100)}%)`)
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('\n📊 오매칭 분석 결과\n')
  console.log('='.repeat(80))

  console.log(`\n총 분석: ${allItems.length}개`)
  console.log(`오매칭: ${mismatches.length}개 (${(mismatches.length / allItems.length * 100).toFixed(1)}%)`)

  if (mismatches.length === 0) {
    console.log('\n✅ 오매칭이 발견되지 않았습니다!')
    console.log('   → 현재 Trigram 매칭이 잘 작동하고 있습니다.')
    return
  }

  console.log('\n🚨 발견된 오매칭 케이스:\n')

  // 오매칭 케이스 출력
  mismatches.slice(0, 20).forEach((m, idx) => {
    console.log(`\n${idx + 1}. "${m.item.name}"`)
    console.log(`   파일: ${m.item.file} (Row ${m.item.row})`)
    if (m.top_match) {
      console.log(`   → Top 1: "${m.top_match.product_name}" (점수: ${m.top_match.match_score.toFixed(3)})`)
      console.log(`   ❌ 이유: ${m.mismatch_reason}`)
    } else {
      console.log(`   ❌ 이유: ${m.mismatch_reason}`)
    }
  })

  if (mismatches.length > 20) {
    console.log(`\n   ... 외 ${mismatches.length - 20}개 더`)
  }

  // 테스트 케이스 생성
  console.log('\n\n' + '='.repeat(80))
  console.log('\n📝 테스트 케이스 생성\n')
  console.log('='.repeat(80))

  const testCases = mismatches.slice(0, 10).map(m => {
    const itemCategories = extractCategoryKeywords(m.item.name)
    const category = itemCategories[0] || '기타'

    // 예상 키워드 추출
    const normalized = preprocessKoreanFoodName(m.item.name)
    const keywords = normalized.split(/\s+/).filter(k => k.length > 1)

    // 회피 키워드 (매칭된 품목에서 추출)
    const avoidKeywords: string[] = []
    if (m.top_match) {
      const matchNormalized = preprocessKoreanFoodName(m.top_match.product_name)
      const matchKeywords = matchNormalized.split(/\s+/).filter(k => k.length > 1)
      avoidKeywords.push(...matchKeywords.filter(k => !keywords.includes(k)))
    }

    return {
      query: m.item.name,
      expected_category: category,
      expected_keywords: keywords.slice(0, 3),
      avoid_keywords: avoidKeywords.slice(0, 3),
      source: `${m.item.file} Row ${m.item.row}`,
    }
  })

  console.log('\n```typescript')
  console.log('// 실제 오매칭 케이스 (자동 생성)')
  console.log('const REAL_MISMATCH_CASES = [')
  testCases.forEach(tc => {
    console.log('  {')
    console.log(`    query: '${tc.query}',`)
    console.log(`    expected_category: '${tc.expected_category}',`)
    console.log(`    expected_keywords: ${JSON.stringify(tc.expected_keywords)},`)
    console.log(`    avoid_keywords: ${JSON.stringify(tc.avoid_keywords)},`)
    console.log(`    // ${tc.source}`)
    console.log('  },')
  })
  console.log(']')
  console.log('```')

  console.log('\n✅ 테스트 케이스를 scripts/test-matching-phase1.ts에 추가하세요!')
}

analyzeMatching().catch(error => {
  console.error('분석 실패:', error)
  process.exit(1)
})
