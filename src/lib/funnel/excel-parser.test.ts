/**
 * Excel Parser Tests
 * Run with: npx tsx src/lib/funnel/excel-parser.test.ts
 */

import { detectColumns, normalizeInvoiceData } from './excel-parser'

console.log('🧪 Testing Excel Parser\n')

// ========================================
// Test 1: detectColumns - 한글 헤더
// ========================================
console.log('Test 1: detectColumns - 한글 헤더')
const test1 = detectColumns(['품명', '규격', '수량', '단가', '금액', '비고'])
console.log(`  Input: ['품명', '규격', '수량', '단가', '금액', '비고']`)
console.log(`  Result: ${JSON.stringify(test1)}`)
console.log(
  `  Expected: itemName=0, spec=1, quantity=2, unitPrice=3, amount=4, taxType=null`
)
console.log(
  `  ✅ ${
    test1.itemName === 0 &&
    test1.spec === 1 &&
    test1.quantity === 2 &&
    test1.unitPrice === 3 &&
    test1.amount === 4
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 2: detectColumns - 영문 헤더
// ========================================
console.log('Test 2: detectColumns - 영문 헤더')
const test2 = detectColumns(['Item Name', 'Spec', 'Qty', 'Unit Price', 'Total Amount'])
console.log(`  Input: ['Item Name', 'Spec', 'Qty', 'Unit Price', 'Total Amount']`)
console.log(`  Result: ${JSON.stringify(test2)}`)
console.log(
  `  Expected: itemName=0, spec=1, quantity=2, unitPrice=3, amount=4`
)
console.log(
  `  ✅ ${
    test2.itemName === 0 &&
    test2.spec === 1 &&
    test2.quantity === 2 &&
    test2.unitPrice === 3 &&
    test2.amount === 4
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 3: detectColumns - 과세 구분 포함
// ========================================
console.log('Test 3: detectColumns - 과세 구분 포함')
const test3 = detectColumns(['품명', '규격', '수량', '단가', '금액', '과세구분'])
console.log(`  Input: ['품명', '규격', '수량', '단가', '금액', '과세구분']`)
console.log(`  Result: ${JSON.stringify(test3)}`)
console.log(
  `  Expected: itemName=0, spec=1, quantity=2, unitPrice=3, amount=4, taxType=5`
)
console.log(
  `  ✅ ${
    test3.itemName === 0 &&
    test3.spec === 1 &&
    test3.quantity === 2 &&
    test3.unitPrice === 3 &&
    test3.amount === 4 &&
    test3.taxType === 5
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 4: detectColumns - 순서 바뀐 헤더
// ========================================
console.log('Test 4: detectColumns - 순서 바뀐 헤더')
const test4 = detectColumns(['금액', '품명', '단가', '수량', '규격'])
console.log(`  Input: ['금액', '품명', '단가', '수량', '규격']`)
console.log(`  Result: ${JSON.stringify(test4)}`)
console.log(
  `  Expected: itemName=1, spec=4, quantity=3, unitPrice=2, amount=0`
)
console.log(
  `  ✅ ${
    test4.itemName === 1 &&
    test4.spec === 4 &&
    test4.quantity === 3 &&
    test4.unitPrice === 2 &&
    test4.amount === 0
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 5: normalizeInvoiceData - 기본 케이스
// ========================================
console.log('Test 5: normalizeInvoiceData - 기본 케이스')
const test5 = normalizeInvoiceData(
  [
    ['양파', '1kg', 10, 5000, 50000],
    ['당근', '500g', 20, 3000, 60000],
  ],
  { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
)
console.log(`  Input: [['양파', '1kg', 10, 5000, 50000], ...]`)
console.log(`  Result length: ${test5.length}`)
console.log(`  First item: ${JSON.stringify(test5[0])}`)
console.log(
  `  Expected: { rowNumber: 1, itemName: '양파', spec: '1kg', quantity: 10, unitPrice: 5000, amount: 50000 }`
)
console.log(
  `  ✅ ${
    test5.length === 2 &&
    test5[0].itemName === '양파' &&
    test5[0].spec === '1kg' &&
    test5[0].quantity === 10 &&
    test5[0].unitPrice === 5000 &&
    test5[0].amount === 50000
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 6: normalizeInvoiceData - 과세 구분 포함
// ========================================
console.log('Test 6: normalizeInvoiceData - 과세 구분 포함')
const test6 = normalizeInvoiceData(
  [
    ['양파', '1kg', 10, 5000, 50000, '과세'],
    ['쌀', '20kg', 5, 40000, 200000, '면세'],
  ],
  { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: 5 }
)
console.log(`  Input: [['양파', '1kg', 10, 5000, 50000, '과세'], ...]`)
console.log(`  First item taxType: ${test6[0].taxType}`)
console.log(`  Second item taxType: ${test6[1].taxType}`)
console.log(`  Expected: '과세', '면세'`)
console.log(
  `  ✅ ${test6[0].taxType === '과세' && test6[1].taxType === '면세' ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Test 7: normalizeInvoiceData - 빈 행 필터링
// ========================================
console.log('Test 7: normalizeInvoiceData - 빈 행 필터링')
const test7 = normalizeInvoiceData(
  [
    ['양파', '1kg', 10, 5000, 50000],
    [], // 빈 행
    ['', '', '', '', ''], // 빈 값들
    ['당근', '500g', 20, 3000, 60000],
  ],
  { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
)
console.log(`  Input: 4개 행 (2개는 빈 행)`)
console.log(`  Result length: ${test7.length}`)
console.log(`  Expected: 2`)
console.log(`  ✅ ${test7.length === 2 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Test 8: normalizeInvoiceData - 숫자 변환
// ========================================
console.log('Test 8: normalizeInvoiceData - 숫자 변환 (쉼표 포함)')
const test8 = normalizeInvoiceData(
  [['양파', '1kg', '10', '5,000', '50,000']],
  { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
)
console.log(`  Input: [['양파', '1kg', '10', '5,000', '50,000']]`)
console.log(`  Result: ${JSON.stringify(test8[0])}`)
console.log(
  `  Expected: quantity=10, unitPrice=5000, amount=50000`
)
console.log(
  `  ✅ ${
    test8[0].quantity === 10 &&
    test8[0].unitPrice === 5000 &&
    test8[0].amount === 50000
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Edge Cases
// ========================================
console.log('Test 9: Edge Case - 품명 누락 시 스킵')
const test9 = normalizeInvoiceData(
  [['', '1kg', 10, 5000, 50000]], // 품명 없음
  { itemName: 0, spec: 1, quantity: 2, unitPrice: 3, amount: 4, taxType: null }
)
console.log(`  Input: 품명이 비어있는 행`)
console.log(`  Result length: ${test9.length}`)
console.log(`  Expected: 0 (스킵됨)`)
console.log(`  ✅ ${test9.length === 0 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 10: Edge Case - 필수 컬럼 누락')
const test10 = detectColumns(['품명', '비고', '메모'])
console.log(`  Input: ['품명', '비고', '메모']`)
console.log(`  Result: ${JSON.stringify(test10)}`)
console.log(
  `  Expected: itemName=0, 나머지 null`
)
console.log(
  `  ✅ ${
    test10.itemName === 0 &&
    test10.spec === null &&
    test10.quantity === null &&
    test10.unitPrice === null &&
    test10.amount === null
      ? 'PASS'
      : 'FAIL'
  }\n`
)

console.log('✅ All tests complete!')
