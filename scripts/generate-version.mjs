#!/usr/bin/env node
/**
 * 시스템별 버전 생성 (빌드 전에 자동 실행 — package.json `prebuild`).
 *
 * ★ **두 시스템은 한 저장소에 있지만 배포 주기가 다르다.**
 *
 * 지금까지 화면에는 `NEXT_PUBLIC_BUILD_TIME`(빌드 시각)이 찍혔다. 정산만 고쳐서
 * 배포해도 비교 시스템의 표시가 바뀌었다 — 사용자 입장에서는 "뭐가 바뀌었나?"
 * 하고 확인하게 만드는 거짓 신호다.
 *
 * 그래서 **각 시스템이 마지막으로 실제로 바뀐 커밋**을 git에서 찾아 쓴다.
 * 정산만 고친 배포에서는 비교 시스템의 버전·시각이 그대로 남는다.
 *
 * ⚠️ 커밋 메시지의 `[정산]`/`[비교]` 태그를 쓰지 않고 **경로로 판별**한다.
 * 태그는 빠뜨릴 수 있지만 바뀐 파일은 거짓말을 하지 않는다.
 *
 * 결과가 없으면(=git을 못 씀) **기존 파일을 그대로 둔다.** 저장소에 커밋된
 * 값이 fallback이 되므로 배포 환경에 git이 없어도 화면이 비지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'src/generated/version.json')

/**
 * 두 시스템 모두에 영향을 주는 경로.
 *
 * 인증·미들웨어·공통 레이아웃이 바뀌면 **양쪽 다 동작이 달라진다.**
 * 한쪽에만 넣으면 다른 쪽 사용자가 "안 바뀌었다"는 잘못된 정보를 본다.
 */
const SHARED = [
  'src/middleware.ts',
  'src/app/layout.tsx',
  'src/app/(public)',
  'src/app/login',
  'src/app/auth',
  'src/features/shared',
  'src/lib/supabase',
  'package.json',
  'next.config.ts',
  'next.config.js',
]

const SETTLEMENT = [
  'src/features/settlement',
  'src/app/app',
  'src/app/api/settlement',
  ...SHARED,
]

const COMPARISON = [
  'src/app/calc-food',
  'src/lib',
  'src/app/api/admin',
  'src/app/api/analyze',
  'src/app/api/audit-items',
  'src/app/api/ocr-corrections',
  'src/app/api/products',
  'src/app/api/reference-search',
  'src/app/api/session',
  'src/app/api/sessions',
  ...SHARED,
]

/**
 * 테스트·문서는 제외한다.
 *
 * 버전은 **사용자가 보는 동작이 언제 바뀌었나**를 알려주는 것이다. 테스트를
 * 고쳤다고 버전이 오르면, 사용자는 달라진 걸 찾다가 시간을 버린다.
 */
const EXCLUDE = [':(exclude)**/__tests__/**', ':(exclude)**/*.test.ts', ':(exclude)docs/**']

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** KST 기준 `YY.MM.DD` + 그날 몇 번째 변경인지 */
function versionOf(paths) {
  const log = git(['log', '--format=%H %cI', '--', ...paths, ...EXCLUDE]).trim()
  if (log === '') return null

  const commits = log.split('\n').map((line) => {
    const [sha, iso] = line.split(' ')
    return { sha, at: new Date(iso) }
  })

  const latest = commits[0]
  const day = kstDate(latest.at)
  // 같은 날 몇 번째 배포인지 — 하루에 여러 번 고치는 일이 흔하다
  const sameDay = commits.filter((c) => kstDate(c.at) === day)
  const ordinal = sameDay.length

  return {
    version: `v${day}.${ordinal}`,
    sha: latest.sha.slice(0, 7),
    /** KST `YYYY-MM-DD HH:mm` */
    at: kstStamp(latest.at),
    iso: latest.at.toISOString(),
  }
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function kstParts(d) {
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  const p = (n) => String(n).padStart(2, '0')
  return {
    yy: p(k.getUTCFullYear() % 100),
    mm: p(k.getUTCMonth() + 1),
    dd: p(k.getUTCDate()),
    hh: p(k.getUTCHours()),
    mi: p(k.getUTCMinutes()),
    yyyy: k.getUTCFullYear(),
  }
}

const kstDate = (d) => {
  const { yy, mm, dd } = kstParts(d)
  return `${yy}.${mm}.${dd}`
}

const kstStamp = (d) => {
  const { yyyy, mm, dd, hh, mi } = kstParts(d)
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function main() {
  let settlement, comparison
  try {
    settlement = versionOf(SETTLEMENT)
    comparison = versionOf(COMPARISON)
  } catch {
    // git이 없는 환경(일부 CI). 커밋된 값을 그대로 둔다.
    if (existsSync(OUT)) {
      console.log('[version] git 사용 불가 — 커밋된 값을 유지합니다')
      return
    }
    throw new Error('git도 없고 커밋된 version.json도 없습니다')
  }

  if (!settlement || !comparison) {
    if (existsSync(OUT)) {
      console.log('[version] 이력을 찾지 못해 커밋된 값을 유지합니다')
      return
    }
  }

  const next = { settlement, comparison }
  const json = JSON.stringify(next, null, 2) + '\n'

  // 내용이 같으면 쓰지 않는다 — 파일 mtime이 바뀌면 Next가 불필요하게 다시 빌드한다
  if (existsSync(OUT) && readFileSync(OUT, 'utf8') === json) {
    console.log('[version] 변경 없음')
    return
  }

  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, json)
  console.log(
    `[version] 정산 ${settlement.version} (${settlement.at}) / 비교 ${comparison.version} (${comparison.at})`
  )
}

main()
