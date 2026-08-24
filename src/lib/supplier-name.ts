/** 파일명 관례에서 비교 대상 기관명(유치원명)을 추출한다. */
export function extractSupplierName(fileName: string): string {
  const nameWithoutExt = fileName.replace(/\.(pdf|xlsx|xls|heic|jpg|jpeg|png)$/i, '').trim()
  const parts = nameWithoutExt.split('_').map((part) => part.trim()).filter(Boolean)
  const last = parts.at(-1) ?? ''
  const periodSuffix = /^(?:20)?\d{2}(?:년|[.\-])\d{1,2}(?:월)?(?:[.\-]\d{1,2}(?:일)?)?$/
  const candidate = periodSuffix.test(last) && parts.length >= 2 ? parts.at(-2)! : last

  if (candidate.length <= 20 && !/^\d+$/.test(candidate)) return candidate

  const statementMatch = nameWithoutExt.match(/(.+?)(거래명세서|거래명세|명세서|명세|검수일지|검수)/)
  if (statementMatch?.[1]) {
    const words = statementMatch[1].trim().split(/\s+/).filter(Boolean)
    const word = words.at(-1)
    if (word && word.length <= 20) return word
  }

  return nameWithoutExt
}
