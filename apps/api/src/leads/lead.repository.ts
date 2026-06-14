import { randomUUID } from "node:crypto";
import type { DataScope } from "../auth/auth.types";
import {
  type CreateLeadRecordInput,
  type CreateLeadRecordResult,
  type DeleteRawLeadsRecordInput,
  type DeleteRawLeadsResult,
  type ExistingPhoneRecord,
  type FollowUpAlert,
  type HoldFollowUpRecordInput,
  type LeadAccessScope,
  type LeadDetail,
  type LeadQueue,
  type LeadSaveAck,
  type LeadWorkflowState,
  type QuotationSnapshot,
  type QuotationSuggestion,
  type QueueCounts,
  type RawLeadListItem,
  type SnoozeFollowUpRecordInput,
  type TransferLeadRecordInput,
  type WonDetailsSnapshot,
  type UpdateLeadOutcomeRecordInput,
} from "./lead.types";

export const leadRepositoryToken = Symbol("LeadRepository");

export interface LeadRepository {
  findByNormalizedPhone(dataScope: DataScope, phoneNormalized: string): Promise<ExistingPhoneRecord | null>;
  createCustomerAndLead(input: CreateLeadRecordInput): Promise<CreateLeadRecordResult>;
  listRawLeads(dataScope: DataScope, access?: LeadAccessScope | null): Promise<RawLeadListItem[]>;
  listLeadsByQueue(dataScope: DataScope, queue: LeadQueue, access?: LeadAccessScope | null): Promise<RawLeadListItem[]>;
  getQueueCounts(dataScope: DataScope, access?: LeadAccessScope | null): Promise<QueueCounts>;
  getLeadWorkflowState(dataScope: DataScope, leadId: string, access?: LeadAccessScope | null): Promise<LeadWorkflowState | null>;
  getLeadDetail(dataScope: DataScope, leadId: string, access?: LeadAccessScope | null): Promise<LeadDetail | null>;
  updateLeadOutcome(input: UpdateLeadOutcomeRecordInput): Promise<LeadDetail>;
  updateLeadOutcomeAck(input: UpdateLeadOutcomeRecordInput): Promise<LeadSaveAck>;
  transferLead(input: TransferLeadRecordInput): Promise<LeadDetail>;
  listDueFollowUpAlerts(dataScope: DataScope, userId: string, now: Date): Promise<FollowUpAlert[]>;
  snoozeFollowUp(input: SnoozeFollowUpRecordInput): Promise<FollowUpAlert>;
  holdFollowUpForHandling(input: HoldFollowUpRecordInput): Promise<FollowUpAlert>;
  deleteRawLeads(input: DeleteRawLeadsRecordInput): Promise<DeleteRawLeadsResult>;
}

export class DuplicatePhoneConflictError extends Error {
  constructor(readonly existing: ExistingPhoneRecord) {
    super(`Phone number already belongs to customer ${existing.customerId}.`);
  }
}

