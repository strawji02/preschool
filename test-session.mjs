import { chromium } from 'playwright'

async function main() {
  console.log('🚀 Starting browser...')
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  
  const page = await browser.newPage()
  
  try {
    // 기존 세션 ID로 바로 접근
    const sessionId = '601336bb-dcba-4c99-8da6-208b4b2b08ff'
    const url = `http://localhost:3000/calc-food?session=${sessionId}`
    console.log('🔗 Navigating to:', url)
    
    await page.goto(url, { timeout: 30000 })
    console.log('✅ Page loaded')
    
    // 잠시 대기 (데이터 로딩)
    await page.waitForTimeout(3000)
    
    // 스크린샷 저장
    await page.screenshot({ path: 'test-results/matching-page.png', fullPage: true })
    console.log('📸 Screenshot saved!')
    
  } catch (e) {
    console.error('❌ Error:', e.message)
  }
  
  await browser.close()
  console.log('🏁 Done!')
}

main()
