/**
 * PPU Calculator Tests
 * Run with: npx tsx scripts/lib/ppu-calculator.test.ts
 */
import { calculateCJPPU, calculateShinsegaePPU, calculatePPUFromSpec } from './ppu-calculator'

console.log('🧪 Testing PPU Calculator\n')

// Test 1: CJ with valid g당 column
console.log('Test 1: CJ with valid 단가(g당) column')
const test1 = calculateCJPPU(10000, 5.5, 1000, 'g')
console.log(`  Input: price=10000, pricePerGram=5.5, spec=1000g`)
console.log(`  Result: standard_unit=${test1.standardUnit}, ppu=${test1.ppu}`)
console.log(`  Expected: standard_unit=g, ppu=5.5`)
console.log(`  ✅ ${test1.standardUnit === 'g' && test1.ppu === 5.5 ? 'PASS' : 'FAIL'}\n`)

// Test 2: CJ with zero g당 column (calculate from spec)
console.log('Test 2: CJ with zero 단가(g당) - calculate from spec')
const test2 = calculateCJPPU(10000, 0, 1000, 'g')
console.log(`  Input: price=10000, pricePerGram=0, spec=1000g`)
console.log(`  Result: standard_unit=${test2.standardUnit}, ppu=${test2.ppu}`)
console.log(`  Expected: standard_unit=g, ppu=10 (10000/1000)`)
console.log(`  ✅ ${test2.standardUnit === 'g' && test2.ppu === 10 ? 'PASS' : 'FAIL'}\n`)

// Test 3: CJ with kg spec
console.log('Test 3: CJ with kg spec (convert to g)')
const test3 = calculateCJPPU(15000, null, 1.5, 'kg')
console.log(`  Input: price=15000, pricePerGram=null, spec=1.5kg`)
console.log(`  Result: standard_unit=${test3.standardUnit}, ppu=${test3.ppu}`)
console.log(`  Expected: standard_unit=g, ppu=10 (15000/1500g)`)
console.log(`  ✅ ${test3.standardUnit === 'g' && test3.ppu === 10 ? 'PASS' : 'FAIL'}\n`)

// Test 4: Shinsegae with L spec (convert to ml)
console.log('Test 4: Shinsegae with L spec (convert to ml)')
const test4 = calculateShinsegaePPU(8000, 2, 'L')
console.log(`  Input: price=8000, spec=2L`)
console.log(`  Result: standard_unit=${test4.standardUnit}, ppu=${test4.ppu}`)
console.log(`  Expected: standard_unit=ml, ppu=4 (8000/2000ml)`)
console.log(`  ✅ ${test4.standardUnit === 'ml' && test4.ppu === 4 ? 'PASS' : 'FAIL'}\n`)

// Test 5: Shinsegae with ml spec
console.log('Test 5: Shinsegae with ml spec')
const test5 = calculateShinsegaePPU(5000, 500, 'ml')
console.log(`  Input: price=5000, spec=500ml`)
console.log(`  Result: standard_unit=${test5.standardUnit}, ppu=${test5.ppu}`)
console.log(`  Expected: standard_unit=ml, ppu=10 (5000/500)`)
console.log(`  ✅ ${test5.standardUnit === 'ml' && test5.ppu === 10 ? 'PASS' : 'FAIL'}\n`)

// Test 6: Parse failure (ea fallback)
console.log('Test 6: Parse failure - fallback to ea')
const test6 = calculatePPUFromSpec(3000, null, null)
console.log(`  Input: price=3000, spec=null`)
console.log(`  Result: standard_unit=${test6.standardUnit}, ppu=${test6.ppu}`)
console.log(`  Expected: standard_unit=ea, ppu=3000 (per ea)`)
console.log(`  ✅ ${test6.standardUnit === 'ea' && test6.ppu === 3000 ? 'PASS' : 'FAIL'}\n`)

// Test 7: EA unit
console.log('Test 7: EA unit (count items)')
const test7 = calculatePPUFromSpec(12000, 10, 'ea')
console.log(`  Input: price=12000, spec=10ea`)
console.log(`  Result: standard_unit=${test7.standardUnit}, ppu=${test7.ppu}`)
console.log(`  Expected: standard_unit=ea, ppu=1200 (12000/10)`)
console.log(`  ✅ ${test7.standardUnit === 'ea' && test7.ppu === 1200 ? 'PASS' : 'FAIL'}\n`)

console.log('✅ All tests complete!')
