/**
 * UI 테스트: PDF 업로드 후 candidates 확인
 * 
 * Usage: npx playwright test scripts/test-ui-matching.ts
 */

import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  
  console.log('=== UI Matching Test ===\n')
  
  // 1. Navigate to calc-food
  console.log('1. Navigating to /calc-food...')
  await page.goto('http://localhost:3000/calc-food')
  await page.waitForSelector('text=명세서 업로드', { timeout: 10000 })
  console.log('   ✓ Page loaded\n')
  
  // 2. Upload PDF
  console.log('2. Uploading PDF...')
  const testPdf = path.join(__dirname, '../test-data/extracted/거래명세서/24년 10월 급식거래명세서_늘푸른/KakaoTalk_20241111_141556074.jpg')
  
  if (!fs.existsSync(testPdf)) {
    console.error('   ✗ Test PDF not found:', testPdf)
    await browser.close()
    return
  }
  
  // Click upload zone and set file
  const fileInput = await page.locator('input[type="file"]')
  await fileInput.setInputFiles(testPdf)
  console.log('   ✓ File uploaded\n')
  
  // 3. Wait for analysis
  console.log('3. Waiting for analysis...')
  try {
    await page.waitForSelector('text=분석 완료', { timeout: 60000 })
    console.log('   ✓ Analysis complete\n')
  } catch {
    console.log('   Checking for items...')
    await page.waitForTimeout(30000)
  }
  
  // 4. Take screenshot
  console.log('4. Taking screenshot...')
  await page.screenshot({ path: '/tmp/matching-test.png', fullPage: true })
  console.log('   ✓ Screenshot saved to /tmp/matching-test.png\n')
  
  // 5. Get items data from page
  console.log('5. Extracting items data...')
  const itemsData = await page.evaluate(() => {
    // Find all matching rows
    const rows = document.querySelectorAll('[class*="border-b"]')
    const items: any[] = []
    
    rows.forEach((row) => {
      const nameEl = row.querySelector('.truncate')
      if (nameEl) {
        const name = nameEl.textContent?.trim()
        
        // Get CJ candidates from dropdown or expanded area
        const cjCandidates = Array.from(row.querySelectorAll('[class*="orange"]'))
          .map(el => el.textContent?.trim())
          .filter(Boolean)
        
        // Get SSG candidates
        const ssgCandidates = Array.from(row.querySelectorAll('[class*="purple"]'))
          .map(el => el.textContent?.trim())
          .filter(Boolean)
        
        if (name) {
          items.push({
            extracted_name: name,
            cj_candidates: cjCandidates.slice(0, 5),
            ssg_candidates: ssgCandidates.slice(0, 5)
          })
        }
      }
    })
    
    return items
  })
  
  console.log('\n=== Extracted Items ===')
  itemsData.forEach((item, i) => {
    console.log(`\n${i + 1}. ${item.extracted_name}`)
    console.log(`   CJ: ${item.cj_candidates.join(', ') || '(없음)'}`)
    console.log(`   SSG: ${item.ssg_candidates.join(', ') || '(없음)'}`)
  })
  
  await browser.close()
  console.log('\n=== Test Complete ===')
}

main().catch(console.error)
