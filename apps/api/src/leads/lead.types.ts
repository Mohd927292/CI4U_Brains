import type { DataScope } from "../auth/auth.types";

export const leadStages = [
  "RAW_UNTOUCHED",
  "CONTACT_ATTEMPTED",
  "WARM",
  "HOT_INSTALLATION",
  "HOT_REPAIR_SERVICE",
  "HOT_AMC",
  "QUOTATION_PENDING",
  "SITE_VISIT_PENDING",
  "CAPTURED_WON",
  "VENDOR_ASSIGNMENT",
  "VENDOR_OFFER_SENT",
  "VENDOR_ACCEPTED",
  "OPERATIONS_ONGOING",
  "ACTIVE_JOB",
  "COMPLETED",
  "LOST",
  "NOT_INTERESTED",
  "WRONG_NUMBER",
  "NOT_RECEIVING",
  "GHOSTING",
  "NOT_RECEIVING_FINAL",
  "TRASH_ARCHIVED",
] as const;

export type LeadStage = (typeof leadStages)[number];

export const leadIntents = ["UNKNOWN", "WARM", "INSTALLATION", "REPAIR_SERVICE"] as const;

export type LeadIntent = (typeof leadIntents)[number];

export type LeadPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type LeadQueue =
  | "RAW"
  | "WARM"
  | "HOT_INSTALLATION"
  | "HOT_REPAIR_SERVICE"
  | "UNANSWERED"
  | "GHOSTING"
  | "WON"
  | "LOST"
  | "ARCHIVE";

export type CallOutcome = "SPOKE" | "WARM" | "NOT_INTERESTED" | "WRONG_NUMBER" | "NOT_RECEIVING";

export type FollowUpReason = "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON";

export type SiteVisitScheduleStatus = "SCHEDULED" | "NOT_SCHEDULED";

export type SiteVisitOutcomeStatus = "COMPLETED" | "NOT_COMPLETED";

export type WorkScheduleStatus = "SCHEDULED" | "NOT_SCHEDULED";

export type LeadActivityType =
  | "LEAD_CREATED"
  | "LEAD_IMPORTED"
  | "DUPLICATE_DETECTED"
  | "CALL_ATTEMPTED"
  | "CALL_CONNECTED"
  | "CALL_OUTCOME"
  | "STAGE_CHANGED"
  | "INTENT_CHANGED"
  | "ARCHIVED"
  | "REACTIVATED"
  | "FOLLOW_UP_SCHEDULED"
  | "FOLLOW_UP_COMPLETED"
  | "WHATSAPP_GENERATED"
  | "WHATSAPP_SENT_MANUAL"
  | "NOTE_ADDED"
  | "WON_MARKED"
  | "LEAD_TRANSFERRED";

export type ImportPreviewStatus =
  | "NEW_VALID"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_ACTIVE"
  | "DUPLICATE_ARCHIVED"
  | "DUPLICATE_COMPLETED"
  | "INVALID_PHONE"
  | "MISSING_NAME";

export type ExistingPhoneRecord = {
  dataScope: DataScope;
  phoneNormalized: string;
  customerId: string;
  customerName: string;
  currentLeadId: string | null;
  currentStage: LeadStage;
  isActive: boolean;
  isArchived: boolean;
  assignedToName: string | null;
  nextFollowUpAt: Date | null;
  lastActivitySummary: string | null;
  lastUpdatedAt: Date;
  totalJobs: number;
};

export type CreatedCustomer = {
  id: string;
  dataScope: DataScope;
  businessName: string;
  primaryPhoneNormalized: string;
  createdAt: Date;
};

