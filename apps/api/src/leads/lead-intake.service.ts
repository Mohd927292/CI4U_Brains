import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { DataScope } from "../auth/auth.types";
import { normalizeIndianMobilePhone } from "../domain/phone-normalization";
import {
  DuplicatePhoneConflictError,
  type LeadRepository,
  leadRepositoryToken,
} from "./lead.repository";
import {
  type CallOutcome,
  type CreateLeadOutcome,
  type FollowUpReason,
  type ExistingPhoneRecord,
  type ImportCommitResult,
  type ImportPreviewResult,
  type ImportPreviewRow,
  type ImportPreviewRowInput,
  type ImportPreviewStatus,
  type LeadDetail,
  type LeadPriority,
  type LeadQueue,
  type LeadSaveAck,
  type LeadStage,
  type LeadWorkflowState,
  type PersistedQuotationInput,
  type PersistedWonDetailsInput,
  type QueueCounts,
  type RawLeadListItem,
  type SiteVisitScheduleStatus,
  type UpdateLeadOutcomeRecordInput,
} from "./lead.types";

const createLeadInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business or customer name is required."),
  phone: z.string().trim().min(1, "Phone number is required."),
  source: z.string().trim().min(1).default("MANUAL"),
  createdById: z.string().trim().min(1).nullable().optional(),
  assignedToId: z.string().trim().min(1).nullable().optional(),
});

export type CreateLeadInput = z.input<typeof createLeadInputSchema>;

const quotationItemSchema = z.object({
  itemName: z.string().trim().min(1),
  unitPriceRs: z.coerce.number().int().min(0),
  quantity: z.coerce.number().int().min(1).default(1),
});

const quotationPackageSchema = z.object({
  packageName: z.string().trim().min(1),
  multiplier: z.coerce.number().int().min(1).default(1),
  items: z.array(quotationItemSchema).min(1),
});

const quotationSchema = z.object({
  title: z.string().trim().min(1),
  packages: z.array(quotationPackageSchema).min(1),
});

const wonDetailsSchema = z.object({
  siteContactNumber: z.string().trim().min(1),
  useCustomerPhoneAsSiteContact: z.boolean().optional(),
  address: z.string().trim().min(1),
  scopeOfWork: z.string().trim().min(1),
  scheduleStatus: z.enum(["SCHEDULED", "NOT_SCHEDULED"]),
  scheduledAt: z.string().datetime().optional(),
  quotedPriceRs: z.coerce.number().int().min(0),
  acceptedPriceRs: z.coerce.number().int().min(0),
  advancePaymentRs: z.coerce.number().int().min(0).default(0),
});

const siteVisitOutcomeSchema = z.object({
  status: z.enum(["COMPLETED", "NOT_COMPLETED"]),
  outcomeSummary: z.string().trim().optional(),
  notCompletedReason: z.string().trim().optional(),
});

const callOutcomeSchema = z.object({
  callOutcome: z.enum(["SPOKE", "WARM", "NOT_INTERESTED", "WRONG_NUMBER", "NOT_RECEIVING"]),
  conversationSummary: z.string().trim().optional(),
  leadIntent: z.enum(["WARM", "INSTALLATION", "REPAIR_SERVICE", "LOST"]).optional(),
  followUpReason: z.enum(["NURTURE", "SITE_VISIT", "QUOTATION", "WON"]).optional(),
  followUpAt: z.string().datetime().optional(),
  siteVisitStatus: z.enum(["SCHEDULED", "NOT_SCHEDULED"]).optional(),
  siteVisitScheduledAt: z.string().datetime().optional(),
  intentChangeSummary: z.string().trim().optional(),
  lostSummary: z.string().trim().optional(),
  siteVisitOutcome: siteVisitOutcomeSchema.optional(),
  quotation: quotationSchema.optional(),
  wonDetails: wonDetailsSchema.optional(),
  whatsappMessageBody: z.string().trim().optional(),
  uploadedFileName: z.string().trim().optional(),
});

export type SaveCallOutcomeInput = z.input<typeof callOutcomeSchema>;
type SaveMode = "detail" | "ack";
type SaveCallOutcomeResult = LeadDetail | LeadSaveAck;

