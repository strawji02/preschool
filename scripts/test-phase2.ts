import fs from 'fs'
import path from 'path'

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api'

interface InitResponse {
  success: boolean
  session_id?: string
  message?: string
}

interface AnalyzeResponse {
  success: boolean
  page_number: number
  items: Array<{
    id: string
    extracted_name: string
    extracted_spec?: string
    extracted_quantity: number
    extracted_unit_price: number
    matched_product?: {
      id: string
      product_name: string
      standard_price: number
      supplier: string  // 추가
    }
    match_score?: number
    match_status: string
    match_candidates?: Array<{
      product_name: string
      match_score: number
      supplier: string  // 추가
    }>
    loss_amount?: number
  }>
  error?: string
}

interface SearchResponse {
  success: boolean
  products: Array<{
    product_name: string
    match_score: number
    supplier: string  // 추가
  }>
}

async function testPhase2(imagePath: string) {
  console.log('🧪 Phase 2 E2E 테스트 시작 (Savings Analysis 피벗 버전)\n')

  // 1. 이미지 파일 읽기
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ 파일을 찾을 수 없습니다: ${imagePath}`)
    process.exit(1)
  }

  const imageBuffer = fs.readFileSync(imagePath)
  const base64Image = imageBuffer.toString('base64')
  console.log(`✅ 이미지 로드: ${path.basename(imagePath)} (${imageBuffer.length} bytes)\n`)

  // 2. 세션 생성 (supplier 없이 - 3rd party 명세서 분석)
  console.log('📋 Step 1: 세션 생성 (3rd Party 명세서 분석)...')
  const initRes = await fetch(`${API_BASE}/session/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '절감 분석 테스트',
      // supplier 없음 - 전체 DB 검색
      total_pages: 1,
    }),
  })
  const initData: InitResponse = await initRes.json()

  if (!initData.success || !initData.session_id) {
    console.error(`❌ 세션 생성 실패: ${initData.message}`)
    process.exit(1)
  }
  console.log(`   Session ID: ${initData.session_id}\n`)

  // 3. 페이지 분석
  console.log('🔍 Step 2: 페이지 분석 (OCR + 전체 DB 매칭)...')
  const startTime = Date.now()

  const analyzeRes = await fetch(`${API_BASE}/analyze/page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: initData.session_id,
      page_number: 1,
      image: base64Image,
    }),
  })
  const analyzeData: AnalyzeResponse = await analyzeRes.json()

  const elapsedTime = Date.now() - startTime
  console.log(`   ⏱️  처리 시간: ${elapsedTime}ms`)

  if (!analyzeData.success) {
    console.error(`❌ 분석 실패: ${analyzeData.error}`)
    process.exit(1)
  }

  console.log(`   추출된 품목: ${analyzeData.items.length}개\n`)

  // 4. 결과 출력
  console.log('📊 Step 3: 절감 분석 결과')
  console.log('─'.repeat(80))

  let autoMatched = 0
  let pending = 0
  let unmatched = 0
  let totalSavings = 0

  for (const item of analyzeData.items) {
    const statusIcon: Record<string, string> = {
      auto_matched: '🟢',
      pending: '🟡',
      unmatched: '🔴',
      manual_matched: '🔵',
    }

    console.log(`${statusIcon[item.match_status] || '⚪'} ${item.extracted_name}`)
    console.log(`   수량: ${item.extracted_quantity}, 청구단가: ${item.extracted_unit_price.toLocaleString()}원`)

    if (item.matched_product) {
      console.log(`   📦 매칭: ${item.matched_product.product_name} (${item.matched_product.supplier})`)
      console.log(`   기준단가: ${item.matched_product.standard_price.toLocaleString()}원`)
      const savings = item.loss_amount ?? 0
      totalSavings += savings
      if (savings > 0) {
        console.log(`   💰 절감 가능: ${savings.toLocaleString()}원`)
      }
    }

    if (item.match_candidates && item.match_candidates.length > 0) {
      console.log(`   후보: ${item.match_candidates.length}개`)
      item.match_candidates.slice(0, 3).forEach((c) => {
        console.log(`     - ${c.product_name} (${c.supplier}, ${(c.match_score * 100).toFixed(1)}%)`)
      })
    }

    console.log('')

    if (item.match_status === 'auto_matched') autoMatched++
    else if (item.match_status === 'pending') pending++
    else unmatched++
  }

  // 5. 통계
  console.log('─'.repeat(80))
  console.log('📈 분석 통계:')
  console.log(`   🟢 자동 매칭: ${autoMatched}건`)
  console.log(`   🟡 후보 제시: ${pending}건`)
  console.log(`   🔴 매칭 없음: ${unmatched}건`)
  console.log(`   💰 총 절감 가능액: ${totalSavings.toLocaleString()}원`)
  console.log('')

  // 6. Fuzzy 검색 테스트 (전체 DB)
  console.log('🔎 Step 4: 전체 DB 검색 API 테스트...')
  const searchRes = await fetch(
    `${API_BASE}/products/search?q=배추&limit=5`
  )
  const searchData: SearchResponse = await searchRes.json()

  if (searchData.success) {
    console.log(`   검색 결과: ${searchData.products.length}개 (전체 DB)`)
    for (const p of searchData.products.slice(0, 5)) {
      console.log(`   - ${p.product_name} (${p.supplier}, ${(p.match_score * 100).toFixed(1)}%)`)
    }
  } else {
    console.log('   ⚠️  검색 테스트 실패')
  }

  console.log('\n✅ Phase 2 Savings Analysis 테스트 완료!')
  console.log(`\n📝 요약:`)
  console.log(`   - 세션 ID: ${initData.session_id}`)
  console.log(`   - 처리 시간: ${elapsedTime}ms ${elapsedTime > 10000 ? '⚠️ (10초 초과!)' : '✅'}`)
  console.log(`   - 추출 품목: ${analyzeData.items.length}개`)
  console.log(`   - 자동 매칭률: ${analyzeData.items.length > 0 ? ((autoMatched / analyzeData.items.length) * 100).toFixed(1) : 0}%`)
  console.log(`   - 총 절감 가능액: ${totalSavings.toLocaleString()}원`)
}

// CLI 실행
const imagePath = process.argv[2]
if (!imagePath) {
  console.error('사용법: npx tsx scripts/test-phase2.ts <이미지경로>')
  console.error('예시: npx tsx scripts/test-phase2.ts ./test-invoice.jpg')
  process.exit(1)
}

testPhase2(imagePath).catch((error) => {
  console.error('테스트 오류:', error)
  process.exit(1)
})
