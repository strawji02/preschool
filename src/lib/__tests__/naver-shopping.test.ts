import { describe, it, expect } from 'vitest'
import { stripHtmlTags, normalizeNaverItems } from '../naver-shopping'

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
