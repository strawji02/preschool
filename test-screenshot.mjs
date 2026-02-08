import { chromium } from 'playwright'

async function main() {
  console.log('🚀 Starting browser with no-sandbox...')
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  console.log('✅ Browser launched')
  
  const page = await browser.newPage()
  console.log('📄 New page created')
  
  try {
    console.log('🔗 Navigating to localhost:3000/calc-food...')
    await page.goto('http://localhost:3000/calc-food', { timeout: 30000 })
    console.log('✅ Page loaded')
    
    await page.screenshot({ path: 'test-results/screenshot.png', fullPage: true })
    console.log('📸 Screenshot saved to test-results/screenshot.png')
  } catch (e) {
    console.error('❌ Error:', e.message)
  }
  
  await browser.close()
  console.log('🏁 Done!')
}

main()
