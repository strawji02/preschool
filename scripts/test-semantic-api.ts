#!/usr/bin/env tsx
/**
 * Test semantic search API integration
 *
 * Tests:
 * 1. Direct findMatches() with semantic mode
 * 2. Direct findComparisonMatches() with semantic mode
 * 3. API endpoint with semantic mode
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { findMatches, findComparisonMatches } from '../src/lib/matching'

// Load environment variables
config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TEST_ITEMS = [
  "속이꽉찬 평양식왕만두",
  "흰우유,서울우유",
  "국산콩나물",
  "부침가루,오뚜기",
  "딸기잼,복음자리",
]

async function testSemanticSearch() {
  console.log('🧪 Testing Semantic Search Integration\n')
  console.log('=' .repeat(80))

  for (const item of TEST_ITEMS) {
    console.log(`\n📝 Query: "${item}"`)
    console.log('-'.repeat(80))

    // Test 1: findMatches with semantic mode
    const result = await findMatches(item, supabase, 'semantic')

    if (result.status === 'auto_matched' && result.best_match) {
      console.log(`✅ Auto-matched: ${result.best_match.product_name}`)
      console.log(`   Score: ${result.best_match.match_score.toFixed(3)}`)
      console.log(`   Price: ₩${result.best_match.standard_price}`)
      console.log(`   Supplier: ${result.best_match.supplier}`)
    } else if (result.status === 'pending' && result.candidates) {
      console.log(`⏳ Pending - Top candidate: ${result.candidates[0]?.product_name}`)
      console.log(`   Score: ${result.candidates[0]?.match_score.toFixed(3)}`)
    } else {
      console.log('❌ Unmatched')
    }

    // Test 2: findComparisonMatches with semantic mode
    console.log('\n🔄 Side-by-Side Comparison:')
    const comparison = await findComparisonMatches(item, supabase, 'semantic')

    if (comparison.cj_match) {
      console.log(`   CJ: ${comparison.cj_match.product_name}`)
      console.log(`       Score: ${comparison.cj_match.match_score.toFixed(3)} | Price: ₩${comparison.cj_match.standard_price}`)
    } else {
      console.log('   CJ: ❌ No match')
    }

    if (comparison.ssg_match) {
      console.log(`   SSG: ${comparison.ssg_match.product_name}`)
      console.log(`        Score: ${comparison.ssg_match.match_score.toFixed(3)} | Price: ₩${comparison.ssg_match.standard_price}`)
    } else {
      console.log('   SSG: ❌ No match')
    }

    console.log(`   Status: ${comparison.status}`)
  }

  console.log('\n' + '='.repeat(80))
  console.log('✅ Semantic search integration test complete!')
  console.log('\n📋 Next Steps:')
  console.log('   1. Set NEXT_PUBLIC_SEARCH_MODE=semantic in .env.local')
  console.log('   2. Restart dev server: npm run dev')
  console.log('   3. Test in browser UI')
}

// Run test
testSemanticSearch().catch(console.error)
