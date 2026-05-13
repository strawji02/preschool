#!/bin/bash
# 마이그레이션 보안 lint — 신규 CREATE TABLE은 같은 파일에 RLS enable 필수
# 기존 마이그레이션은 046_security_hardening.sql 이전이라 검사 제외
#
# 사용: bash scripts/lint-migrations.sh
# CI: npm run lint:migrations

set -e

MIGRATIONS_DIR="$(dirname "$0")/../supabase/migrations"
# 046 (security hardening) 이후 마이그레이션만 검사 — 그 이전은 모두 RLS off였음
THRESHOLD="046"

failed=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  basename=$(basename "$f")
  prefix=$(echo "$basename" | cut -c1-3)

  # 숫자 prefix가 THRESHOLD 미만이면 skip (10# prefix로 강제 10진수 해석)
  if [[ "$prefix" =~ ^[0-9]+$ ]] && (( 10#$prefix < 10#$THRESHOLD )); then
    continue
  fi

  # CREATE TABLE 있고 RLS enable 없으면 fail
  if grep -qiE "^[[:space:]]*CREATE TABLE" "$f"; then
    if ! grep -qiE "ENABLE ROW LEVEL SECURITY|046_security_hardening" "$f"; then
      echo "❌ $basename: CREATE TABLE 있지만 ENABLE ROW LEVEL SECURITY 누락"
      echo "   새 table은 반드시 같은 파일에 RLS enable 추가 (anon default deny)"
      failed=1
    fi
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "✅ 마이그레이션 RLS 검사 통과 (검사 대상: ${THRESHOLD}.sql 이후)"
  exit 0
else
  exit 1
fi
