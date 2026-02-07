import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizeItemName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function testMatching(filePath: string) {
  console.log(`\n📄 ${path.basename(filePath)}`)
  console.log('='.repeat(90))
  
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]
  
  const header = (data[0] || []).map(String)
  
  // "품명" 또는 "상품" 컬럼 찾기 (품목코드는 제외)
  let itemColIdx = header.findIndex((h: string) => 
    h && (h === '품명' || h === '상품' || h === '식재료명')
  )
  if (itemColIdx === -1) itemColIdx = 2 // 기본값
  
  console.log(`컬럼: [${header.slice(0, 6).join(', ')}] → 품목: "${header[itemColIdx]}" (col ${itemColIdx})`)
  
  let matched = 0, pending = 0, unmatched = 0
  const results: any[] = []
  
  for (let i = 1; i <= Math.min(15, data.length - 1); i++) {
    const row = data[i]
    if (!row || !row[itemColIdx]) continue
    
    const itemName = String(row[itemColIdx]).trim()
    if (!itemName || itemName.length < 2 || /^\d+$/.test(itemName)) continue
    
    const normalized = normalizeItemName(itemName)
    
    const { data: candidates } = await supabase.rpc('search_products_fuzzy', {
      search_term_raw: itemName,
      search_term_clean: normalized,
      limit_count: 3,
    })
    
    const topScore = candidates?.[0]?.match_score || 0
    const topMatch = candidates?.[0]?.product_name || '-'
    
    let status = '❌'
    if (topScore > 0.8) { status = '✅'; matched++ }
    else if (topScore >= 0.3) { status = '🟡'; pending++ }
    else { unmatched++ }
    
    results.push({ raw: itemName, score: topScore.toFixed(2), match: topMatch, status })
  }
  
  console.log('\n원본품목명                    | 점수 | DB 매칭결과                   | 상태')
  console.log('-'.repeat(90))
  results.forEach(r => {
    console.log(`${r.raw.substring(0,28).padEnd(28)} | ${r.score} | ${r.match.substring(0,28).padEnd(28)} | ${r.status}`)
  })
  
  const total = matched + pending + unmatched
  console.log(`\n📊 ✅ Auto: ${matched} (${total?((matched/total*100).toFixed(0)):0}%) | 🟡 Pending: ${pending} | ❌ Miss: ${unmatched}`)
  
  return { matched, pending, unmatched }
}

async function main() {
  const files = [
    './test-data/extracted/거래명세서/8월 급식 거래명세서_만안.xlsx',
    './test-data/extracted/거래명세서/9월 거래명세서_진아.xlsx',
  ]
  let m = 0, p = 0, u = 0
  
  for (const f of files) {
    const r = await testMatching(f)
    m += r.matched; p += r.pending; u += r.unmatched
  }
  
  console.log('\n' + '='.repeat(90))
  console.log(`🏆 전체: ✅ ${m} | 🟡 ${p} | ❌ ${u} (총 ${m+p+u}건)`)
  console.log(`   Auto-match율: ${((m/(m+p+u))*100).toFixed(1)}%`)
  console.log(`   Pending 포함: ${(((m+p)/(m+p+u))*100).toFixed(1)}%`)
}

main().catch(console.error)
