#!/bin/bash
# 모든 상품 임베딩 생성 (자동 반복)

cd ~/github/preschool
export $(grep -v '^#' .env.local | xargs)

echo "🚀 전체 임베딩 생성 시작 (자동 반복)"
echo "================================================"

iteration=1
while true; do
  echo ""
  echo "📦 Iteration $iteration 시작..."
  
  npx tsx scripts/generate-embeddings-openai.ts 2>&1
  exit_code=$?
  
  if [ $exit_code -ne 0 ]; then
    echo "❌ 오류 발생. 10초 후 재시도..."
    sleep 10
    continue
  fi
  
  # 완료 여부 확인
  if grep -q "모든 상품에 임베딩이 이미 생성되어 있습니다" <<< "$(npx tsx -e "
    const { createClient } = require('@supabase/supabase-js');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    s.from('products').select('id', { count: 'exact', head: true }).is('embedding', null).then(r => {
      if (r.count === 0) console.log('모든 상품에 임베딩이 이미 생성되어 있습니다');
      else console.log('남은 상품: ' + r.count);
    });
  " 2>/dev/null)"; then
    echo ""
    echo "✅ 모든 상품 임베딩 완료!"
    break
  fi
  
  iteration=$((iteration + 1))
  echo "⏳ 다음 배치로..."
done

echo ""
echo "🎉 전체 작업 완료!"
