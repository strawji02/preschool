/**
 * 메인 시드 스크립트
 * CJ, 신세계 단가표 엑셀 파일을 파싱하여 Supabase에 시드
 *
 * 사용법: npx tsx scripts/seed.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { normalizeUnit } from './lib/unit-normalizer'
import { parseCJSpec, parseShinsegaeSpec } from './lib/spec-parser'

// Supabase Admin 클라이언트 생성
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// 엑셀 파일 경로 (사용자 환경에 맞게 수정)
const CJ_FILE =
  '/Users/jun/Downloads/drive-download-20260201T072647Z-3-001/키즈웰에듀푸드 단가_CJ.xlsx'
const SHINSEGAE_FILE =
  '/Users/jun/Downloads/drive-download-20260201T072647Z-3-001/키즈웰에듀푸드 단가_신세계푸드.xlsx'

interface ProductInsert {
  supplier: 'CJ' | 'SHINSEGAE'
  product_code: string
  product_name: string
  standard_price: number
  unit_raw: string
  unit_normalized: string
  spec_raw: string | null
  spec_quantity: number | null
  spec_unit: string | null
  spec_parse_failed: boolean
  category: string | null
  subcategory: string | null
  origin: string | null
  tax_type: string | null
  storage_temp: string | null
  order_deadline: string | null
}

/**
 * CJ 데이터 시드
 */
async function seedCJ(): Promise<number> {
  console.log('📦 CJ 데이터 시드 시작...')

  const workbook = XLSX.readFile(CJ_FILE)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

  console.log(`   총 ${rows.length}개 행 발견`)

  const products: ProductInsert[] = rows
    .filter((row) => row['상품코드'] && row['상품명'])
    .map((row) => {
      const productName = String(row['상품명'] || '')
      const spec = parseCJSpec(productName)
      const rawUnit = String(row['단위'] || 'EA')

      return {
        supplier: 'CJ' as const,
        product_code: String(row['상품코드'] || ''),
        product_name: productName,
        standard_price: parseInt(String(row['판매단가'])) || 0,
        unit_raw: rawUnit,
        unit_normalized: normalizeUnit(rawUnit),
        spec_raw: productName,
        spec_quantity: spec.quantity,
        spec_unit: spec.unit,
        spec_parse_failed: spec.parseFailed,
        category: row['상세분류'] ? String(row['상세분류']) : null,
        subcategory: null,
        origin: row['원산지'] ? String(row['원산지']) : null,
        tax_type: row['과/면세'] ? String(row['과/면세']) : null,
        storage_temp: row['온도조건'] ? String(row['온도조건']) : null,
        order_deadline: row['마감일']
          ? `${row['마감일']} ${row['마감시간'] || ''}`.trim()
          : null,
      }
    })

  console.log(`   유효 상품 ${products.length}개 처리 중...`)

  // 배치 삽입 (1000개씩)
  const batchSize = 1000
  let insertedCount = 0

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize)
    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'supplier,product_code' })

    if (error) {
      console.error(`   ❌ CJ 배치 ${Math.floor(i / batchSize) + 1} 실패:`, error.message)
    } else {
      insertedCount += batch.length
      console.log(
        `   ✅ CJ 배치 ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} 완료`
      )
    }
  }

  // 파싱 실패 통계
  const failedCount = products.filter((p) => p.spec_parse_failed).length
  console.log(`   📊 규격 파싱: 성공 ${products.length - failedCount}개, 실패 ${failedCount}개`)

  console.log(`✅ CJ 총 ${insertedCount}개 상품 시드 완료\n`)
  return insertedCount
}

/**
 * 신세계 데이터 시드
 */
async function seedShinsegae(): Promise<number> {
  console.log('📦 신세계 데이터 시드 시작...')

  const workbook = XLSX.readFile(SHINSEGAE_FILE)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

  console.log(`   총 ${rows.length}개 행 발견`)

  const products: ProductInsert[] = rows
    .filter((row) => row['코드'] && row['품목명'])
    .map((row) => {
      const specRaw = row['규격'] ? String(row['규격']) : null
      const spec = parseShinsegaeSpec(specRaw || '')
      const rawUnit = String(row['단위'] || '개')

      return {
        supplier: 'SHINSEGAE' as const,
        product_code: String(row['코드'] || ''),
        product_name: String(row['품목명'] || ''),
        standard_price: parseInt(String(row['결정단가'])) || 0,
        unit_raw: rawUnit,
        unit_normalized: normalizeUnit(rawUnit),
        spec_raw: specRaw,
        spec_quantity: spec.quantity,
        spec_unit: spec.unit,
        spec_parse_failed: spec.parseFailed,
        category: row['카테고리'] ? String(row['카테고리']) : null,
        subcategory: row['품목군'] ? String(row['품목군']) : null,
        origin: row['원산지'] ? String(row['원산지']) : null,
        tax_type: row['과면세'] ? String(row['과면세']) : null,
        storage_temp: null,
        order_deadline: null,
      }
    })

  console.log(`   유효 상품 ${products.length}개 처리 중...`)

  // 배치 삽입 (1000개씩)
  const batchSize = 1000
  let insertedCount = 0

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize)
    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'supplier,product_code' })

    if (error) {
      console.error(`   ❌ 신세계 배치 ${Math.floor(i / batchSize) + 1} 실패:`, error.message)
    } else {
      insertedCount += batch.length
      console.log(
        `   ✅ 신세계 배치 ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} 완료`
      )
    }
  }

  // 파싱 실패 통계
  const failedCount = products.filter((p) => p.spec_parse_failed).length
  console.log(`   📊 규격 파싱: 성공 ${products.length - failedCount}개, 실패 ${failedCount}개`)

  console.log(`✅ 신세계 총 ${insertedCount}개 상품 시드 완료\n`)
  return insertedCount
}

