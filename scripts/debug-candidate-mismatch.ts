import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function debugCandidateMismatch() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1. Opening http://localhost:3000/calc-food');
    await page.goto('http://localhost:3000/calc-food');
    await page.waitForLoadState('networkidle');

    // Click "새로 시작" if exists (reset previous session)
    const resetButton = page.locator('button:has-text("새로 시작")');
    if (await resetButton.count() > 0) {
      console.log('1a. Clicking 새로 시작 to reset');
      await resetButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    }

    // Take initial screenshot
    await page.screenshot({ path: 'test-results/01-initial-page.png', fullPage: true });

    console.log('2. Uploading PDF file');
    // Use a fresh copy to force re-analysis
    const originalPdf = path.resolve(__dirname, '../test-data/동행거래명세서.pdf');
    const pdfPath = path.resolve(__dirname, '../test-data/동행거래명세서_test_' + Date.now() + '.pdf');
    const fs = await import('fs');
    fs.copyFileSync(originalPdf, pdfPath);

    // Find and click the file input
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(pdfPath);

    console.log('3. Waiting for analysis to complete (max 2 minutes)');
    // Wait for analysis to complete - look for MatchingRow items
    await page.waitForSelector('div.border-b:has(span.truncate.text-sm)', { timeout: 120000 });

    // Wait a bit more for all items to load
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/02-after-upload.png', fullPage: true });

    console.log('4. Looking for 깻잎 related items');
    // Get all MatchingRow items
    const itemRows = await page.locator('div.border-b:has(span.truncate.text-sm)').all();

    let targetItem = null;
    let targetIndex = -1;

    for (let i = 0; i < itemRows.length; i++) {
      const text = await itemRows[i].textContent();
      if (text && text.includes('깻잎')) {
        targetItem = itemRows[i];
        targetIndex = i;
        console.log(`Found 깻잎 item at index ${i}: ${text}`);
        break;
      }
    }

    if (!targetItem) {
      console.log('깻잎 not found. Searching for any item with "잎" or looking at all items...');
      // Take screenshot of all items
      await page.screenshot({ path: 'test-results/03-all-items.png', fullPage: true });

      // Print all item names found
      for (let i = 0; i < Math.min(itemRows.length, 10); i++) {
        const text = await itemRows[i].textContent();
        console.log(`Item ${i}: ${text}`);
      }

      throw new Error('깻잎 item not found in the list');
    }

    console.log('5. Capturing item details');

    // Highlight the target item
    await targetItem.scrollIntoViewIfNeeded();
    await targetItem.evaluate((el) => {
      el.style.border = '3px solid red';
      el.style.backgroundColor = '#ffff99';
    });

    await page.screenshot({ path: 'test-results/04-target-item-highlighted.png', fullPage: true });

    // Get extracted name
    const extractedNameElement = await targetItem.locator('span.truncate.text-sm').first();
    const extractedName = await extractedNameElement.textContent();
    console.log(`Extracted name: ${extractedName}`);

    // Find CJ dropdown button (first CandidateSelector)
    console.log('6. Opening CJ dropdown to see candidates');
    const cjDropdown = await targetItem.locator('button').nth(0); // First button in the row
    await cjDropdown.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/05-cj-dropdown-open.png', fullPage: true });

    // Get all dropdown options from the opened dropdown
    const cjOptions = await page.locator('div.absolute button p.text-sm.font-medium').allTextContents();
    console.log('CJ Dropdown candidates:', cjOptions);

    // Close CJ dropdown
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Find SSG dropdown button - look for the SSG price cell
    console.log('7. Opening SSG dropdown to see candidates');
    // SSG dropdown is typically the second dropdown with price
    const ssgCell = await targetItem.locator('button:has-text("/KG"), button:has-text("/EA"), button:has-text("/BAG")').nth(1);
    if (await ssgCell.count() > 0) {
      await ssgCell.click();
    } else {
      // Fallback: click on SSG column area
      const allButtons = await targetItem.locator('button').all();
      console.log('Total buttons in row:', allButtons.length);
      if (allButtons.length >= 4) {
        await allButtons[3].click(); // Usually 4th button is SSG dropdown
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/06-ssg-dropdown-open.png', fullPage: true });

    // Get SSG dropdown options
    const ssgOptions = await page.locator('div.absolute button p.text-sm.font-medium').allTextContents();
    console.log('SSG Dropdown candidates:', ssgOptions);

    // Check if 국내산 is in SSG results
    const hasNational = ssgOptions.some(opt => opt.includes('국내산'));
    console.log('SSG has 국내산:', hasNational ? '✅ YES!' : '❌ NO');

    // Find and click search button inside dropdown
    const searchInDropdown = await page.locator('button:has-text("다른 상품 검색")');
    if (await searchInDropdown.count() > 0) {
      console.log('8. Opening search modal from dropdown');
      await searchInDropdown.click();
      await page.waitForTimeout(1000);

      await page.screenshot({ path: 'test-results/07-search-modal.png', fullPage: true });

      // Get search results if modal is open
      const modalTitle = await page.locator('h2, [role="heading"]').allTextContents();
      console.log('Search modal titles:', modalTitle);
    }

    // Summary screenshot
    await page.screenshot({ path: 'test-results/07-final-state.png', fullPage: true });

    console.log('\n=== Summary ===');
    console.log(`Extracted name: ${extractedName}`);
    console.log('Screenshots saved in test-results/');
    console.log('- 01-initial-page.png: Initial page load');
    console.log('- 02-after-upload.png: After PDF upload and analysis');
    console.log('- 03-all-items.png: All items (if 깻잎 not found)');
    console.log('- 04-target-item-highlighted.png: Target 깻잎 item highlighted');
    console.log('- 05-dropdown-open.png: Dropdown candidates');
    console.log('- 06-search-modal.png: Search modal results');
    console.log('- 07-final-state.png: Final state');

  } catch (error) {
    console.error('Error during debugging:', error);
    await page.screenshot({ path: 'test-results/error-state.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

debugCandidateMismatch().catch(console.error);