export type CreatedLead = {
  id: string;
  dataScope: DataScope;
  customerId: string;
  leadCycleNumber: number;
  currentStage: LeadStage;
  currentIntent: LeadIntent;
  source: string;
  priority: LeadPriority;
  nextFollowUpAt: Date | null;
  followUpReason: FollowUpReason | null;
  siteVisitStatus: SiteVisitScheduleStatus | null;
  siteVisitScheduledAt: Date | null;
  notReceivingCount: number;
  spokenCount: number;
  isArchived: boolean;
  archiveCategory: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatedLeadActivity = {
  id: string;
  leadId: string;
  customerId: string;
  type: LeadActivityType;
  summary: string;
  createdAt: Date;
};

export type RawLeadListItem = {
  id: string;
  dataScope: DataScope;
  customerId: string;
  customerName: string;
  phoneNormalized: string;
  source: string;
  currentStage: LeadStage;
  currentIntent: LeadIntent;
  priority: LeadPriority;
  nextFollowUpAt: Date | null;
  followUpReason: FollowUpReason | null;
  notReceivingCount: number;
  assignedToName: string | null;
  lastActivitySummary: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadWorkflowState = RawLeadListItem & {
  leadCycleNumber: number;
  siteVisitStatus: SiteVisitScheduleStatus | null;
  siteVisitScheduledAt: Date | null;
  spokenCount: number;
  isArchived: boolean;
  archiveCategory: string | null;
};

export type LeadSaveAck = RawLeadListItem & {
  savedAt: Date;
  serverConfirmed: true;
};

export type QuotationItemInput = {
  itemName: string;
  unitPriceRs: number;
  quantity?: number;
};

export type QuotationPackageInput = {
  packageName: string;
  multiplier: number;
  items: QuotationItemInput[];
};

export type QuotationInput = {
  title: string;
  packages: QuotationPackageInput[];
};

export type QuotationItemSnapshot = {
  itemName: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
};

export type QuotationPackageSnapshot = {
  packageName: string;
  multiplier: number;
  packageTotalPaise: number;
  items: QuotationItemSnapshot[];
};

export type QuotationSnapshot = {
  id: string;
  title: string;
  totalPricePaise: number;
  createdAt: Date;
  packages: QuotationPackageSnapshot[];
};

export type QuotationSuggestion = {
  items: Array<{
    itemName: string;
    lastPricePaise: number;
  }>;
  packages: Array<{
    packageName: string;
    items: Array<{
      itemName: string;
      unitPricePaise: number;
      quantity: number;
    }>;
  }>;
};

export type WonDetailsInput = {
  siteContactNumber: string;
  useCustomerPhoneAsSiteContact?: boolean;
  address: string;
  scopeOfWork: string;
  scheduleStatus: WorkScheduleStatus;
  scheduledAt?: string;
  quotedPriceRs: number;
  acceptedPriceRs: number;
  advancePaymentRs: number;
};

export type WonDetailsSnapshot = {
  siteContactNumber: string;
  useCustomerPhoneAsSiteContact: boolean;
  address: string;
  scopeOfWork: string;
  scheduleStatus: WorkScheduleStatus;
  scheduledAt: Date | null;
  quotedPricePaise: number;
  acceptedPricePaise: number;
  advancePaymentPaise: number;
  createdAt: Date;
};

export type LeadDetail = LeadWorkflowState & {
  latestQuotation: QuotationSnapshot | null;
  wonDetails: WonDetailsSnapshot | null;
  quotationSuggestions: QuotationSuggestion;
  timeline: Array<{
    id: string;
    type: LeadActivityType;
    summary: string;
    createdAt: Date;
  }>;
  firstCallOutcomeOptions: CallOutcome[];
  followUpOutcomeOptions: CallOutcome[];
};

export type QueueCounts = Record<LeadQueue, number>;

export type CreateLeadRecordInput = {
  dataScope: DataScope;
  businessName: string;
  phoneNormalized: string;
  source: string;
  createdById: string | null;
  assignedToId: string | null;
  now: Date;
};

export type UpdateLeadOutcomeRecordInput = {
  dataScope: DataScope;
  leadId: string;
  actorId: string | null;
  currentStage: LeadStage;
  currentIntent: LeadIntent;
  priority: LeadPriority;
  nextFollowUpAt: Date | null;
  followUpReason: FollowUpReason | null;
  siteVisitStatus: SiteVisitScheduleStatus | null;
  siteVisitScheduledAt: Date | null;
  notReceivingCount: number;
  spokenCount: number;
  isArchived: boolean;
  archiveCategory: string | null;
  whatsappMessageBody: string | null;
  quotation: PersistedQuotationInput | null;
  wonDetails: PersistedWonDetailsInput | null;
  activityType: LeadActivityType;
  activitySummary: string;
  now: Date;
};

export type TransferLeadRecordInput = {
  dataScope: DataScope;
  leadId: string;
  fromUserId: string;
  toUserId: string;
  reason: string;
  followUpAt: Date;
  now: Date;
};

export type FollowUpAlert = {
  id: string;
  leadId: string;
  customerId: string;
  customerName: string;
  phoneNormalized: string;
  currentStage: LeadStage;
  currentIntent: LeadIntent;
  priority: LeadPriority;
  reason: string;
  dueAt: Date;
  assignedToName: string | null;
  lastActivitySummary: string | null;
  snoozeCount: number;
  snoozedUntil: Date | null;
  maxSnoozes: number;
  isTransfer: boolean;
};

export type SnoozeFollowUpRecordInput = {
  dataScope: DataScope;
  followUpId: string;
  userId: string;
  minutes: number;
  now: Date;
};

export type HoldFollowUpRecordInput = {
  dataScope: DataScope;
  followUpId: string;
  userId: string;
  holdMinutes: number;
  now: Date;
};

export type PersistedQuotationInput = {
  title: string;
  totalPricePaise: number;
  packages: Array<{
    packageName: string;
    multiplier: number;
    packageTotalPaise: number;
    items: Array<{
      itemName: string;
      unitPricePaise: number;
      quantity: number;
      lineTotalPaise: number;
    }>;
  }>;
};

export type PersistedWonDetailsInput = {
  siteContactNumber: string;
  useCustomerPhoneAsSiteContact: boolean;
  address: string;
  scopeOfWork: string;
  scheduleStatus: WorkScheduleStatus;
  scheduledAt: Date | null;
  quotedPricePaise: number;
  acceptedPricePaise: number;
  advancePaymentPaise: number;
};

export type CreateLeadRecordResult = {
  customer: CreatedCustomer;
  lead: CreatedLead;
  activity: CreatedLeadActivity;
};

export type CreateLeadOutcome =
  | {
      outcome: "created";
      customer: CreatedCustomer;
      lead: CreatedLead;
      activity: CreatedLeadActivity;
    }
  | {
      outcome: "duplicate";
      duplicate: ExistingPhoneRecord;
      suggestedActions: Array<
        | "OPEN_EXISTING_RECORD"
        | "REACTIVATE_TO_MASTER_LEADS"
        | "CREATE_NEW_JOB_UNDER_SAME_CUSTOMER"
        | "IGNORE_ROW"
        | "MARK_AS_DUPLICATE"
      >;
    };

export type ImportPreviewRowInput = {
  rowNumber: number;
  businessName: string | null;
  phone: string | null;
};

export type ImportPreviewRow = {
  rowNumber: number;
  businessName: string | null;
  rawPhone: string | null;
  normalizedPhone: string | null;
  status: ImportPreviewStatus;
  reason: string | null;
  duplicate: ExistingPhoneRecord | null;
};

export type ImportPreviewSummary = {
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  invalidPhoneRows: number;
  missingNameRows: number;
  duplicateInFileRows: number;
};

export type ImportPreviewResult = {
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
};

export type ImportCommitResult = {
  created: CreateLeadRecordResult[];
  skipped: ImportPreviewRow[];
  summary: {
    requestedRows: number;
    createdRows: number;
    skippedRows: number;
  };
};