const notReceivingSchedule = [
  { label: "3 hours", milliseconds: 3 * 60 * 60 * 1000 },
  { label: "24 hours", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "72 hours", milliseconds: 72 * 60 * 60 * 1000 },
  { label: "1 week", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "1 month", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "3 months", milliseconds: 90 * 24 * 60 * 60 * 1000 },
] as const;

const oneMonthInMilliseconds = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class LeadIntakeService {
  constructor(
    @Inject(leadRepositoryToken)
    private readonly leadRepository: LeadRepository,
  ) {}

  async createManualLead(dataScope: DataScope, input: CreateLeadInput): Promise<CreateLeadOutcome> {
    const parsed = createLeadInputSchema.parse(input);
    const phone = normalizeIndianMobilePhone(parsed.phone);

    if (!phone.ok) {
      throw new LeadValidationError(phone.message, phone.code);
    }

    const duplicate = await this.leadRepository.findByNormalizedPhone(dataScope, phone.phoneNormalized);

    if (duplicate) {
      return this.toDuplicateOutcome(duplicate);
    }

    try {
      const result = await this.leadRepository.createCustomerAndLead({
        dataScope,
        businessName: parsed.businessName,
        phoneNormalized: phone.phoneNormalized,
        source: parsed.source,
        createdById: parsed.createdById ?? null,
        assignedToId: parsed.assignedToId ?? null,
        now: new Date(),
      });

      return {
        outcome: "created",
        customer: result.customer,
        lead: result.lead,
        activity: result.activity,
      };
    } catch (error) {
      if (error instanceof DuplicatePhoneConflictError) {
        return this.toDuplicateOutcome(error.existing);
      }

      throw error;
    }
  }

  async listRawLeads(dataScope: DataScope): Promise<RawLeadListItem[]> {
    return this.leadRepository.listRawLeads(dataScope);
  }

  async listLeadsByQueue(dataScope: DataScope, queue: LeadQueue): Promise<RawLeadListItem[]> {
    return this.leadRepository.listLeadsByQueue(dataScope, queue);
  }

  async getQueueCounts(dataScope: DataScope): Promise<QueueCounts> {
    return this.leadRepository.getQueueCounts(dataScope);
  }

  async getLeadDetail(dataScope: DataScope, leadId: string): Promise<LeadDetail | null> {
    return this.leadRepository.getLeadDetail(dataScope, leadId);
  }

  async saveCallOutcome(dataScope: DataScope, leadId: string, input: SaveCallOutcomeInput): Promise<LeadDetail> {
    const lead = await this.getLeadDetail(dataScope, leadId);

    if (!lead) {
      throw new LeadValidationError("Lead was not found.", "LEAD_NOT_FOUND");
    }

    return this.saveCallOutcomeForLead(lead, input, "detail") as Promise<LeadDetail>;
  }

  async saveCallOutcomeAck(dataScope: DataScope, leadId: string, input: SaveCallOutcomeInput): Promise<LeadSaveAck> {
    const lead = await this.leadRepository.getLeadWorkflowState(dataScope, leadId);

    if (!lead) {
      throw new LeadValidationError("Lead was not found.", "LEAD_NOT_FOUND");
    }

    return this.saveCallOutcomeForLead(lead, input, "ack") as Promise<LeadSaveAck>;
  }

  private async saveCallOutcomeForLead(lead: LeadWorkflowState, input: SaveCallOutcomeInput, mode: SaveMode): Promise<SaveCallOutcomeResult> {
    const parsed = callOutcomeSchema.parse(input);
    const now = new Date();

    if (parsed.callOutcome === "NOT_INTERESTED") {
      const summary = requireText(parsed.conversationSummary, "Conversation summary is required for Not Interested.");
      return this.persistOutcome({
        dataScope: lead.dataScope,
        leadId: lead.id,
        currentStage: "NOT_INTERESTED",
        currentIntent: "UNKNOWN",
        priority: "LOW",
        nextFollowUpAt: null,
        followUpReason: null,
        siteVisitStatus: null,
        siteVisitScheduledAt: null,
        notReceivingCount: lead.notReceivingCount,
        spokenCount: lead.spokenCount,
        isArchived: true,
        archiveCategory: "NOT_INTERESTED",
        whatsappMessageBody: null,
        quotation: null,
        wonDetails: null,
        activityType: "ARCHIVED",
        activitySummary: `Not interested. Summary: ${summary}`,
        now,
      }, mode);
    }

    if (parsed.callOutcome === "WRONG_NUMBER") {
      return this.persistOutcome({
        dataScope: lead.dataScope,
        leadId: lead.id,
        currentStage: "WRONG_NUMBER",
        currentIntent: "UNKNOWN",
        priority: "LOW",
        nextFollowUpAt: null,
        followUpReason: null,
        siteVisitStatus: null,
        siteVisitScheduledAt: null,
        notReceivingCount: lead.notReceivingCount,
        spokenCount: lead.spokenCount,
        isArchived: true,
        archiveCategory: "WRONG_NUMBER",
        whatsappMessageBody: null,
        quotation: null,
        wonDetails: null,
        activityType: "ARCHIVED",
        activitySummary: parsed.conversationSummary?.trim() ? `Wrong number. Note: ${parsed.conversationSummary.trim()}` : "Wrong number. Archived for review.",
        now,
      }, mode);
    }

    if (parsed.callOutcome === "NOT_RECEIVING") {
      return this.saveNotReceivingOutcome(lead, parsed, now, mode);
    }

    if (parsed.callOutcome === "WARM") {
      return this.saveWarmOutcome(lead, parsed, now, mode);
    }

    return this.saveSpokenOutcome(lead, parsed, now, mode);
  }

  async previewImportRows(dataScope: DataScope, rows: ImportPreviewRowInput[]): Promise<ImportPreviewResult> {
    const seenInFile = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];

    for (const row of rows) {
      const businessName = row.businessName?.trim() || null;
      const rawPhone = row.phone?.trim() || null;

      if (!businessName) {
        previewRows.push(this.toPreviewRow(row, "MISSING_NAME", null, "Business or customer name is required."));
        continue;
      }

      if (!rawPhone) {
        previewRows.push(this.toPreviewRow(row, "INVALID_PHONE", null, "Phone number is required."));
        continue;
      }

      const phone = normalizeIndianMobilePhone(rawPhone);

      if (!phone.ok) {
        previewRows.push(this.toPreviewRow(row, "INVALID_PHONE", null, phone.message));
        continue;
      }

      if (seenInFile.has(phone.phoneNormalized)) {
        previewRows.push(
          this.toPreviewRow(row, "DUPLICATE_IN_FILE", phone.phoneNormalized, "This phone appears more than once in the import file."),
        );
        continue;
      }

      seenInFile.add(phone.phoneNormalized);

      const duplicate = await this.leadRepository.findByNormalizedPhone(dataScope, phone.phoneNormalized);

      if (duplicate) {
        previewRows.push({
          rowNumber: row.rowNumber,
          businessName,
          rawPhone,
          normalizedPhone: phone.phoneNormalized,
          status: this.getDuplicateStatus(duplicate),
          reason: "Phone number already exists in CI4U.",
          duplicate,
        });
        continue;
      }

      previewRows.push({
        rowNumber: row.rowNumber,
        businessName,
        rawPhone,
        normalizedPhone: phone.phoneNormalized,
        status: "NEW_VALID",
        reason: null,
        duplicate: null,
      });
    }

    return {
      summary: {
        totalRows: previewRows.length,
        newRows: previewRows.filter((row) => row.status === "NEW_VALID").length,
        duplicateRows: previewRows.filter((row) => row.status.startsWith("DUPLICATE_")).length,
        invalidPhoneRows: previewRows.filter((row) => row.status === "INVALID_PHONE").length,
        missingNameRows: previewRows.filter((row) => row.status === "MISSING_NAME").length,
        duplicateInFileRows: previewRows.filter((row) => row.status === "DUPLICATE_IN_FILE").length,
      },
      rows: previewRows,
    };
  }

  async commitImportRows(dataScope: DataScope, rows: ImportPreviewRowInput[], source = "IMPORT"): Promise<ImportCommitResult> {
    const preview = await this.previewImportRows(dataScope, rows);
    const created: ImportCommitResult["created"] = [];
    const skipped: ImportPreviewRow[] = [];

    for (const row of preview.rows) {
      if (row.status !== "NEW_VALID" || !row.businessName || !row.normalizedPhone) {
        skipped.push(row);
        continue;
      }

      try {
        created.push(
          await this.leadRepository.createCustomerAndLead({
            dataScope,
            businessName: row.businessName,
            phoneNormalized: row.normalizedPhone,
            source,
            createdById: null,
            assignedToId: null,
            now: new Date(),
          }),
        );
      } catch (error) {
        if (error instanceof DuplicatePhoneConflictError) {
          skipped.push({
            ...row,
            status: this.getDuplicateStatus(error.existing),
            reason: "Phone number became duplicate before import was committed.",
            duplicate: error.existing,
          });
          continue;
        }

        throw error;
      }
    }

    return {
      created,
      skipped,
      summary: {
        requestedRows: preview.summary.totalRows,
        createdRows: created.length,
        skippedRows: skipped.length,
      },
    };
  }

  private toDuplicateOutcome(duplicate: ExistingPhoneRecord): CreateLeadOutcome {
    return {
      outcome: "duplicate",
      duplicate,
      suggestedActions: duplicate.isArchived
        ? ["OPEN_EXISTING_RECORD", "REACTIVATE_TO_MASTER_LEADS", "CREATE_NEW_JOB_UNDER_SAME_CUSTOMER", "MARK_AS_DUPLICATE"]
        : ["OPEN_EXISTING_RECORD", "CREATE_NEW_JOB_UNDER_SAME_CUSTOMER", "IGNORE_ROW", "MARK_AS_DUPLICATE"],
    };
  }

  private persistOutcome(input: UpdateLeadOutcomeRecordInput, mode: SaveMode): Promise<SaveCallOutcomeResult> {
    return mode === "ack" ? this.leadRepository.updateLeadOutcomeAck(input) : this.leadRepository.updateLeadOutcome(input);
  }

  private async saveSpokenOutcome(
    lead: LeadWorkflowState,
    parsed: z.infer<typeof callOutcomeSchema> & { callOutcome: CallOutcome },
    now: Date,
    mode: SaveMode,
  ): Promise<SaveCallOutcomeResult> {
    const requestedIntent = requireIntent(parsed.leadIntent);
    const conversationSummary = requireText(parsed.conversationSummary, "Conversation summary is required when Spoke is selected.");
    const siteVisitOutcomeText = this.resolveSiteVisitOutcomeText(lead, parsed);

    if (requestedIntent === "LOST") {
      const lostSummary = requireText(parsed.lostSummary, "Lost summary is required when marking a follow-up as Lost.");

      if (lead.spokenCount === 0) {
        throw new LeadValidationError("Lost can only be used after at least one previous spoken interaction.", "LOST_NOT_ALLOWED_ON_FIRST_CALL");
      }

      return this.persistOutcome({
        dataScope: lead.dataScope,
        leadId: lead.id,
        currentStage: "LOST",
        currentIntent: lead.currentIntent === "UNKNOWN" ? "WARM" : lead.currentIntent,
        priority: "LOW",
        nextFollowUpAt: null,
        followUpReason: null,
        siteVisitStatus: null,
        siteVisitScheduledAt: null,
        notReceivingCount: 0,
        spokenCount: lead.spokenCount + 1,
        isArchived: false,
        archiveCategory: null,
        whatsappMessageBody: parsed.whatsappMessageBody?.trim() || null,
        quotation: null,
        wonDetails: null,
        activityType: "CALL_OUTCOME",
        activitySummary: `Lost lead. Summary: ${conversationSummary}. Lost reason: ${lostSummary}.${siteVisitOutcomeText}`,
        now,
      }, mode);
    }

    const leadIntent = requestedIntent;
    const intentChanged = lead.currentIntent !== "UNKNOWN" && lead.currentIntent !== leadIntent;

    if (intentChanged) {
      requireText(parsed.intentChangeSummary, "Intent change summary is required when changing the lead intent.");
    }

    const followUpReason = this.resolveFollowUpReason(leadIntent, parsed.followUpReason);
    const wonDetails = followUpReason === "WON" ? this.normalizeWonDetails(parsed.wonDetails, lead) : null;
    const quotation = followUpReason === "QUOTATION" ? this.normalizeQuotation(parsed.quotation) : null;
    const nextFollowUpAt = this.resolveNextFollowUpAt(followUpReason, parsed.followUpAt, parsed.siteVisitStatus, parsed.siteVisitScheduledAt, now, wonDetails);
    const currentStage = this.resolveStage(leadIntent, followUpReason);
    const priority = this.resolvePriority(leadIntent, followUpReason);
    const siteVisitStatus = followUpReason === "SITE_VISIT" ? parsed.siteVisitStatus ?? null : null;
    const siteVisitScheduledAt = followUpReason === "SITE_VISIT" && parsed.siteVisitStatus === "SCHEDULED" ? nextFollowUpAt : null;
    const oldStageText = lead.currentStage !== currentStage ? ` Stage changed from ${lead.currentStage} to ${currentStage}.` : "";
    const oldIntentText = intentChanged ? ` Intent changed from ${lead.currentIntent} to ${leadIntent}. Reason: ${parsed.intentChangeSummary?.trim()}.` : "";
    const quotationText = quotation ? ` Quotation saved with total Rs ${paiseToRs(quotation.totalPricePaise)}.` : "";
    const wonText = wonDetails ? ` Won details saved with accepted price Rs ${paiseToRs(wonDetails.acceptedPricePaise)}.` : "";
    const whatsappText = parsed.whatsappMessageBody?.trim() ? ` WhatsApp draft saved.` : "";
    const uploadText = parsed.uploadedFileName?.trim() ? ` Upload noted: ${parsed.uploadedFileName.trim()}.` : "";

    return this.persistOutcome({
      dataScope: lead.dataScope,
      leadId: lead.id,
      currentStage,
      currentIntent: followUpReason === "WON" ? leadIntent : leadIntent,
      priority,
      nextFollowUpAt,
      followUpReason,
      siteVisitStatus,
      siteVisitScheduledAt,
      notReceivingCount: 0,
      spokenCount: lead.spokenCount + 1,
      isArchived: false,
      archiveCategory: null,
      whatsappMessageBody: parsed.whatsappMessageBody?.trim() || null,
      quotation,
      wonDetails,
      activityType: followUpReason === "WON" ? "WON_MARKED" : "CALL_OUTCOME",
      activitySummary: `Spoke. Intent: ${leadIntent}. Reason: ${followUpReason}. Summary: ${conversationSummary}.${siteVisitOutcomeText}${oldStageText}${oldIntentText}${quotationText}${wonText}${whatsappText}${uploadText}`,
      now,
    }, mode);
  }

  private async saveWarmOutcome(
    lead: LeadWorkflowState,
    parsed: z.infer<typeof callOutcomeSchema>,
    now: Date,
    mode: SaveMode,
  ): Promise<SaveCallOutcomeResult> {
    const nextFollowUpAt = parsed.followUpAt
      ? parseRequiredDate(parsed.followUpAt, "Warm nurture follow-up date/time is invalid.")
      : new Date(now.getTime() + oneMonthInMilliseconds);
    const summary = parsed.conversationSummary?.trim();
    const oldStageText = lead.currentStage !== "WARM" ? ` Stage changed from ${lead.currentStage} to WARM.` : "";
    const oldIntentText =
      lead.currentIntent !== "UNKNOWN" && lead.currentIntent !== "WARM"
        ? ` Intent changed from ${lead.currentIntent} to WARM.${parsed.intentChangeSummary?.trim() ? ` Reason: ${parsed.intentChangeSummary.trim()}.` : ""}`
        : "";
    const summaryText = summary ? ` Summary: ${summary}.` : " Summary not provided by staff.";
    const whatsappText = parsed.whatsappMessageBody?.trim() ? " WhatsApp draft saved." : "";
    const uploadText = parsed.uploadedFileName?.trim() ? ` Upload noted: ${parsed.uploadedFileName.trim()}.` : "";

    return this.persistOutcome({
      dataScope: lead.dataScope,
      leadId: lead.id,
      currentStage: "WARM",
      currentIntent: "WARM",
      priority: "MEDIUM",
      nextFollowUpAt,
      followUpReason: "NURTURE",
      siteVisitStatus: null,
      siteVisitScheduledAt: null,
      notReceivingCount: 0,
      spokenCount: lead.spokenCount + 1,
      isArchived: false,
      archiveCategory: null,
      whatsappMessageBody: parsed.whatsappMessageBody?.trim() || null,
      quotation: null,
      wonDetails: null,
      activityType: "CALL_OUTCOME",
      activitySummary: `Warm lead marked. Reason: NURTURE.${summaryText}${oldStageText}${oldIntentText} Next nurture follow-up at ${nextFollowUpAt.toISOString()}.${whatsappText}${uploadText}`,
      now,
    }, mode);
  }

  private async saveNotReceivingOutcome(
    lead: LeadWorkflowState,
    parsed: z.infer<typeof callOutcomeSchema>,
    now: Date,
    mode: SaveMode,
  ): Promise<SaveCallOutcomeResult> {
    const nextCount = lead.notReceivingCount + 1;
    const shortSchedule = lead.currentIntent === "INSTALLATION" || lead.currentIntent === "REPAIR_SERVICE" || lead.currentStage === "CAPTURED_WON";
    const schedule = shortSchedule
      ? { label: nextCount === 1 ? "3 hours" : "24 hours", milliseconds: nextCount === 1 ? 3 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 }
      : notReceivingSchedule[nextCount - 1];

    if (!schedule) {
      return this.persistOutcome({
        dataScope: lead.dataScope,
        leadId: lead.id,
        currentStage: "NOT_RECEIVING_FINAL",
        currentIntent: lead.currentIntent,
        priority: "LOW",
        nextFollowUpAt: null,
        followUpReason: lead.followUpReason,
        siteVisitStatus: lead.siteVisitStatus,
        siteVisitScheduledAt: lead.siteVisitScheduledAt,
        notReceivingCount: nextCount,
        spokenCount: lead.spokenCount,
        isArchived: true,
        archiveCategory: "NOT_RECEIVING_FINAL",
        whatsappMessageBody: null,
        quotation: null,
        wonDetails: null,
        activityType: "ARCHIVED",
        activitySummary: `Not receiving attempt ${nextCount}. Escalation ladder completed after 3-month stage; moved to Not Receiving Final archive.`,
        now,
      }, mode);
    }

    const nextFollowUpAt = new Date(now.getTime() + schedule.milliseconds);
    const scheduleText = shortSchedule ? " Hot/won lead uses contextual NR schedule: first 3 hours, then 24 hours repeatedly." : "";

    return this.persistOutcome({
      dataScope: lead.dataScope,
      leadId: lead.id,
      currentStage: "NOT_RECEIVING",
      currentIntent: lead.currentIntent,
      priority: lead.priority,
      nextFollowUpAt,
      followUpReason: lead.followUpReason,
      siteVisitStatus: lead.siteVisitStatus,
      siteVisitScheduledAt: lead.siteVisitScheduledAt,
      notReceivingCount: nextCount,
      spokenCount: lead.spokenCount,
      isArchived: false,
      archiveCategory: null,
      whatsappMessageBody: null,
      quotation: null,
      wonDetails: null,
      activityType: "FOLLOW_UP_SCHEDULED",
      activitySummary: `Not receiving attempt ${nextCount}. Auto-scheduled next unanswered follow-up after ${schedule.label} at ${nextFollowUpAt.toISOString()}.${scheduleText}`,
      now,
    }, mode);
  }

  private resolveFollowUpReason(leadIntent: "WARM" | "INSTALLATION" | "REPAIR_SERVICE", reason: z.infer<typeof callOutcomeSchema>["followUpReason"]): "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON" {
    if (leadIntent === "WARM") {
      return "NURTURE";
    }

    if (!reason) {
      throw new LeadValidationError("Follow-up reason is required for Installation and Repair/Service.", "FOLLOW_UP_REASON_REQUIRED");
    }

    return reason;
  }

  private resolveNextFollowUpAt(
    reason: "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON",
    followUpAt: string | undefined,
    siteVisitStatus: SiteVisitScheduleStatus | undefined,
    siteVisitScheduledAt: string | undefined,
    now: Date,
    wonDetails: PersistedWonDetailsInput | null,
  ): Date | null {
    if (reason === "WON") {
      return wonDetails?.scheduledAt ?? null;
    }

    if (reason === "NURTURE" && !followUpAt) {
      return new Date(now.getTime() + oneMonthInMilliseconds);
    }

    if (reason === "SITE_VISIT") {
      if (!siteVisitStatus) {
        throw new LeadValidationError("Site visit scheduled/not scheduled is required.", "SITE_VISIT_STATUS_REQUIRED");
      }

      if (siteVisitStatus === "SCHEDULED") {
        return parseRequiredDate(siteVisitScheduledAt, "Scheduled site visit date/time is required.");
      }

      return parseRequiredDate(followUpAt, "Follow-up date/time is required when site visit is not scheduled.");
    }

    return parseRequiredDate(followUpAt, "Follow-up date/time is required.");
  }

  private resolveStage(leadIntent: "WARM" | "INSTALLATION" | "REPAIR_SERVICE", reason: "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON"): LeadStage {
    if (reason === "WON") {
      return "CAPTURED_WON";
    }

    if (leadIntent === "WARM") {
      return "WARM";
    }

    return leadIntent === "INSTALLATION" ? "HOT_INSTALLATION" : "HOT_REPAIR_SERVICE";
  }

  private resolvePriority(leadIntent: "WARM" | "INSTALLATION" | "REPAIR_SERVICE", reason: "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON"): LeadPriority {
    if (reason === "WON") {
      return "HIGH";
    }

    return leadIntent === "WARM" ? "MEDIUM" : "HIGH";
  }

  private resolveSiteVisitOutcomeText(lead: LeadWorkflowState, parsed: z.infer<typeof callOutcomeSchema>): string {
    const pendingScheduledVisit = lead.spokenCount > 0 && lead.followUpReason === "SITE_VISIT" && lead.siteVisitStatus === "SCHEDULED";

    if (!pendingScheduledVisit) {
      return "";
    }

    if (!parsed.siteVisitOutcome) {
      throw new LeadValidationError("Site visit status is required for a scheduled site visit follow-up.", "SITE_VISIT_OUTCOME_REQUIRED");
    }

    if (parsed.siteVisitOutcome.status === "COMPLETED") {
      const outcome = requireText(parsed.siteVisitOutcome.outcomeSummary, "Site visit outcome summary is required when the visit is completed.");
      return ` Site visit completed. Outcome: ${outcome}.`;
    }

    const reason = requireText(parsed.siteVisitOutcome.notCompletedReason, "Reason is required when the site visit was not completed.");
    return ` Site visit not completed. Reason: ${reason}.`;
  }

  private normalizeQuotation(input: z.infer<typeof quotationSchema> | undefined): PersistedQuotationInput {
    if (!input) {
      throw new LeadValidationError("Quotation details are required when follow-up reason is Quotation.", "QUOTATION_REQUIRED");
    }

    const packagesByName = new Map<string, PersistedQuotationInput["packages"][number]>();

    for (const pkg of input.packages) {
      const packageName = pkg.packageName.trim();
      const packageKey = packageName.toLowerCase();
      const existingPackage =
        packagesByName.get(packageKey) ??
        {
          packageName,
          multiplier: 0,
          packageTotalPaise: 0,
          items: [],
        };

      existingPackage.multiplier += pkg.multiplier;

      for (const item of pkg.items) {
        const unitPricePaise = rsToPaise(item.unitPriceRs);
        const quantity = item.quantity;
        existingPackage.items.push({
          itemName: item.itemName.trim(),
          unitPricePaise,
          quantity,
          lineTotalPaise: unitPricePaise * quantity * pkg.multiplier,
        });
      }

      existingPackage.packageTotalPaise = existingPackage.items.reduce((total, item) => total + item.lineTotalPaise, 0);
      packagesByName.set(packageKey, existingPackage);
    }

    const packages = Array.from(packagesByName.values());
    const totalPricePaise = packages.reduce((total, pkg) => total + pkg.packageTotalPaise, 0);

    if (totalPricePaise <= 0) {
      throw new LeadValidationError("Quotation must contain at least one priced item.", "QUOTATION_PRICE_REQUIRED");
    }

    return {
      title: input.title.trim(),
      totalPricePaise,
      packages,
    };
  }

  private normalizeWonDetails(input: z.infer<typeof wonDetailsSchema> | undefined, lead: LeadWorkflowState): PersistedWonDetailsInput {
    if (!input) {
      throw new LeadValidationError("Won customer details are required before moving a lead to Won Leads.", "WON_DETAILS_REQUIRED");
    }

    const siteContactPhone = input.useCustomerPhoneAsSiteContact ? { ok: true as const, phoneNormalized: lead.phoneNormalized } : normalizeIndianMobilePhone(input.siteContactNumber);

    if (!siteContactPhone.ok) {
      throw new LeadValidationError(siteContactPhone.message, siteContactPhone.code);
    }

    const scheduledAt = input.scheduleStatus === "SCHEDULED" ? parseRequiredDate(input.scheduledAt, "Schedule date/time is required when won work is scheduled.") : null;

    return {
      siteContactNumber: siteContactPhone.phoneNormalized,
      useCustomerPhoneAsSiteContact: Boolean(input.useCustomerPhoneAsSiteContact),
      address: input.address.trim(),
      scopeOfWork: input.scopeOfWork.trim(),
      scheduleStatus: input.scheduleStatus,
      scheduledAt,
      quotedPricePaise: rsToPaise(input.quotedPriceRs),
      acceptedPricePaise: rsToPaise(input.acceptedPriceRs),
      advancePaymentPaise: rsToPaise(input.advancePaymentRs),
    };
  }

  private toPreviewRow(
    row: ImportPreviewRowInput,
    status: ImportPreviewStatus,
    normalizedPhone: string | null,
    reason: string,
  ): ImportPreviewRow {
    return {
      rowNumber: row.rowNumber,
      businessName: row.businessName?.trim() || null,
      rawPhone: row.phone?.trim() || null,
      normalizedPhone,
      status,
      reason,
      duplicate: null,
    };
  }

  private getDuplicateStatus(duplicate: ExistingPhoneRecord): ImportPreviewStatus {
    if (duplicate.isArchived) {
      return "DUPLICATE_ARCHIVED";
    }

    if (duplicate.currentStage === "COMPLETED") {
      return "DUPLICATE_COMPLETED";
    }

    return "DUPLICATE_ACTIVE";
  }
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new LeadValidationError(message, "FIELD_REQUIRED");
  }

  return trimmed;
}

function requireIntent(value: z.infer<typeof callOutcomeSchema>["leadIntent"]): "WARM" | "INSTALLATION" | "REPAIR_SERVICE" | "LOST" {
  if (!value) {
    throw new LeadValidationError("Lead intent is required when Spoke is selected.", "LEAD_INTENT_REQUIRED");
  }

  return value;
}

function parseRequiredDate(value: string | undefined, message: string): Date {
  if (!value) {
    throw new LeadValidationError(message, "FOLLOW_UP_AT_REQUIRED");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new LeadValidationError("Date/time is invalid.", "INVALID_DATE");
  }

  return date;
}

function rsToPaise(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new LeadValidationError("Amount must be a whole number in Rs.", "INVALID_AMOUNT");
  }

  return value * 100;
}

function paiseToRs(value: number): number {
  return value / 100;
}

export class LeadValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
