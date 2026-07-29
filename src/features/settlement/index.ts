/**
 * features/settlement — 급식 정산 도메인.
 *
 * CLAUDE.md 규칙: features/comparison을 직접 import하지 않는다.
 * 공유가 필요하면 features/shared 또는 lib을 경유한다.
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
  validateSplitDeclaration,
  type DeclarationSplit,
  type SplitValidationResult,
} from './calc/split-declaration'
