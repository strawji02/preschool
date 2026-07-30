import versions from '@/generated/version.json'

/**
 * 시스템별 버전 (docs/systems/settlement.md §16).
 *
 * ★ **두 시스템은 한 저장소에 있지만 배포 주기가 다르다.**
 *
 * 예전에는 화면에 `NEXT_PUBLIC_BUILD_TIME`(빌드 시각)을 찍었다. 정산만 고쳐서
 * 배포해도 비교 시스템의 표시가 바뀌었다 — 사용자에게는 "뭐가 바뀌었나?" 하고
 * 찾아보게 만드는 거짓 신호다.
 *
 * 여기 값은 **각 시스템이 마지막으로 실제로 바뀐 커밋**에서 온다
 * (`scripts/generate-version.mjs`가 빌드 전에 git에서 뽑는다).
 * 정산만 고친 배포에서는 비교 쪽 값이 그대로 남는다.
 */
export interface SystemVersion {
  /** `v26.07.31.6` — KST 날짜 + 그날 몇 번째 변경인지 */
  version: string
  /** 커밋 해시 앞 7자 */
  sha: string
  /** KST `YYYY-MM-DD HH:mm` */
  at: string
  iso: string
}

export const SETTLEMENT_VERSION: SystemVersion = versions.settlement
export const COMPARISON_VERSION: SystemVersion = versions.comparison
