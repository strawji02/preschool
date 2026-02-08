import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('🚀 Starting browser...')
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  
  const page = await browser.newPage()
  
  try {
    console.log('🔗 Navigating to calc-food...')
    await page.goto('http://localhost:3000/calc-food', { timeout: 30000 })
    console.log('✅ Page loaded')
    
    // PDF 파일 업로드
    const pdfPath = path.resolve(__dirname, 'test-data/동행거래명세서_test_1770535079870.pdf')
    console.log('📄 Uploading PDF:', pdfPath)
    
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(pdfPath)
    console.log('✅ PDF uploaded')
    
    // 분석 완료 대기 (품목명 헤더가 보일 때까지)
    console.log('⏳ Waiting for analysis... (max 3 min)')
    await page.waitForSelector('text=품목명', { timeout: 180000 })
    console.log('✅ Analysis complete!')
    
    // 스크린샷 저장
    await page.screenshot({ path: 'test-results/matching-page.png', fullPage: true })
    console.log('📸 Screenshot saved to test-results/matching-page.png')
    
  } catch (e) {
    console.error('❌ Error:', e.message)
    await page.screenshot({ path: 'test-results/error-page.png', fullPage: true })
    console.log('📸 Error screenshot saved')
  }
  
  await browser.close()
  console.log('🏁 Done!')
}

main()
