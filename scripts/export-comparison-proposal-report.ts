import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function previousKstMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const previousYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`
}

function monthBoundsKst(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('월은 YYYY-MM 형식이어야 합니다.')
  const [year, monthNumber] = month.split('-').map(Number)
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1, -9)).toISOString(),
    end: new Date(Date.UTC(year, monthNumber, 1, -9)).toISOString(),
  }
}

async function main() {
  const month = argument('--month') ?? previousKstMonth()
  const shouldSend = process.argv.includes('--send')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('.env.local의 Supabase 환경변수가 필요합니다.')
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { start, end } = monthBoundsKst(month)
  const { data: rows, error } = await db
    .from('comparison_proposal_versions')
    .select('id, session_id, version_no, issue_format, statement_changed, proposal_amount_changed, statement_diff, amount_diff, amount_snapshot, change_reasons, is_estimated, estimate_confidence, estimate_basis, issued_at, proposal:comparison_proposals!proposal_id(kindergarten_id, kindergarten_name_snapshot, target_period)')
    .gte('issued_at', start)
    .lt('issued_at', end)
    .order('issued_at', { ascending: true })
  if (error) throw error

  // server-only 표식을 유지한 모듈을 CLI에서 실행하기 위해 react-server condition으로 실행한다.
  type ReportModule = typeof import('../src/lib/comparison-proposal-report')
  const imported = await import('../src/lib/comparison-proposal-report') as unknown as
    | ReportModule
    | { default: ReportModule }
  const reportModule = 'buildMonthlyProposalReport' in imported ? imported : imported.default
  const buffer = await reportModule.buildMonthlyProposalReport(month, (rows ?? []) as unknown[])
  const outputDir = path.join('/tmp', 'preschool-comparison-reports')
  await mkdir(outputDir, { recursive: true })
  const filename = `비교_제안서_발행변경_보고서_${month}.xlsx`
  const outputPath = path.join(outputDir, filename)
  await writeFile(outputPath, buffer)

  const generated = {
    report_month: month,
    status: 'generated',
    version_count: rows?.length ?? 0,
    file_name: filename,
    generated_at: new Date().toISOString(),
    sent_at: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  }
  const { error: runError } = await db.from('comparison_monthly_report_runs').upsert(generated)
  if (runError) throw runError

  if (shouldSend) {
    const chatId = process.env.COKACDIR_CHAT_ID
    const keyFile = process.env.COKACDIR_KEY_FILE
    if (!chatId || !keyFile) throw new Error('--send에는 COKACDIR_CHAT_ID와 COKACDIR_KEY_FILE이 필요합니다.')
    execFileSync('/usr/local/bin/cokacdir', [
      '--sendfile', outputPath, '--chat', chatId, '--key-file', keyFile,
    ], { stdio: 'pipe' })
    const { error: sentError } = await db
      .from('comparison_monthly_report_runs')
      .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('report_month', month)
    if (sentError) throw sentError
  }

  console.log(JSON.stringify({ status: 'ok', month, versions: rows?.length ?? 0, path: outputPath, sent: shouldSend }))
}

main().catch(async (error) => {
  const month = argument('--month') ?? previousKstMonth()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } })
    await db.from('comparison_monthly_report_runs').upsert({
      report_month: month,
      status: 'error',
      error_message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
  }
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