type InMemoryFollowUp = {
  id: string;
  dataScope: DataScope;
  leadId: string;
  customerId: string;
  dueAt: Date;
  reason: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "COMPLETED" | "MISSED" | "CANCELLED";
  assignedToId: string | null;
  snoozeCount: number;
  snoozedUntil: Date | null;
  lastAlertedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class InMemoryLeadRepository implements LeadRepository {
  private readonly phoneIndex = new Map<string, ExistingPhoneRecord>();
  private readonly leadCycleByCustomer = new Map<string, number>();
  private readonly customers = new Map<string, CreateLeadRecordResult["customer"]>();
  private readonly leads = new Map<string, CreateLeadRecordResult["lead"]>();
  private readonly activities = new Map<string, CreateLeadRecordResult["activity"][]>();
  private readonly followUps = new Map<string, InMemoryFollowUp>();
  private readonly leadAssignees = new Map<string, string | null>();
  private readonly quotationItems = new Map<string, QuotationSuggestion["items"][number]>();
  private readonly quotationTemplates = new Map<string, QuotationSuggestion["packages"][number]>();
  private readonly leadQuotations = new Map<string, QuotationSnapshot[]>();
  private readonly wonDetails = new Map<string, WonDetailsSnapshot>();

  async findByNormalizedPhone(dataScope: DataScope, phoneNormalized: string): Promise<ExistingPhoneRecord | null> {
    return this.phoneIndex.get(this.scopedPhoneKey(dataScope, phoneNormalized)) ?? null;
  }

  async createCustomerAndLead(input: CreateLeadRecordInput): Promise<CreateLeadRecordResult> {
    const existing = await this.findByNormalizedPhone(input.dataScope, input.phoneNormalized);

    if (existing) {
      throw new DuplicatePhoneConflictError(existing);
    }

    const customerId = randomUUID();
    const leadId = randomUUID();
    const activityId = randomUUID();
    const leadCycleNumber = this.nextLeadCycleNumber(customerId);

    const customer = {
      id: customerId,
      dataScope: input.dataScope,
      businessName: input.businessName,
      primaryPhoneNormalized: input.phoneNormalized,
      createdAt: input.now,
    };

    const lead = {
      id: leadId,
      dataScope: input.dataScope,
      customerId,
      leadCycleNumber,
      currentStage: "RAW_UNTOUCHED" as const,
      currentIntent: "UNKNOWN" as const,
      source: input.source,
      priority: "MEDIUM" as const,
      nextFollowUpAt: null,
      followUpReason: null,
      siteVisitStatus: null,
      siteVisitScheduledAt: null,
      notReceivingCount: 0,
      spokenCount: 0,
      isArchived: false,
      archiveCategory: null,
      createdAt: input.now,
      updatedAt: input.now,
    };

    const activity = {
      id: activityId,
      leadId,
      customerId,
      type: "LEAD_CREATED" as const,
      summary: `Lead created from ${input.source}.`,
      createdAt: input.now,
    };

    this.phoneIndex.set(this.scopedPhoneKey(input.dataScope, input.phoneNormalized), {
      dataScope: input.dataScope,
      phoneNormalized: input.phoneNormalized,
      customerId,
      customerName: input.businessName,
      currentLeadId: leadId,
      currentStage: "RAW_UNTOUCHED",
      isActive: true,
      isArchived: false,
      assignedToName: null,
      nextFollowUpAt: null,
      lastActivitySummary: activity.summary,
      lastUpdatedAt: input.now,
      totalJobs: 0,
    });
    this.customers.set(customerId, customer);
    this.leads.set(leadId, lead);
    this.leadAssignees.set(leadId, input.assignedToId);
    this.activities.set(leadId, [activity]);

    return { customer, lead, activity };
  }

  async listRawLeads(dataScope: DataScope, access: LeadAccessScope | null = null): Promise<RawLeadListItem[]> {
    return this.listLeadsByQueue(dataScope, "RAW", access);
  }

  async listLeadsByQueue(dataScope: DataScope, queue: LeadQueue, access: LeadAccessScope | null = null): Promise<RawLeadListItem[]> {
    return Array.from(this.leads.values())
      .filter((lead) => lead.dataScope === dataScope)
      .filter((lead) => this.canAccessLead(lead.id, access))
      .filter((lead) => this.isLeadInQueue(lead, queue))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((lead) => this.toRawLeadListItem(lead));
  }

  async getQueueCounts(dataScope: DataScope, access: LeadAccessScope | null = null): Promise<QueueCounts> {
    return {
      RAW: (await this.listLeadsByQueue(dataScope, "RAW", access)).length,
      WARM: (await this.listLeadsByQueue(dataScope, "WARM", access)).length,
      HOT_INSTALLATION: (await this.listLeadsByQueue(dataScope, "HOT_INSTALLATION", access)).length,
      HOT_REPAIR_SERVICE: (await this.listLeadsByQueue(dataScope, "HOT_REPAIR_SERVICE", access)).length,
      UNANSWERED: (await this.listLeadsByQueue(dataScope, "UNANSWERED", access)).length,
      GHOSTING: (await this.listLeadsByQueue(dataScope, "GHOSTING", access)).length,
      WON: (await this.listLeadsByQueue(dataScope, "WON", access)).length,
      LOST: (await this.listLeadsByQueue(dataScope, "LOST", access)).length,
      ARCHIVE: (await this.listLeadsByQueue(dataScope, "ARCHIVE", access)).length,
    };
  }

  async getLeadDetail(dataScope: DataScope, leadId: string, access: LeadAccessScope | null = null): Promise<LeadDetail | null> {
    const lead = this.leads.get(leadId);

    if (!lead || lead.dataScope !== dataScope || !this.canAccessLead(lead.id, access)) {
      return null;
    }

    return {
      ...this.toRawLeadListItem(lead),
      leadCycleNumber: lead.leadCycleNumber,
      siteVisitStatus: lead.siteVisitStatus,
      siteVisitScheduledAt: lead.siteVisitScheduledAt,
      spokenCount: lead.spokenCount,
      isArchived: lead.isArchived,
      archiveCategory: lead.archiveCategory,
      latestQuotation: this.getLatestQuotation(lead.id),
      wonDetails: this.wonDetails.get(lead.id) ?? null,
      quotationSuggestions: this.getQuotationSuggestions(dataScope),
      timeline: (this.activities.get(leadId) ?? []).map((activity) => ({
        id: activity.id,
        type: activity.type,
        summary: activity.summary,
        createdByName: null,
        createdAt: activity.createdAt,
      })),
      firstCallOutcomeOptions: ["SPOKE", "WARM", "NOT_INTERESTED", "WRONG_NUMBER", "NOT_RECEIVING"],
      followUpOutcomeOptions:
        lead.spokenCount === 0 || lead.currentStage === "WARM"
          ? ["SPOKE", "WARM", "NOT_INTERESTED", "WRONG_NUMBER", "NOT_RECEIVING"]
          : ["SPOKE", "WARM", "NOT_INTERESTED", "NOT_RECEIVING"],
    };
  }

  async getLeadWorkflowState(dataScope: DataScope, leadId: string, access: LeadAccessScope | null = null): Promise<LeadWorkflowState | null> {
    const lead = this.leads.get(leadId);

    if (!lead || lead.dataScope !== dataScope || !this.canAccessLead(lead.id, access)) {
      return null;
    }

    return {
      ...this.toRawLeadListItem(lead),
      leadCycleNumber: lead.leadCycleNumber,
      siteVisitStatus: lead.siteVisitStatus,
      siteVisitScheduledAt: lead.siteVisitScheduledAt,
      spokenCount: lead.spokenCount,
      isArchived: lead.isArchived,
      archiveCategory: lead.archiveCategory,
    };
  }

  async updateLeadOutcome(input: UpdateLeadOutcomeRecordInput): Promise<LeadDetail> {
    const lead = this.leads.get(input.leadId);

    if (!lead || lead.dataScope !== input.dataScope) {
      throw new Error(`Lead ${input.leadId} was not found.`);
    }

    const customer = this.customers.get(lead.customerId);

    if (!customer) {
      throw new Error(`Missing customer for lead ${lead.id}.`);
    }

    lead.currentStage = input.currentStage;
    lead.currentIntent = input.currentIntent;
    lead.priority = input.priority;
    lead.nextFollowUpAt = input.nextFollowUpAt;
    lead.followUpReason = input.followUpReason;
    lead.siteVisitStatus = input.siteVisitStatus;
    lead.siteVisitScheduledAt = input.siteVisitScheduledAt;
    lead.notReceivingCount = input.notReceivingCount;
    lead.spokenCount = input.spokenCount;
    lead.isArchived = input.isArchived;
    lead.archiveCategory = input.archiveCategory;
    lead.updatedAt = input.now;

    const activity = {
      id: randomUUID(),
      leadId: lead.id,
      customerId: lead.customerId,
      type: input.activityType,
      summary: input.activitySummary,
      createdAt: input.now,
    };
    this.activities.set(lead.id, [...(this.activities.get(lead.id) ?? []), activity]);
    this.closeOpenFollowUps(lead.id, input.now, "COMPLETED");

    if (input.quotation) {
      this.persistQuotation(lead.id, input.quotation, input.now);
    }

    if (input.wonDetails) {
      this.wonDetails.set(lead.id, {
        ...input.wonDetails,
        createdAt: input.now,
      });
    }

    const phoneEntry = Array.from(this.phoneIndex.values()).find((entry) => entry.currentLeadId === lead.id);

    if (!phoneEntry) {
      throw new Error(`Missing phone index for lead ${lead.id}.`);
    }

    this.phoneIndex.set(this.scopedPhoneKey(input.dataScope, customer.primaryPhoneNormalized), {
      ...phoneEntry,
      currentStage: input.currentStage,
      isActive: !input.isArchived,
      isArchived: input.isArchived,
      nextFollowUpAt: input.nextFollowUpAt,
      lastActivitySummary: input.activitySummary,
      lastUpdatedAt: input.now,
    });

    if (input.nextFollowUpAt) {
      this.createFollowUp({
        dataScope: input.dataScope,
        leadId: lead.id,
        customerId: lead.customerId,
        dueAt: input.nextFollowUpAt,
        reason: input.followUpReason ?? "FOLLOW_UP",
        priority: input.priority,
        assignedToId: this.leadAssignees.get(lead.id) ?? null,
        now: input.now,
      });
    }

    const detail = await this.getLeadDetail(input.dataScope, input.leadId);

    if (!detail) {
      throw new Error(`Lead ${input.leadId} was not found after update.`);
    }

    return detail;
  }

  async updateLeadOutcomeAck(input: UpdateLeadOutcomeRecordInput): Promise<LeadSaveAck> {
    const updated = await this.updateLeadOutcome(input);

    return {
      id: updated.id,
      dataScope: updated.dataScope,
      customerId: updated.customerId,
      customerName: updated.customerName,
      phoneNormalized: updated.phoneNormalized,
      source: updated.source,
      currentStage: updated.currentStage,
      currentIntent: updated.currentIntent,
      priority: updated.priority,
      nextFollowUpAt: updated.nextFollowUpAt,
      followUpReason: updated.followUpReason,
      notReceivingCount: updated.notReceivingCount,
      assignedToName: updated.assignedToName,
      lastActivitySummary: input.activitySummary,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      savedAt: input.now,
      serverConfirmed: true,
    };
  }

  async transferLead(input: TransferLeadRecordInput): Promise<LeadDetail> {
    const lead = this.leads.get(input.leadId);

    if (!lead || lead.dataScope !== input.dataScope) {
      throw new Error(`Lead ${input.leadId} was not found.`);
    }

    lead.nextFollowUpAt = input.followUpAt;
    lead.updatedAt = input.now;
    this.leadAssignees.set(lead.id, input.toUserId);
    this.closeOpenFollowUps(lead.id, input.now, "CANCELLED");

    const activity = {
      id: randomUUID(),
      leadId: lead.id,
      customerId: lead.customerId,
      type: "LEAD_TRANSFERRED" as const,
      summary: `Lead transferred to ${input.toUserId}. Reason: ${input.reason}`,
      createdAt: input.now,
    };
    this.activities.set(lead.id, [...(this.activities.get(lead.id) ?? []), activity]);

    const phoneEntry = Array.from(this.phoneIndex.values()).find((entry) => entry.currentLeadId === lead.id);

    if (phoneEntry) {
      this.phoneIndex.set(this.scopedPhoneKey(input.dataScope, phoneEntry.phoneNormalized), {
        ...phoneEntry,
        assignedToName: input.toUserId,
        nextFollowUpAt: input.followUpAt,
        lastActivitySummary: activity.summary,
        lastUpdatedAt: input.now,
      });
    }

    this.createFollowUp({
      dataScope: input.dataScope,
      leadId: lead.id,
      customerId: lead.customerId,
      dueAt: input.followUpAt,
      reason: "TRANSFERRED_LEAD",
      priority: lead.priority,
      assignedToId: input.toUserId,
      now: input.now,
    });

    const detail = await this.getLeadDetail(input.dataScope, input.leadId);

    if (!detail) {
      throw new Error(`Lead ${input.leadId} was not found after transfer.`);
    }

    return detail;
  }

  async listDueFollowUpAlerts(dataScope: DataScope, userId: string, now: Date): Promise<FollowUpAlert[]> {
    const alerts = Array.from(this.followUps.values())
      .filter((followUp) => followUp.dataScope === dataScope)
      .filter((followUp) => followUp.status === "OPEN")
      .filter((followUp) => followUp.assignedToId === userId)
      .filter((followUp) => followUp.dueAt.getTime() <= now.getTime())
      .filter((followUp) => !followUp.snoozedUntil || followUp.snoozedUntil.getTime() <= now.getTime())
      .map((followUp) => this.toFollowUpAlert(followUp))
      .filter((alert): alert is FollowUpAlert => Boolean(alert))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    for (const alert of alerts) {
      const followUp = this.followUps.get(alert.id);

      if (followUp) {
        followUp.lastAlertedAt = now;
        followUp.updatedAt = now;
      }
    }

    return alerts;
  }

  async snoozeFollowUp(input: SnoozeFollowUpRecordInput): Promise<FollowUpAlert> {
    const followUp = this.requireOwnedOpenFollowUp(input.dataScope, input.followUpId, input.userId);

    if (followUp.snoozeCount >= 3) {
      throw new Error("This follow-up has already been snoozed 3 times. You must handle it or assign it now.");
    }

    followUp.snoozeCount += 1;
    followUp.snoozedUntil = new Date(input.now.getTime() + input.minutes * 60 * 1000);
    followUp.updatedAt = input.now;
    this.appendLeadActivity(followUp.leadId, "FOLLOW_UP_SCHEDULED", `Follow-up snoozed for ${input.minutes} minutes. Snooze ${followUp.snoozeCount}/3.`, input.now);

    const alert = this.toFollowUpAlert(followUp);

    if (!alert) {
      throw new Error("Follow-up alert could not be loaded after snooze.");
    }

    return alert;
  }

  async holdFollowUpForHandling(input: HoldFollowUpRecordInput): Promise<FollowUpAlert> {
    const followUp = this.requireOwnedOpenFollowUp(input.dataScope, input.followUpId, input.userId);
    followUp.snoozedUntil = new Date(input.now.getTime() + input.holdMinutes * 60 * 1000);
    followUp.updatedAt = input.now;
    this.appendLeadActivity(followUp.leadId, "FOLLOW_UP_COMPLETED", `Follow-up opened for handling. Alert held for ${input.holdMinutes} minutes.`, input.now);

    const alert = this.toFollowUpAlert(followUp);

    if (!alert) {
      throw new Error("Follow-up alert could not be loaded after handle-now hold.");
    }

    return alert;
  }

  async deleteRawLeads(input: DeleteRawLeadsRecordInput): Promise<DeleteRawLeadsResult> {
    const requestedIds = new Set(input.leadIds);
    const targets = Array.from(this.leads.values()).filter((lead) => {
      if (lead.dataScope !== input.dataScope || lead.currentStage !== "RAW_UNTOUCHED" || lead.isArchived) {
        return false;
      }

      if (!this.canAccessLead(lead.id, input.access)) {
        return false;
      }

      return input.deleteAllRaw || requestedIds.has(lead.id);
    });

    const deletedLeadIds = targets.map((lead) => lead.id);
    const deletedCustomerIds = targets.map((lead) => lead.customerId);

    for (const lead of targets) {
      const customer = this.customers.get(lead.customerId);

      if (customer) {
        this.phoneIndex.delete(this.scopedPhoneKey(input.dataScope, customer.primaryPhoneNormalized));
      }

      this.leads.delete(lead.id);
      this.customers.delete(lead.customerId);
      this.activities.delete(lead.id);
      this.followUps.forEach((followUp, followUpId) => {
        if (followUp.leadId === lead.id) {
          this.followUps.delete(followUpId);
        }
      });
      this.leadAssignees.delete(lead.id);
      this.leadQuotations.delete(lead.id);
      this.wonDetails.delete(lead.id);
    }

    return {
      mode: input.deleteAllRaw ? "allRaw" : "selected",
      deletedCount: deletedLeadIds.length,
      skippedCount: input.deleteAllRaw ? 0 : Math.max(0, input.leadIds.length - deletedLeadIds.length),
      deletedLeadIds,
      deletedCustomerIds,
    };
  }

  seedExistingPhone(record: ExistingPhoneRecord): void {
    this.phoneIndex.set(this.scopedPhoneKey(record.dataScope, record.phoneNormalized), record);
  }

  private createFollowUp(input: {
    dataScope: DataScope;
    leadId: string;
    customerId: string;
    dueAt: Date;
    reason: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    assignedToId: string | null;
    now: Date;
  }): void {
    const id = randomUUID();
    this.followUps.set(id, {
      id,
      dataScope: input.dataScope,
      leadId: input.leadId,
      customerId: input.customerId,
      dueAt: input.dueAt,
      reason: input.reason,
      priority: input.priority,
      status: "OPEN",
      assignedToId: input.assignedToId,
      snoozeCount: 0,
      snoozedUntil: null,
      lastAlertedAt: null,
      completedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  private closeOpenFollowUps(leadId: string, now: Date, status: "COMPLETED" | "CANCELLED"): void {
    for (const followUp of this.followUps.values()) {
      if (followUp.leadId !== leadId || followUp.status !== "OPEN") {
        continue;
      }

      followUp.status = status;
      followUp.completedAt = status === "COMPLETED" ? now : null;
      followUp.updatedAt = now;
    }
  }

  private requireOwnedOpenFollowUp(dataScope: DataScope, followUpId: string, userId: string): InMemoryFollowUp {
    const followUp = this.followUps.get(followUpId);

    if (!followUp || followUp.dataScope !== dataScope || followUp.status !== "OPEN" || followUp.assignedToId !== userId) {
      throw new Error("Follow-up alert was not found for this user.");
    }

    return followUp;
  }

  private appendLeadActivity(leadId: string, type: CreateLeadRecordResult["activity"]["type"], summary: string, now: Date): void {
    const lead = this.leads.get(leadId);

    if (!lead) {
      return;
    }

    this.activities.set(leadId, [
      ...(this.activities.get(leadId) ?? []),
      {
        id: randomUUID(),
        leadId,
        customerId: lead.customerId,
        type,
        summary,
        createdAt: now,
      },
    ]);
  }

  private canAccessLead(leadId: string, access: LeadAccessScope | null | undefined): boolean {
    if (!access || access.canViewAllLeads) {
      return true;
    }

    return this.leadAssignees.get(leadId) === access.actorId;
  }

  private toFollowUpAlert(followUp: InMemoryFollowUp): FollowUpAlert | null {
    const lead = this.leads.get(followUp.leadId);
    const listItem = lead ? this.toRawLeadListItem(lead) : null;

    if (!lead || !listItem || lead.isArchived) {
      return null;
    }

    return {
      id: followUp.id,
      leadId: followUp.leadId,
      customerId: followUp.customerId,
      customerName: listItem.customerName,
      phoneNormalized: listItem.phoneNormalized,
      currentStage: listItem.currentStage,
      currentIntent: listItem.currentIntent,
      priority: listItem.priority,
      reason: followUp.reason,
      dueAt: followUp.dueAt,
      assignedToName: listItem.assignedToName,
      lastActivitySummary: listItem.lastActivitySummary,
      snoozeCount: followUp.snoozeCount,
      snoozedUntil: followUp.snoozedUntil,
      maxSnoozes: 3,
      isTransfer: followUp.reason === "TRANSFERRED_LEAD",
    };
  }

  private nextLeadCycleNumber(customerId: string): number {
    const current = this.leadCycleByCustomer.get(customerId) ?? 0;
    const next = current + 1;
    this.leadCycleByCustomer.set(customerId, next);
    return next;
  }

  private isLeadInQueue(lead: CreateLeadRecordResult["lead"], queue: LeadQueue): boolean {
    if (queue === "ARCHIVE") {
      return lead.isArchived;
    }

    if (lead.isArchived) {
      return false;
    }

    const queueStages: Record<Exclude<LeadQueue, "ARCHIVE">, string[]> = {
      RAW: ["RAW_UNTOUCHED"],
      WARM: ["WARM"],
      HOT_INSTALLATION: ["HOT_INSTALLATION"],
      HOT_REPAIR_SERVICE: ["HOT_REPAIR_SERVICE"],
      UNANSWERED: ["NOT_RECEIVING"],
      GHOSTING: ["GHOSTING"],
      WON: ["CAPTURED_WON"],
      LOST: ["LOST"],
    };

    return queueStages[queue].includes(lead.currentStage);
  }

  private toRawLeadListItem(lead: CreateLeadRecordResult["lead"]): RawLeadListItem {
    const customer = this.customers.get(lead.customerId);

    if (!customer) {
      throw new Error(`Missing customer for lead ${lead.id}.`);
    }

    const phone = Array.from(this.phoneIndex.values()).find((entry) => entry.currentLeadId === lead.id);

    if (!phone) {
      throw new Error(`Missing phone index for lead ${lead.id}.`);
    }

    const timeline = this.activities.get(lead.id) ?? [];
    const lastActivity = timeline[timeline.length - 1] ?? null;

    return {
      id: lead.id,
      dataScope: lead.dataScope,
      customerId: lead.customerId,
      customerName: customer.businessName,
      phoneNormalized: customer.primaryPhoneNormalized,
      source: lead.source,
      currentStage: lead.currentStage,
      currentIntent: lead.currentIntent,
      priority: lead.priority,
      nextFollowUpAt: lead.nextFollowUpAt ?? phone.nextFollowUpAt,
      followUpReason: lead.followUpReason,
      notReceivingCount: lead.notReceivingCount,
      assignedToName: phone.assignedToName,
      lastActivitySummary: lastActivity?.summary ?? null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  private scopedPhoneKey(dataScope: DataScope, phoneNormalized: string): string {
    return `${dataScope}:${phoneNormalized}`;
  }

  private scopedNameKey(dataScope: DataScope, name: string): string {
    return `${dataScope}:${name.trim().toLowerCase()}`;
  }

  private persistQuotation(leadId: string, quotation: NonNullable<UpdateLeadOutcomeRecordInput["quotation"]>, now: Date): void {
    const snapshot: QuotationSnapshot = {
      id: randomUUID(),
      title: quotation.title,
      totalPricePaise: quotation.totalPricePaise,
      createdAt: now,
      packages: quotation.packages.map((pkg) => ({
        packageName: pkg.packageName,
        multiplier: pkg.multiplier,
        packageTotalPaise: pkg.packageTotalPaise,
        items: pkg.items.map((item) => ({ ...item })),
      })),
    };
    this.leadQuotations.set(leadId, [...(this.leadQuotations.get(leadId) ?? []), snapshot]);

    for (const pkg of quotation.packages) {
      const packageItems: QuotationSuggestion["packages"][number]["items"] = [];

      for (const item of pkg.items) {
        const itemKey = this.scopedNameKey(this.leads.get(leadId)?.dataScope ?? "development", item.itemName);
        this.quotationItems.set(itemKey, {
          itemName: item.itemName,
          lastPricePaise: item.unitPricePaise,
        });
        packageItems.push({
          itemName: item.itemName,
          unitPricePaise: item.unitPricePaise,
          quantity: item.quantity,
        });
      }

      const dataScope = this.leads.get(leadId)?.dataScope ?? "development";
      this.quotationTemplates.set(this.scopedNameKey(dataScope, pkg.packageName), {
        packageName: pkg.packageName,
        items: packageItems,
      });
    }
  }

  private getLatestQuotation(leadId: string): QuotationSnapshot | null {
    const quotations = this.leadQuotations.get(leadId) ?? [];
    return quotations[quotations.length - 1] ?? null;
  }

  private getQuotationSuggestions(dataScope: DataScope): QuotationSuggestion {
    const prefix = `${dataScope}:`;
    return {
      items: Array.from(this.quotationItems.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, item]) => item)
        .sort((a, b) => a.itemName.localeCompare(b.itemName)),
      packages: Array.from(this.quotationTemplates.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, pkg]) => pkg)
        .sort((a, b) => a.packageName.localeCompare(b.packageName)),
    };
  }
}
