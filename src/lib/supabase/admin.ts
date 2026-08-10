// ⚠️ **서버 전용.** service_role 키를 읽는다. 클라이언트에서 import하면 **빌드가 실패한다** —
// 조용히 번들에 실리는 것보다 낫다 (CLAUDE.md 모듈 경계 규칙).
import 'server-only'

import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
