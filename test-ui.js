const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('🌐 Navigating to localhost:3000...');
  await page.goto('http://localhost:3000/calc-food');
  await page.waitForTimeout(2000);
  
  // Upload PDF
  const pdfPath = path.resolve('./test-data/동행거래명세서_test_1770535079870.pdf');
  console.log('📄 Uploading PDF:', pdfPath);
  
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.setInputFiles(pdfPath);
    console.log('✅ PDF uploaded, waiting for analysis...');
  } else {
    console.log('❌ File input not found');
    await browser.close();
    return;
  }
  
  // Wait longer for matching grid (2 minutes)
  try {
    // Wait for text that appears in matching step
    await page.waitForSelector('text=매칭 결과', { timeout: 120000 });
    console.log('✅ Matching results appeared');
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('⏰ Timeout waiting for matching results, taking screenshot anyway');
  }
  
  // Take full page screenshot
  await page.screenshot({ path: 'test-results/unit-conversion-test.png', fullPage: true });
  console.log('📸 Full page screenshot saved');
  
  // Look for 환산불가 text
  const content = await page.textContent('body');
  if (content.includes('환산불가')) {
    console.log('✅ "환산불가" text found in page!');
  } else {
    console.log('⚠️ "환산불가" text not found');
  }
  
  // Check for price display patterns
  if (content.includes('원/')) {
    console.log('✅ Price conversion patterns found');
  }
  
  await browser.close();
  console.log('✅ Test complete');
})();
