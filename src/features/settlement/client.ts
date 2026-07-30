/**
 * features/settlement — **클라이언트 안전** 진입점.
 *
 * 브라우저에서 쓸 수 있는 순수 계산과 타입만 노출한다.
 *
 * 왜 배럴을 둘로 나눴는가: 메인 `index.ts`는 `loadSettlementMaster`(Supabase
 * service_role 접근)와 `readUploadedWorkbook`을 함께 내보낸다. 클라이언트
 * 컴포넌트가 그걸 import하면 `supabase-js`와 `createAdminClient`가 브라우저
 * 번들에 끌려 들어간다. 실제 키가 노출되지는 않지만(Next는 `NEXT_PUBLIC_*`만
 * 인라인한다) 죽은 서버 코드가 번들에 남고, 나중에 진짜 유출로 바뀔 수 있는 구조다.
 *
 * 산식은 순수 함수이므로 화면에서 사업자공제를 바꿀 때 서버 왕복 없이 즉시
 * 재계산할 수 있다. 그게 이 배럴의 존재 이유다.
 *
 * @see src/features/settlement/index.ts (서버용)
 */
export {
  roundUpTo10,
  roundDownTo10,
  percentRoundUpTo10,
  percentRoundDownTo10,
} from './calc/rounding'

export {
  calcPlatformFee,
  calcWithholding,
  calcSettlement,
  DEFAULT_COMMISSION_PERCENT,
  type PartnerType,
  type PlatformFeeInput,
  type WithholdingInput,
  type WithholdingResult,
  type SettlementInput,
  type SettlementResult,
} from './calc/settlement-formula'

export {
  DEDUCTION_CATEGORIES,
  sumDeductionItems,
  normalizeDeductionItems,
  buildDeductionSheet,
  type DeductionCategory,
  type DeductionItem,
  type PartnerDeductions,
  type DeductionSheet,
} from './calc/deduction'

// 사업자번호 검증은 입력 즉시 피드백을 줘야 하므로 클라이언트에서도 쓴다
export {
  normalizeBizRegNo,
  isValidBizRegNo,
  formatBizRegNo,
} from './calc/biz-reg-no'

// 마감 합계는 순수 산식이라 화면에서 미리보기로도 쓴다
export {
  closingTotals,
  isValidPeriod,
  type ClosingVenueRow,
  type ClosingPartnerRow,
  type ClosingTotals,
} from './calc/closing'

export {
  validateSplitDeclaration,
  type DeclarationSplit,
  type SplitValidationResult,
} from './calc/split-declaration'

// 지급명세서도 순수 계산이라 화면에서 미리보기·검증에 쓸 수 있다
export {
  buildDeclarationLines,
  buildDeclarationSheet,
  calcNameWithholding,
  DECLARATION_COL,
  type DeclarationPartner,
  type DeclarationLine,
  type DeclarationTotals,
  type DeclarationLinesResult,
  type DeclarationSheet,
  type DeclarationSheetInput,
  type NameWithholding,
} from './report/declaration-sheet'

export type { SettlementSource, TaxBreakdown } from './parse/types'
