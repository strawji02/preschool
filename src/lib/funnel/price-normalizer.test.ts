/**
 * Price Normalizer Tests
 * Run with: npx tsx src/lib/funnel/price-normalizer.test.ts
 */

import {
  extractWeight,
  normalizeToGram,
  calculatePricePerGram,
  calculatePricePerUnit,
} from './price-normalizer'

console.log('🧪 Testing Price Normalizer\n')

// ========================================
// Test 1: extractWeight - Basic Cases
// ========================================
console.log('Test 1: extractWeight - 2KG')
const test1 = extractWeight('2KG')
console.log(`  Input: '2KG'`)
console.log(`  Result: ${JSON.stringify(test1)}`)
console.log(`  Expected: { value: 2, unit: 'kg' }`)
console.log(
  `  ✅ ${test1?.value === 2 && test1?.unit === 'kg' ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 2: extractWeight - 500g')
const test2 = extractWeight('500g')
console.log(`  Input: '500g'`)
console.log(`  Result: ${JSON.stringify(test2)}`)
console.log(`  Expected: { value: 500, unit: 'g' }`)
console.log(
  `  ✅ ${test2?.value === 500 && test2?.unit === 'g' ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 3: extractWeight - 1박스(10kg)')
const test3 = extractWeight('1박스(10kg)')
console.log(`  Input: '1박스(10kg)'`)
console.log(`  Result: ${JSON.stringify(test3)}`)
console.log(`  Expected: { value: 10, unit: 'kg' }`)
console.log(
  `  ✅ ${test3?.value === 10 && test3?.unit === 'kg' ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 4: extractWeight - 20개입 (개수 단위)')
const test4 = extractWeight('20개입')
console.log(`  Input: '20개입'`)
console.log(`  Result: ${JSON.stringify(test4)}`)
console.log(`  Expected: { value: 20, unit: 'ea' }`)
console.log(
  `  ✅ ${test4?.value === 20 && test4?.unit === 'ea' ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Test 2: normalizeToGram
// ========================================
console.log('Test 5: normalizeToGram - 2kg → 2000g')
const test5 = normalizeToGram({ value: 2, unit: 'kg' })
console.log(`  Input: { value: 2, unit: 'kg' }`)
console.log(`  Result: ${test5}g`)
console.log(`  Expected: 2000g`)
console.log(`  ✅ ${test5 === 2000 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 6: normalizeToGram - 500g → 500g')
const test6 = normalizeToGram({ value: 500, unit: 'g' })
console.log(`  Input: { value: 500, unit: 'g' }`)
console.log(`  Result: ${test6}g`)
console.log(`  Expected: 500g`)
console.log(`  ✅ ${test6 === 500 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 7: normalizeToGram - 10kg → 10000g')
const test7 = normalizeToGram({ value: 10, unit: 'kg' })
console.log(`  Input: { value: 10, unit: 'kg' }`)
console.log(`  Result: ${test7}g`)
console.log(`  Expected: 10000g`)
console.log(`  ✅ ${test7 === 10000 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 8: normalizeToGram - 2L → 2000ml')
const test8 = normalizeToGram({ value: 2, unit: 'L' })
console.log(`  Input: { value: 2, unit: 'L' }`)
console.log(`  Result: ${test8}ml`)
console.log(`  Expected: 2000ml`)
console.log(`  ✅ ${test8 === 2000 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 9: normalizeToGram - 500ml → 500ml')
const test9 = normalizeToGram({ value: 500, unit: 'ml' })
console.log(`  Input: { value: 500, unit: 'ml' }`)
console.log(`  Result: ${test9}ml`)
console.log(`  Expected: 500ml`)
console.log(`  ✅ ${test9 === 500 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 10: normalizeToGram - 20ea → 20ea')
const test10 = normalizeToGram({ value: 20, unit: 'ea' })
console.log(`  Input: { value: 20, unit: 'ea' }`)
console.log(`  Result: ${test10}ea`)
console.log(`  Expected: 20ea`)
console.log(`  ✅ ${test10 === 20 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Test 3: calculatePricePerGram
// ========================================
console.log('Test 11: calculatePricePerGram - 10000원, 2KG → 5원/g')
const test11 = calculatePricePerGram(10000, '2KG')
console.log(`  Input: price=10000, spec='2KG'`)
console.log(`  Result: ${test11}원/g`)
console.log(`  Expected: 5원/g`)
console.log(`  ✅ ${test11 === 5 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 12: calculatePricePerGram - 5000원, 500g → 10원/g')
const test12 = calculatePricePerGram(5000, '500g')
console.log(`  Input: price=5000, spec='500g'`)
console.log(`  Result: ${test12}원/g`)
console.log(`  Expected: 10원/g`)
console.log(`  ✅ ${test12 === 10 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 13: calculatePricePerGram - 15000원, 1박스(10kg) → 1.5원/g')
const test13 = calculatePricePerGram(15000, '1박스(10kg)')
console.log(`  Input: price=15000, spec='1박스(10kg)'`)
console.log(`  Result: ${test13}원/g`)
console.log(`  Expected: 1.5원/g`)
console.log(`  ✅ ${test13 === 1.5 ? 'PASS' : 'FAIL'}\n`)

console.log('Test 14: calculatePricePerGram - 3000원, 20개입 → 150원/ea')
const test14 = calculatePricePerGram(3000, '20개입')
console.log(`  Input: price=3000, spec='20개입'`)
console.log(`  Result: ${test14}원/ea`)
console.log(`  Expected: 150원/ea`)
console.log(`  ✅ ${test14 === 150 ? 'PASS' : 'FAIL'}\n`)

// ========================================
// Test 4: calculatePricePerUnit (상세 정보)
// ========================================
console.log('Test 15: calculatePricePerUnit - 10000원, 2KG')
const test15 = calculatePricePerUnit(10000, '2KG')
console.log(`  Input: price=10000, spec='2KG'`)
console.log(`  Result: ${JSON.stringify(test15)}`)
console.log(
  `  Expected: { pricePerUnit: 5, unit: 'g', normalizedQuantity: 2000 }`
)
console.log(
  `  ✅ ${test15?.pricePerUnit === 5 && test15?.unit === 'g' && test15?.normalizedQuantity === 2000 ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 16: calculatePricePerUnit - 8000원, 2L')
const test16 = calculatePricePerUnit(8000, '2L')
console.log(`  Input: price=8000, spec='2L'`)
console.log(`  Result: ${JSON.stringify(test16)}`)
console.log(
  `  Expected: { pricePerUnit: 4, unit: 'ml', normalizedQuantity: 2000 }`
)
console.log(
  `  ✅ ${test16?.pricePerUnit === 4 && test16?.unit === 'ml' && test16?.normalizedQuantity === 2000 ? 'PASS' : 'FAIL'}\n`
)

console.log('Test 17: calculatePricePerUnit - 12000원, 10개')
const test17 = calculatePricePerUnit(12000, '10개')
console.log(`  Input: price=12000, spec='10개'`)
console.log(`  Result: ${JSON.stringify(test17)}`)
console.log(
  `  Expected: { pricePerUnit: 1200, unit: 'ea', normalizedQuantity: 10 }`
)
console.log(
  `  ✅ ${test17?.pricePerUnit === 1200 && test17?.unit === 'ea' && test17?.normalizedQuantity === 10 ? 'PASS' : 'FAIL'}\n`
)

// ========================================
// Edge Cases
// ========================================
console.log('Test 18: Edge Case - 빈 문자열')
const test18 = extractWeight('')
console.log(`  Input: ''`)
console.log(`  Result: ${test18}`)
console.log(`  Expected: null`)
console.log(`  ✅ ${test18 === null ? 'PASS' : 'FAIL'}\n`)

console.log('Test 19: Edge Case - 인식 불가능한 규격')
const test19 = calculatePricePerGram(10000, '알수없음')
console.log(`  Input: price=10000, spec='알수없음'`)
console.log(`  Result: ${test19}`)
console.log(`  Expected: null`)
console.log(`  ✅ ${test19 === null ? 'PASS' : 'FAIL'}\n`)

console.log('✅ All tests complete!')
