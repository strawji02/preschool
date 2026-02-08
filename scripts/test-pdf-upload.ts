import { chromium } from 'playwright';
import path from 'path';

async function testPDFUpload() {
  console.log('🚀 Starting PDF upload test...');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Slow down for visibility
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Navigate to page
    console.log('📄 Navigating to http://localhost:3000/calc-food');
    await page.goto('http://localhost:3000/calc-food', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // 2. Take initial screenshot
    await page.screenshot({ path: 'test-results/initial-page.png', fullPage: true });
    console.log('✅ Initial screenshot saved');

    // 3. Find and upload PDF
    const pdfPath = path.resolve(__dirname, '../test-data/동행거래명세서.pdf');
    console.log(`📎 Uploading PDF from: ${pdfPath}`);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(pdfPath);
    console.log('✅ PDF file selected');

    // 4. Wait for analysis (max 120 seconds)
    console.log('⏳ Waiting for analysis to complete...');

    // Wait for the loading state to disappear
    try {
      await page.waitForSelector('text=/명세서 분석 중/', {
        state: 'detached',
        timeout: 120000
      });
      console.log('✅ Analysis loading state cleared');
    } catch (e) {
      console.log('⚠️ Still analyzing after 120 seconds');
    }

    // Wait a bit more for UI updates
    await page.waitForTimeout(3000);

    // Check if we're still on analyzing page
    const isStillAnalyzing = await page.locator('text=/명세서 분석 중/').count() > 0;
    if (isStillAnalyzing) {
      console.log('⚠️ Analysis still in progress');
    } else {
      console.log('✅ Analysis screen cleared');
    }

    // 5. Check for extracted items
    const pageContent = await page.content();
    const snapshot = await page.textContent('body');

    console.log('\n📊 Analysis Results:');
    console.log('='.repeat(50));

    // Check for item extraction indicators
    const hasItems = snapshot?.includes('품목') ||
                     snapshot?.includes('양파') ||
                     snapshot?.includes('당근') ||
                     snapshot?.includes('감자');

    if (hasItems) {
      console.log('✅ Items were extracted successfully!');

      // Try to find specific items
      const items = await page.locator('text=/양파|당근|감자|고구마/').allTextContents();
      if (items.length > 0) {
        console.log('📋 Found items:', items);
      }
    } else {
      console.log('❌ No items found in the page');
    }

    // 6. Take final screenshot
    await page.screenshot({ path: 'test-results/final-result.png', fullPage: true });
    console.log('✅ Final screenshot saved');

    // 7. Get console logs
    console.log('\n🔍 Browser Console Logs:');
    console.log('='.repeat(50));

    // Print any error messages
    const errorElements = await page.locator('text=/error|실패|failed/i').allTextContents();
    if (errorElements.length > 0) {
      console.log('⚠️ Errors found:', errorElements);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-results/error.png', fullPage: true });
  } finally {
    await browser.close();
    console.log('\n✅ Test completed');
  }
}

testPDFUpload().catch(console.error);