/**
 * 단위 매핑 테이블 시드
 */
async function seedUnitMappings(): Promise<void> {
  console.log('📦 단위 매핑 시드...')

  const mappings = [
    // COUNT
    { raw_unit: 'EA', normalized_unit: 'EA', unit_category: 'COUNT' },
    { raw_unit: 'ea', normalized_unit: 'EA', unit_category: 'COUNT' },
    { raw_unit: '개', normalized_unit: 'EA', unit_category: 'COUNT' },
    { raw_unit: '마리', normalized_unit: 'EA', unit_category: 'COUNT' },
    { raw_unit: '판', normalized_unit: 'EA', unit_category: 'COUNT' },
    { raw_unit: '입', normalized_unit: 'EA', unit_category: 'COUNT' },
    // WEIGHT
    { raw_unit: 'KG', normalized_unit: 'KG', unit_category: 'WEIGHT' },
    { raw_unit: 'kg', normalized_unit: 'KG', unit_category: 'WEIGHT' },
    { raw_unit: 'Kg', normalized_unit: 'KG', unit_category: 'WEIGHT' },
    { raw_unit: 'G', normalized_unit: 'G', unit_category: 'WEIGHT' },
    { raw_unit: 'g', normalized_unit: 'G', unit_category: 'WEIGHT' },
    // PACKAGE
    { raw_unit: 'BOX', normalized_unit: 'BOX', unit_category: 'PACKAGE' },
    { raw_unit: 'box', normalized_unit: 'BOX', unit_category: 'PACKAGE' },
    { raw_unit: '박스', normalized_unit: 'BOX', unit_category: 'PACKAGE' },
    { raw_unit: '팩', normalized_unit: 'PACK', unit_category: 'PACKAGE' },
    { raw_unit: 'PACK', normalized_unit: 'PACK', unit_category: 'PACKAGE' },
    { raw_unit: '봉', normalized_unit: 'BAG', unit_category: 'PACKAGE' },
    { raw_unit: '포', normalized_unit: 'BAG', unit_category: 'PACKAGE' },
    // VOLUME
    { raw_unit: 'L', normalized_unit: 'L', unit_category: 'VOLUME' },
    { raw_unit: 'l', normalized_unit: 'L', unit_category: 'VOLUME' },
    { raw_unit: 'ML', normalized_unit: 'ML', unit_category: 'VOLUME' },
    { raw_unit: 'ml', normalized_unit: 'ML', unit_category: 'VOLUME' },
    { raw_unit: '병', normalized_unit: 'BOTTLE', unit_category: 'VOLUME' },
  ]

  const { error } = await supabase
    .from('unit_mappings')
    .upsert(mappings, { onConflict: 'raw_unit' })

  if (error) {
    console.error('❌ 단위 매핑 시드 실패:', error.message)
  } else {
    console.log(`✅ 단위 매핑 ${mappings.length}개 시드 완료\n`)
  }
}

/**
 * 시드 후 통계 출력
 */
async function printStats(): Promise<void> {
  console.log('📊 시드 결과 통계')
  console.log('─'.repeat(40))

  // 공급사별 상품 수
  const { count: cjCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('supplier', 'CJ')

  const { count: shinsegaeCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('supplier', 'SHINSEGAE')

  console.log(`CJ 상품: ${cjCount?.toLocaleString()}개`)
  console.log(`신세계 상품: ${shinsegaeCount?.toLocaleString()}개`)
  console.log(`총 상품: ${((cjCount || 0) + (shinsegaeCount || 0)).toLocaleString()}개`)

  // 규격 파싱 실패 건수
  const { count: parseFailedCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('spec_parse_failed', true)

  console.log(`규격 파싱 실패: ${parseFailedCount?.toLocaleString()}개`)

  // 단위별 분포
  const { data: unitStats } = await supabase.rpc('get_unit_stats').select('*')
  if (unitStats) {
    console.log('\n단위별 분포:')
    unitStats.slice(0, 10).forEach((stat: { unit: string; count: number }) => {
      console.log(`  ${stat.unit}: ${stat.count.toLocaleString()}개`)
    })
  }
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  console.log('🚀 시드 스크립트 시작')
  console.log('═'.repeat(40))
  console.log()

  // 환경 변수 확인
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL 환경 변수가 설정되지 않았습니다.')
    process.exit(1)
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다.')
    process.exit(1)
  }

  try {
    // 단위 매핑 시드
    await seedUnitMappings()

    // CJ 데이터 시드
    await seedCJ()

    // 신세계 데이터 시드
    await seedShinsegae()

    // 통계 출력
    await printStats()

    console.log()
    console.log('═'.repeat(40))
    console.log('🎉 모든 시드 완료!')
  } catch (error) {
    console.error('❌ 시드 중 오류 발생:', error)
    process.exit(1)
  }
}

// 스크립트 실행
main()
