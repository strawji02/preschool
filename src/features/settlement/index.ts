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
  normalizeBizRegNo,
  isValidBizRegNo,
  formatBizRegNo,
} from './calc/biz-reg-no'

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

export {
  validateSplitDeclaration,
  type DeclarationSplit,
  type SplitValidationResult,
} from './calc/split-declaration'

export {
  detectSheetKind,
  pickSourceSheets,
  type UploadedSheet,
  type UploadedWorkbook,
  type PickedSheet,
  type PickSheetsResult,
} from './service/pick-sheets'

export { readUploadedWorkbook, isExcelUpload } from './service/read-upload'

export {
  runSettlement,
  type SettlementRunRequest,
  type SettlementRunResult,
  type PartnerSummary,
  type ExcludedSummary,
  type UnmappedSummary,
  type SourceSummary,
} from './service/run-settlement'

export {
  buildSettlementWorkbook,
  writeSettlementXlsx,
  type WorkbookOptions,
} from './report/workbook'

export {
  INVOICE_COL,
  buildInvoiceSheets,
  collectInvoiceRows,
  monthEndIssueDate,
  type InvoiceTaxKind,
  type InvoiceParty,
  type InvoiceVenueLine,
  type InvoiceRow,
  type CollectInvoiceResult,
  type PendingBuyer,
  type PendingItemName,
  type InvoiceSheet,
  type InvoiceSheets,
  type BuildInvoiceInput,
} from './report/invoice-sheet'

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

export {
  buildSettlementSheet,
  venueDisplayName,
  REPORT_COL,
  type ReportVenueLine,
  type ReportPartnerBlock,
  type SettlementSheet,
  type SheetMerge,
} from './report/settlement-sheet'

export {
  MasterWriteError,
  assignVenue,
  excludeVenue,
  setVenueItemName,
  updateVenueInvoice,
  type AssignVenueInput,
  type ExcludeVenueInput,
  type SetItemNameInput,
  type VenueInvoiceInput,
} from './data/master-write'

export {
  loadSettlementMaster,
  missingInvoiceFields,
  venueItemKey,
  type PartnerRecord,
  type VenueRecord,
  type VenueInvoiceInfo,
  type VenueItemRecord,
  type VenueItemKey,
  type IssuerRecord,
  type TaxKind,
  type SettlementMaster,
} from './data/master'

export { parseShinsegaeSheet } from './parse/shinsegae'
export { parseCjSheet } from './parse/cj'
export { aggregateByPartner } from './parse/aggregate'
export {
  venueMappingKey,
  type SettlementSource,
  type TaxBreakdown,
  type NormalizedVenue,
  type ParseResult,
  type VenueMappingKey,
  type PartnerMapping,
  type PartnerTotals,
  type AggregateResult,
} from './parse/types'
