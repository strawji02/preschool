/**
 * Price Cluster Tests
 * Run with: npx tsx src/lib/funnel/price-cluster.test.ts
 */

import {
  getCategoryTolerance,
  calculatePriceRange,
  clusterByPrice,
  mergeClusters,
  calculatePriceDeviation,
  DBProduct,
} from './price-cluster'
import { InvoiceItem } from './excel-parser'

console.log('🧪 Testing Price Cluster\n')

// ========================================
// Test 1: getCategoryTolerance
// ========================================
console.log('Test 1: getCategoryTolerance - 농산물')
const test1 = getCategoryTolerance('농산물')
console.log(`  Input: '농산물'`)
console.log(`  Result: ${test1}%`)
console.log(`  Expected: 40%`)
console.log(`  ✅ ${test1 === 40 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 2: getCategoryTolerance - 축산물')
const test2 = getCategoryTolerance('축산물')
console.log(`  Input: '축산물'`)
console.log(`  Result: ${test2}%`)
console.log(`  Expected: 25%`)
console.log(`  ✅ ${test2 === 25 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 3: getCategoryTolerance - 가공품')
const test3 = getCategoryTolerance('가공품')
console.log(`  Input: '가공품'`)
console.log(`  Result: ${test3}%`)
console.log(`  Expected: 20%`)
console.log(`  ✅ ${test3 === 20 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 4: getCategoryTolerance - 기타 (기본값)')
const test4 = getCategoryTolerance('알 수 없음')
console.log(`  Input: '알 수 없음'`)
console.log(`  Result: ${test4}%`)
console.log(`  Expected: 30%`)
console.log(`  ✅ ${test4 === 30 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Test 2: calculatePriceRange
// ========================================
console.log('Test 5: calculatePriceRange - 47원/g 농산물')
const test5 = calculatePriceRange(47, '농산물')
console.log(`  Input: pricePerGram=47, category='농산물'`)
console.log(`  Result: min=${test5.min.toFixed(1)}, max=${test5.max.toFixed(1)}`)
console.log(`  Expected: min=28.2, max=65.8`)
console.log(
  `  ✅ ${
    Math.abs(test5.min - 28.2) < 0.1 && Math.abs(test5.max - 65.8) < 0.1
      ? 'PASS'
      : 'FAIL'
  }\n`
)

console.log('Test 6: calculatePriceRange - 100원/g 축산물')
const test6 = calculatePriceRange(100, '축산물')
console.log(`  Input: pricePerGram=100, category='축산물'`)
console.log(`  Result: min=${test6.min}, max=${test6.max}`)
console.log(`  Expected: min=75, max=125`)
console.log(`  ✅ ${test6.min === 75 && test6.max === 125 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 7: calculatePriceRange - 50원/g 가공품')
const test7 = calculatePriceRange(50, '가공품')
console.log(`  Input: pricePerGram=50, category='가공품'`)
console.log(`  Result: min=${test7.min}, max=${test7.max}`)
console.log(`  Expected: min=40, max=60`)
console.log(`  ✅ ${test7.min === 40 && test7.max === 60 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Test 3: clusterByPrice
// ========================================
console.log('Test 8: clusterByPrice - 범위 내/외 분류')

const invoiceItem: InvoiceItem = {
  rowNumber: 1,
  itemName: '양파',
  spec: '1kg',
  quantity: 10,
  unitPrice: 5000, // 5000원/kg = 5원/g
  amount: 50000,
}

const candidates: DBProduct[] = [
  { id: '1', name: '양파', spec: '1kg', price: 5000, category: '농산물' }, // 5원/g (범위 내)
  { id: '2', name: '양파', spec: '1kg', price: 7000, category: '농산물' }, // 7원/g (범위 내)
  { id: '3', name: '양파', spec: '1kg', price: 10000, category: '농산물' }, // 10원/g (범위 외)
  { id: '4', name: '양파', spec: '1kg', price: 2000, category: '농산물' }, // 2원/g (범위 외)
]

const test8 = clusterByPrice(invoiceItem, candidates)
console.log(`  Invoice: 양파 1kg, 5000원 (5원/g)`)
console.log(`  Category: 농산물 (±40%)`)
console.log(`  Price range: ${test8.priceRange.min.toFixed(1)}~${test8.priceRange.max.toFixed(1)}원/g`)
console.log(`  In range count: ${test8.inRange.length}`)
console.log(`  Out range count: ${test8.outRange.length}`)
console.log(`  In range IDs: ${test8.inRange.map(p => p.id).join(', ')}`)
console.log(`  Expected: 2 in range (id: 1, 2), 2 out range (id: 3, 4)`)
console.log(
  `  ✅ ${test8.inRange.length === 2 && test8.outRange.length === 2 ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Test 4: clusterByPrice - 축산물 케이스
// ========================================
console.log('Test 9: clusterByPrice - 축산물 (±25%)')

const invoiceItem2: InvoiceItem = {
  rowNumber: 2,
  itemName: '소고기',
  spec: '100g',
  quantity: 5,
  unitPrice: 10000, // 10000원/100g = 100원/g
  amount: 50000,
}

const candidates2: DBProduct[] = [
  { id: '1', name: '소고기', spec: '100g', price: 10000, category: '축산물' }, // 100원/g (범위 내)
  { id: '2', name: '소고기', spec: '100g', price: 12000, category: '축산물' }, // 120원/g (범위 내)
  { id: '3', name: '소고기', spec: '100g', price: 13000, category: '축산물' }, // 130원/g (범위 외)
  { id: '4', name: '소고기', spec: '100g', price: 7000, category: '축산물' }, // 70원/g (범위 외)
]

const test9 = clusterByPrice(invoiceItem2, candidates2)
console.log(`  Invoice: 소고기 100g, 10000원 (100원/g)`)
console.log(`  Category: 축산물 (±25%)`)
console.log(`  Price range: ${test9.priceRange.min}~${test9.priceRange.max}원/g`)
console.log(`  In range count: ${test9.inRange.length}`)
console.log(`  Out range count: ${test9.outRange.length}`)
console.log(`  In range IDs: ${test9.inRange.map(p => p.id).join(', ')}`)
console.log(`  Expected: 2 in range (id: 1, 2), 2 out range (id: 3, 4)`)
console.log(
  `  ✅ ${test9.inRange.length === 2 && test9.outRange.length === 2 ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Test 5: clusterByPrice - 가공품 케이스
// ========================================
console.log('Test 10: clusterByPrice - 가공품 (±20%)')

const invoiceItem3: InvoiceItem = {
  rowNumber: 3,
  itemName: '라면',
  spec: '120g',
  quantity: 30,
  unitPrice: 6000, // 6000원/120g = 50원/g
  amount: 180000,
}

const candidates3: DBProduct[] = [
  { id: '1', name: '라면', spec: '120g', price: 6000, category: '가공품' }, // 50원/g (범위 내)
  { id: '2', name: '라면', spec: '120g', price: 7000, category: '가공품' }, // 58.3원/g (범위 내)
  { id: '3', name: '라면', spec: '120g', price: 8000, category: '가공품' }, // 66.7원/g (범위 외)
  { id: '4', name: '라면', spec: '120g', price: 4000, category: '가공품' }, // 33.3원/g (범위 외)
]

const test10 = clusterByPrice(invoiceItem3, candidates3)
console.log(`  Invoice: 라면 120g, 6000원 (50원/g)`)
console.log(`  Category: 가공품 (±20%)`)
console.log(`  Price range: ${test10.priceRange.min}~${test10.priceRange.max}원/g`)
console.log(`  In range count: ${test10.inRange.length}`)
console.log(`  Out range count: ${test10.outRange.length}`)
console.log(`  In range IDs: ${test10.inRange.map(p => p.id).join(', ')}`)
console.log(`  Expected: 2 in range (id: 1, 2), 2 out range (id: 3, 4)`)
console.log(
  `  ✅ ${test10.inRange.length === 2 && test10.outRange.length === 2 ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Test 6: mergeClusters
// ========================================
console.log('Test 11: mergeClusters - 우선순위 병합')
const test11 = mergeClusters(test8)
console.log(`  Input: inRange=${test8.inRange.length}, outRange=${test8.outRange.length}`)
console.log(`  Result length: ${test11.length}`)
console.log(`  First 2 IDs: ${test11.slice(0, 2).map(p => p.id).join(', ')}`)
console.log(`  Last 2 IDs: ${test11.slice(-2).map(p => p.id).join(', ')}`)
console.log(`  Expected: 범위 내 먼저, 범위 외 나중`)
console.log(
  `  ✅ ${
    test11.length === 4 &&
    test8.inRange.includes(test11[0]) &&
    test8.inRange.includes(test11[1])
      ? 'PASS'
      : 'FAIL'
  }\n`
)

// ========================================
// Test 7: calculatePriceDeviation
// ========================================
console.log('Test 12: calculatePriceDeviation - 가격 편차')
const test12a = calculatePriceDeviation(100, 120)
const test12b = calculatePriceDeviation(100, 80)
console.log(`  100 vs 120: ${test12a}%`)
console.log(`  100 vs 80: ${test12b}%`)
console.log(`  Expected: 20%, -20%`)
console.log(`  ✅ ${test12a === 20 && test12b === -20 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Edge Cases
// ========================================
console.log('Test 13: Edge Case - 규격 파싱 실패 시 모두 범위 외')
const invoiceItem4: InvoiceItem = {
  rowNumber: 4,
  itemName: '알 수 없음',
  spec: '알수없음',
  quantity: 1,
  unitPrice: 1000,
  amount: 1000,
}

const test13 = clusterByPrice(invoiceItem4, candidates)
console.log(`  Invoice: 규격 파싱 불가`)
console.log(`  In range count: ${test13.inRange.length}`)
console.log(`  Out range count: ${test13.outRange.length}`)
console.log(`  Expected: 0 in range, all out range`)
console.log(
  `  ✅ ${test13.inRange.length === 0 && test13.outRange.length === candidates.length ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 14: Edge Case - 빈 후보 배열')
const test14 = clusterByPrice(invoiceItem, [])
console.log(`  Input: 빈 후보 배열`)
console.log(`  In range count: ${test14.inRange.length}`)
console.log(`  Out range count: ${test14.outRange.length}`)
console.log(`  Expected: 0, 0`)
console.log(
  `  ✅ ${test14.inRange.length === 0 && test14.outRange.length === 0 ? 'PASS' : 'FAIL'}\n`
)

console.log('✅ All tests complete!')
