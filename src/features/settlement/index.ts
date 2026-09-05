/**
 * features/settlement — 급식 정산 도메인.
 *
 * AGENTS.md 규칙: features/comparison을 직접 import하지 않는다.
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

export {
  DEFAULT_INVOICE_OVERRIDE_REASON,
  applyInvoiceOverrides,
  validateInvoiceOverrideDraft,
  type InvoiceOverride,
  type InvoiceOverrideDraft,
  type InvoiceOverrideStatus,
  type ApplyInvoiceOverridesResult,
} from './calc/invoice-policy'

export {
  suggestInvoiceItemName,
  venueItemNameOptions,
  type VenueItemNameHistory,
} from './calc/item-name-suggestion'

// 수금·지급도 순수 산식이다 (docs §9)
export {
  buildCollectionSummary,
  type ReceiptRecord,
  type ReceiptAdjustmentRecord,
  type PayoutRecord,
  type CollectionRow,
  type PartnerCollection,
  type CollectionTotals,
  type CollectionSummary,
  type CollectionInput,
} from './calc/collection'

export {
  buildSupplierPayableSummary,
  calculateSupplierPrincipals,
  type SupplierPrincipal,
  type SupplierAdjustmentRecord,
  type SupplierPaymentRecord,
  type SupplierPayableRow,
  type SupplierPayableSummary,
} from './calc/supplier-payable'

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
  type PendingItemNameResolution,
} from './service/run-settlement'

export {
  buildSettlementWorkbook,
  writeSettlementXlsx,
  type WorkbookOptions,
} from './report/workbook'

export { writeCjVenueStatementXlsx } from './report/cj-venue-statement-workbook'

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
  addReceiptWriteoff,
  approveReceiptWriteoff,
  cancelReceiptWriteoff,
  addPayout,
  deleteReceipt,
  deletePayout,
  loadCollection,
  type ReceiptEntry,
  type ReceiptWriteoffEntry,
  type PayoutEntry,
  type CollectionView,
} from './data/collection'

export {
  InvoiceOverrideError,
  listInvoiceOverrides,
  createInvoiceOverride,
  createInvoiceOverrides,
  approveInvoiceOverride,
  approveInvoiceOverrides,
  cancelInvoiceOverride,
} from './data/invoice-override'

export {
  SupplierPayableError,
  loadSupplierPayable,
  addSupplierPayment,
  addSupplierAdjustment,
  approveSupplierAdjustment,
  cancelSupplierEntry,
  type SupplierPayableView,
  type SupplierPaymentEntry,
  type SupplierAdjustmentEntry,
} from './data/supplier-payable'

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

export {
  writeShinsegaeStatementXlsx,
  writeManualItemStatementXlsx,
} from './report/shinsegae-statement-workbook'

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
  applyManualItems,
  calculateChargeTotal,
  calculateTaxBreakdown,
  validateManualItem,
  type ApplyManualItemsResult,
  type CreateManualItemInput,
  type ManualItemBurden,
  type ManualItemEvidence,
  type ManualItemInvoiceMode,
  type ManualItemKind,
  type ManualItemPayload,
  type ManualItemRecord,
  type ManualItemStatus,
  type ManualItemTaxKind,
  type ManualNormalizedVenue,
} from './calc/manual-item'

export {
  ManualItemError,
  addManualItemEvidence,
  approveManualItem,
  cancelManualItem,
  createManualItem,
  downloadManualItemEvidence,
  findManualItemDuplicates,
  getManualItem,
  listManualItems,
  updateManualItem,
} from './data/manual-item'

export {
  buildPartnerSettlementWorkbook,
  partnerReportFileName,
  writePartnerSettlementWorkbook,
  type BuildPartnerSettlementWorkbookInput,
} from './report/partner-workbook'

export { createZipArchive, type ZipEntry } from './report/zip'

export {
  buildManualItemSheet,
  type ManualItemSheet,
} from './report/manual-item-sheet'

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

/*
  단가표는 **정산·비교 공용**이라 `features/shared/price-book`에 있다 (docs §21, 비교 §9).
  여기서 다시 내보내는 이유: 정산 라우트들이 이미 `@/features/settlement`에서
  가져오고 있어 호출부를 흔들지 않는다. settlement → shared는 허용된 방향이다.
*/
export {
  parsePriceBookSheet,
  checkPriceBookPeriod,
  normalizeProductCode,
  PriceBookError,
  savePriceBook,
  loadPriceLookup,
  loadPriceBookPrices,
  listPriceBooks,
  previousPeriod,
  type PriceBookItem,
  type PriceBookResult,
  type PriceBookSummary,
  type PriceLookup,
} from '@/features/shared/price-book'
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
