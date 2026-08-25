import { describe, expect, it } from 'vitest'
import { sha256File, sha256FileBatch } from '@/lib/file-hash'

describe('비교 원본 파일 해시', () => {
  it('파일명이 달라도 내용이 같으면 같은 해시를 만든다', async () => {
    const first = new File(['same-content'], 'first.xlsx')
    const renamed = new File(['same-content'], 'renamed.xlsx')

    expect(await sha256File(first)).toBe(await sha256File(renamed))
  })

  it('여러 파일 선택 순서가 달라도 같은 묶음으로 판정한다', async () => {
    const first = new File(['a'], 'a.pdf')
    const second = new File(['b'], 'b.jpg')

    expect(await sha256FileBatch([first, second])).toBe(
      await sha256FileBatch([second, first]),
    )
  })
})
