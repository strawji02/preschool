#!/bin/bash
cd ~/github/preschool
export $(grep -v '^#' .env.local | xargs)

LOG=~/github/preschool/embed-progress.log
echo "=== 시작: $(date) ===" >> $LOG

while true; do
  remaining=$(node --input-type=module -e "
    import { createClient } from '@supabase/supabase-js';
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { count } = await s.from('products').select('*', { count: 'exact', head: true }).is('embedding', null);
    console.log(count);
  " 2>/dev/null)
  
  if [ "$remaining" = "0" ]; then
    echo "✅ 완료! $(date)" >> $LOG
    break
  fi
  
  echo "📦 남은: $remaining - $(date)" >> $LOG
  npx tsx scripts/generate-embeddings-openai.ts >> $LOG 2>&1
  sleep 2
done

echo "=== 종료: $(date) ===" >> $LOG
