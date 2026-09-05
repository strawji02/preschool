export interface VenueStatementTarget {
  source: 'shinsegae' | 'cj'
  businessCode: string
  businessName: string
}

/** 공급사+사업장코드는 유치원 거래명세표 한 파일을 가리키는 고유키다. */
export function uniqueVenueStatementTargets(
  targets: readonly VenueStatementTarget[]
): VenueStatementTarget[] {
  const unique = new Map<string, VenueStatementTarget>()
  for (const target of targets) {
    const key = `${target.source}:${target.businessCode}`
    if (!unique.has(key)) unique.set(key, { ...target })
  }
  return [...unique.values()].sort(
    (a, b) => a.businessName.localeCompare(b.businessName, 'ko') ||
      a.source.localeCompare(b.source) ||
      a.businessCode.localeCompare(b.businessCode)
  )
}

export function venueStatementArchiveName(period: string): string {
  return `${period}_유치원_거래명세표_전체.zip`
}

/** 같은 상호의 유치원이 있어도 ZIP 압축 해제 시 파일이 덮어써지지 않게 한다. */
export function venueStatementEntryName(
  period: string,
  target: VenueStatementTarget
): string {
  const source = target.source === 'cj' ? 'CJ' : '신세계'
  const safe = target.businessName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim() || '유치원'
  return `${source}_${target.businessCode}_${safe}_거래명세표_${period}.xlsx`
}
