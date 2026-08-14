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

// 계산서 원단위 절사도 순수 산식이다 (docs §6-2)
export {
  applyInvoiceRounding,
  type InvoiceRoundingMode,
  type RoundedInvoice,
} from './calc/invoice-rounding'

// 수금·지급도 순수 산식이다 (docs §9)
export {
  buildCollectionSummary,
  type ReceiptRecord,
  type PayoutRecord,
  type CollectionRow,
  type PartnerCollection,
  type CollectionTotals,
  type CollectionSummary,
  type CollectionInput,
} from './calc/collection'

// 보고서 집계도 순수 함수다 (docs §13-2)
export {
  rollupByKindergarten,
  rollupBySource,
  type KindergartenRollup,
  type SourceRollup,
  type SourceRollups,
} from './calc/report-rollup'

// 마감 합계는 순수 산식이라 화면에서 미리보기로도 쓴다
export {
  closingTotals,
  closingTransition,
  isValidPeriod,
  type ClosingVenueRow,
  type ClosingPartnerRow,
  type ClosingTotals,
  type ClosingStatus,
  type ClosingAction,
  type ClosingTransition,
} from './calc/closing'

export {
  carryOverSplits,
  validateSplitDeclaration,
  type DeclarationSplit,
  type SplitValidationResult,
} from './calc/split-declaration'

export {
  detectSheetKind,
  toArchiveKind,
  pickSourceSheets,
  type SheetKind,
  type ArchiveKind,
  type UploadedSheet,
  type UploadedWorkbook,
  type PickedSheet,
  type PickSheetsResult,
} from './service/pick-sheets'

export {
  readUploadedWorkbook,
  readWorkbookBytes,
  isExcelUpload,
} from './service/read-upload'

export {
  SourceArchiveError,
  SOURCE_KIND_LABEL,
  saveSourceFiles,
  loadActiveSources,
  listSourceFiles,
  loadSourceWorkbooks,
  type SourceKind,
  type SourceFileRecord,
  type DetectedSheet,
} from './data/source-archive'

export {
  resolveSources,
  NO_SOURCE_MESSAGE,
  type ResolvedSources,
} from './service/resolve-sources'

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

// 마감된 달의 내역서를 원천 파일 없이 되살린다 (docs §8-2)
export { rebuildClosingBlocks } from './report/rebuild-blocks'

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
  CollectionError,
  addReceipt,
  addPayout,
  deleteReceipt,
  deletePayout,
  loadCollection,
  type ReceiptEntry,
  type PayoutEntry,
  type CollectionView,
} from './data/collection'

export {
  ClosingError,
  saveClosing,
  reopenClosing,
  loadClosing,
  loadClosingSnapshot,
  loadClosingRevisions,
  loadClosingDetail,
  listClosings,
  CLOSING_STATUS_LABEL,
  type ClosingRecord,
  type ClosingRevision,
  type ClosingDetail,
  type SaveClosingInput,
} from './data/closing'

export {
  buildAdjustmentSheet,
  ADJUSTMENT_COL_WIDTHS,
  type AdjustmentSheet,
} from './report/adjustment-sheet'

export {
  buildVenueStatement,
  extractTemperature,
  type VenueStatement,
  type VenueStatementItem,
  type StatementIssuer,
} from './report/venue-statement'

export {
  buildShinsegaeStatement,
  formatStatementAmount,
  formatStatementDate,
  formatStatementQuantity,
  type ShinsegaeStatement,
  type ShinsegaeStatementBuyer,
  type ShinsegaeStatementBlock,
  type OriginReport,
} from './report/shinsegae-statement'

export { writeShinsegaeStatementXlsx } from './report/shinsegae-statement-workbook'

export {
  buildVenueStatementWorkbook,
  writeVenueStatementXlsx,
} from './report/venue-statement-workbook'

export {
  AdjustmentError,
  createAdjustment,
  deleteAdjustment,
  listAdjustments,
  type AdjustmentRecord,
  type CreateAdjustmentInput,
} from './data/adjustment'

export {
  adjustmentAmount,
  adjustmentVenueKey,
  applyAdjustments,
  defaultAdjustmentReason,
  sumAdjustments,
  type AdjustmentKind,
  type StoredAdjustment,
} from './calc/adjustment'

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

export {
  parsePriceBookSheet,
  checkPriceBookPeriod,
  normalizeProductCode,
  type PriceBookItem,
  type PriceBookResult,
} from './parse/price-book'

export {
  PriceBookError,
  savePriceBook,
  loadPriceLookup,
  loadPriceBookPrices,
  listPriceBooks,
  previousPeriod,
  type PriceBookSummary,
  type PriceLookup,
} from './data/price-book'
export { parseCjSheet } from './parse/cj'
export { parseCjStatementSheet } from './parse/cj-statement'

export {
  checkSourcePeriod,
  periodMismatchMessage,
  toDateRange,
  type SourceDateRange,
  type PeriodMismatch,
} from './calc/period-guard'

export {
  crossCheckCjStatement,
  cjCrossCheckMessage,
  type CjCrossCheckIssue,
} from './calc/cj-cross-check'
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
