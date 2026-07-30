import { describe, it, expect } from 'vitest'
import {
  formatBizRegNo,
  isValidBizRegNo,
  normalizeBizRegNo,
} from '@/features/settlement'

/**
 * [정산] 사업자등록번호 검증 (docs §14-4)
 *
 * 계산서에 찍히는 번호라 오타가 나면 발행 자체가 실패하거나 엉뚱한 사업자에게 간다.
 * 국세청 체크섬으로 입력 시점에 막는다.
 *
 * 규칙: 가중치 [1,3,7,1,3,7,1,3,5]를 앞 9자리에 곱하고,
 * **9번째 자리 × 5의 십의 자리를 추가로 더한** 뒤 `(10 − 합 % 10) % 10`이
 * 마지막 자리와 같아야 한다.
 */

/** 26년 6월 실제 사업자번호 — 유치원 16곳 + 본사 (2026-07-30 홈택스 파일 실측) */
const REAL_NUMBERS = [
  '1248037974', // 선경유치원
  '1268902101', // 재능유치원
  '1248011407', // 해밀유치원
  '2068005395', // 율화유치원
  '1358016343', // 미래샘유치원
  '2108012672', // 나래유치원
  '2058204174', // 젬마유치원
  '3058221435', // 복자유치원(천안)
  '1098015078', // 우현유치원
  '5798200308', // 복자유치원(부산)
  '6188205248', // 해성유치원
  '1318208466', // 복자유치원
  '1328049224', // 국제유치원
  '1238012252', // 우성유치원
  '1248206946', // 수원복자유치원
  '1278022790', // 아름솔유치원
  '8310503575', // 키즈웰에듀푸드(본사, 공급자)
] as const

describe('normalizeBizRegNo', () => {
  it('하이픈과 공백을 제거한다', () => {
    expect(normalizeBizRegNo('831-05-03575')).toBe('8310503575')
    expect(normalizeBizRegNo(' 124 803 7974 ')).toBe('1248037974')
  })

  it('숫자가 아닌 문자는 버린다', () => {
    expect(normalizeBizRegNo('831.05.03575')).toBe('8310503575')
  })

  it('빈 입력은 빈 문자열이다', () => {
    expect(normalizeBizRegNo('')).toBe('')
    expect(normalizeBizRegNo('   ')).toBe('')
  })
})

describe('isValidBizRegNo', () => {
  it('실제 사업자번호 17건 전부 통과한다', () => {
    for (const no of REAL_NUMBERS) {
      expect(isValidBizRegNo(no), no).toBe(true)
    }
  })

  it('하이픈이 있어도 통과한다', () => {
    expect(isValidBizRegNo('831-05-03575')).toBe(true)
  })

  it('한 자리 오타를 전부 잡아낸다', () => {
    // 실측: 17개 × 10자리 × 9가지 = 1,530가지 오타를 100% 검출했다.
    // 체크섬을 잘못 구현하면 이 테스트가 먼저 깨진다.
    let checked = 0
    for (const no of REAL_NUMBERS) {
      for (let i = 0; i < 10; i++) {
        for (const d of '0123456789') {
          if (d === no[i]) continue
          const typo = no.slice(0, i) + d + no.slice(i + 1)
          expect(isValidBizRegNo(typo), `${no} → ${typo}`).toBe(false)
          checked++
        }
      }
    }
    expect(checked).toBe(1530)
  })

  it('길이가 10자리가 아니면 실패한다', () => {
    expect(isValidBizRegNo('124803797')).toBe(false)
    expect(isValidBizRegNo('12480379740')).toBe(false)
    expect(isValidBizRegNo('')).toBe(false)
  })

  it('9번째 자리 × 5의 십의 자리를 더하지 않으면 통과하지 못하는 번호', () => {
    // 8310503575: 9번째 자리가 7 → 7×5=35 → 십의 자리 3을 더해야 맞는다.
    // 이 단계를 빼먹은 구현은 여기서 실패한다.
    expect(isValidBizRegNo('8310503575')).toBe(true)
  })
})

describe('formatBizRegNo', () => {
  it('3-2-5 형태로 하이픈을 넣는다', () => {
    expect(formatBizRegNo('8310503575')).toBe('831-05-03575')
    expect(formatBizRegNo('1248037974')).toBe('124-80-37974')
  })

  it('10자리가 아니면 원본을 그대로 돌려준다 (입력 중일 수 있다)', () => {
    expect(formatBizRegNo('12480')).toBe('12480')
    expect(formatBizRegNo('')).toBe('')
  })

  it('이미 하이픈이 있어도 같은 결과가 나온다', () => {
    expect(formatBizRegNo('831-05-03575')).toBe('831-05-03575')
  })
})
