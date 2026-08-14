import { describe, it, expect } from 'vitest'
import {
  stripHtmlTags,
  normalizeNaverItems,
  naverShoppingSearchUrl,
  describeNaverError,
} from '../naver-shopping'

describe('stripHtmlTags', () => {
  it('네이버 <b> 강조 태그 제거', () => {
    expect(stripHtmlTags('농심 <b>새우깡</b> 90g')).toBe('농심 새우깡 90g')
  })
  it('HTML 엔티티 복원 + 공백 정규화', () => {
    expect(stripHtmlTags('A &amp;  B')).toBe('A & B')
  })
  it('null/빈값 안전', () => {
    expect(stripHtmlTags(null)).toBe('')
    expect(stripHtmlTags(undefined)).toBe('')
  })
})

describe('normalizeNaverItems', () => {
  it('정상 응답 → 정규화(태그제거·최저가 숫자화)', () => {
    const raw = {
      items: [
        {
          title: '매일 <b>상하목장</b> 유기농 요구르트 100ml',
          image: 'https://shopping-phinf.pstatic.net/x.jpg',
          lprice: '1350',
          mallName: '네이버',
          link: 'https://shopping.naver.com/y',
          brand: '상하목장',
        },
      ],
    }
    const out = normalizeNaverItems(raw)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('매일 상하목장 유기농 요구르트 100ml')
    expect(out[0].lowestPrice).toBe(1350)
    expect(out[0].mallName).toBe('네이버')
    expect(out[0].brand).toBe('상하목장')
  })

  it('lprice 빈문자/0 → null', () => {
    const out = normalizeNaverItems({ items: [{ title: 'x', image: 'i', lprice: '' }] })
    expect(out[0].lowestPrice).toBeNull()
  })

  it('title·image 둘 다 없으면 제외', () => {
    const out = normalizeNaverItems({ items: [{ lprice: '100' }, { title: 'ok', image: 'i' }] })
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('ok')
  })

  it('items 없는/잘못된 응답 → 빈 배열', () => {
    expect(normalizeNaverItems(null)).toEqual([])
    expect(normalizeNaverItems({})).toEqual([])
    expect(normalizeNaverItems({ items: 'nope' })).toEqual([])
  })
})

/*
  (2026-08-15) 네이버가 쇼핑 검색 API를 내려놨다 — 같은 키로 blog·news·image 등
  8개는 200, shop·book·doc 3개만 404 SE05. 인증은 통과한 뒤 404가 나므로
  권한 문제가 아니다. 그래서 두 가지가 필요해졌다.

    naverShoppingSearchUrl  검수자가 손으로 하던 네이버 검색으로 되돌려 준다
    describeNaverError      원본 JSON 대신 사람이 읽을 문장을 준다

  ★ 원본 응답 본문을 화면에 흘리지 않는 것이 핵심이다. 유치원 급식을 검수하는
  분이 `"errorCode": "SE05"`를 보고 할 수 있는 일이 없다.
*/
describe('naverShoppingSearchUrl', () => {
  it('품명을 인코딩해 네이버 쇼핑 검색 주소를 만든다', () => {
    expect(naverShoppingSearchUrl('취나물')).toBe(
      'https://search.shopping.naver.com/search/all?query=%EC%B7%A8%EB%82%98%EB%AC%BC'
    )
  })

  it('거래명세표 품명의 대괄호·쉼표·공백도 인코딩한다', () => {
    // 실제 품명 예: "[K]취나물,국산"
    const url = naverShoppingSearchUrl('[K]취나물,국산')
    expect(url).toContain('%5BK%5D')
    expect(url).toContain('%2C')
    expect(url).not.toContain(' ')
  })

  it('빈 검색어 → 빈 문자열 (버튼을 숨길 수 있게)', () => {
    expect(naverShoppingSearchUrl('')).toBe('')
    expect(naverShoppingSearchUrl('   ')).toBe('')
    expect(naverShoppingSearchUrl(null)).toBe('')
  })
})

describe('describeNaverError', () => {
  const SE05 = '{"errorMessage":"Invalid search api (존재하지 않는 검색 api 입니다.)","errorCode":"SE05"}'

  it('404 SE05 → 중단 안내 + 재시도 무의미(permanent)', () => {
    const r = describeNaverError(404, SE05)
    expect(r.permanent).toBe(true)
    expect(r.code).toBe('SE05')
    expect(r.message).toContain('네이버')
  })

  it('원본 JSON을 메시지에 노출하지 않는다', () => {
    const r = describeNaverError(404, SE05)
    expect(r.message).not.toContain('errorCode')
    expect(r.message).not.toContain('SE05')
    expect(r.message).not.toContain('{')
  })

  it('401 → 키 인증 실패, permanent', () => {
    const r = describeNaverError(401, '{"errorMessage":"Not Exist Client ID","errorCode":"024"}')
    expect(r.permanent).toBe(true)
    expect(r.message).toContain('키')
  })

  it('429 → 한도 초과, 재시도 가능', () => {
    const r = describeNaverError(429, '{"errorCode":"012"}')
    expect(r.permanent).toBe(false)
    expect(r.message).toContain('한도')
  })

  it('5xx → 일시 오류, 재시도 가능', () => {
    const r = describeNaverError(503, '')
    expect(r.permanent).toBe(false)
    expect(r.message).toMatch(/일시|잠시/)
  })

  it('본문이 JSON이 아니어도 죽지 않는다', () => {
    const r = describeNaverError(404, '<html>Not Found</html>')
    expect(typeof r.message).toBe('string')
    expect(r.message.length).toBeGreaterThan(0)
    expect(r.message).not.toContain('<html>')
  })
})
