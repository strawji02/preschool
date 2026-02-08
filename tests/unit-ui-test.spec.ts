import { test, expect } from '@playwright/test'
import path from 'path'

test('단위 수정 UI 테스트', async ({ page }) => {
  // 1. calc-food 페이지 접속
  await page.goto('http://localhost:3000/calc-food')
  await page.waitForLoadState('networkidle')
  
  // 스크린샷 1: 초기 화면
  await page.screenshot({ path: 'test-results/01-upload-page.png', fullPage: true })
  
  // 2. PDF 파일 업로드
  const testPdfPath = path.resolve(__dirname, '../test-data/동행거래명세서_test_1770535079870.pdf')
  
  // 파일 선택을 위한 input 찾기
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(testPdfPath)
  
  // 3. 분석 완료 대기 (최대 3분)
  await page.waitForSelector('text=품목명', { timeout: 180000 })
  
  // 스크린샷 2: 매칭 화면
  await page.screenshot({ path: 'test-results/02-matching-page.png', fullPage: true })
  
  // 4. 단위 수정 UI 확인
  // "현재 급식 단가" 텍스트 확인
  await expect(page.locator('text=현재 급식 단가')).toBeVisible()
  
  // "단위 수정" 컬럼 확인
  await expect(page.locator('text=단위 수정')).toBeVisible()
  
  // 단위 드롭다운 확인 (첫 번째 select)
  const unitSelect = page.locator('select').first()
  await expect(unitSelect).toBeVisible()
  
  // 스크린샷 3: 단위 수정 UI 클로즈업
  await page.screenshot({ path: 'test-results/03-unit-ui.png', fullPage: true })
  
  console.log('✅ 테스트 완료!')
})
