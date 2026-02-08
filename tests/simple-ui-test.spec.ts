import { test, expect } from '@playwright/test'

test('업로드 페이지 스크린샷', async ({ page }) => {
  await page.goto('/calc-food')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'test-results/upload-page.png', fullPage: true })
  
  // 기본 요소 확인
  await expect(page.locator('text=명세서 업로드')).toBeVisible()
  console.log('✅ 업로드 페이지 로드 완료!')
})
