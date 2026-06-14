import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DataScope } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import {
  ArchiveCategory as DbArchiveCategory,
  type Customer as DbCustomer,
  DataScope as DbDataScope,
  type FollowUp as DbFollowUp,
  type Lead as DbLead,
  type LeadActivity as DbLeadActivity,
  type LeadQuotation as DbLeadQuotation,
  type LeadQuotationItem as DbLeadQuotationItem,
  type LeadQuotationPackage as DbLeadQuotationPackage,
  LeadStage as DbLeadStage,
  type PhoneIndex as DbPhoneIndex,
  Prisma,
  type QuotationItem as DbQuotationItem,
  type QuotationPackageTemplate as DbQuotationPackageTemplate,
  type QuotationPackageTemplateItem as DbQuotationPackageTemplateItem,
  type StaffActivityType as DbStaffActivityType,
  type WonLeadDetails as DbWonLeadDetails,
} from "../generated/prisma/client";
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
import { DuplicatePhoneConflictError, type LeadRepository } from "./lead.repository";

type LeadWithCustomer = DbLead & {
  customer: DbCustomer;
  assignedTo?: { name: string } | null;
  activities?: LeadActivityWithCreator[];
  quotations?: QuotationWithPackages[];
  wonDetails?: DbWonLeadDetails | null;
};

type LeadActivityWithCreator = DbLeadActivity & {
  createdBy?: { name: string } | null;
};

type QuotationWithPackages = DbLeadQuotation & {
  packages: Array<
    DbLeadQuotationPackage & {
      items: DbLeadQuotationItem[];
    }
  >;
};

type PackageTemplateWithItems = DbQuotationPackageTemplate & {
  items: Array<
    DbQuotationPackageTemplateItem & {
      quotationItem: DbQuotationItem;
    }
  >;
};

type PhoneIndexWithRelations = DbPhoneIndex & {
  customer: DbCustomer;
  currentLead?: (DbLead & {
    assignedTo?: { name: string } | null;
    activities?: LeadActivityWithCreator[];
  }) | null;
};

type FollowUpWithLead = DbFollowUp & {
  lead: DbLead & {
    customer: DbCustomer;
    assignedTo?: { name: string } | null;
    activities?: LeadActivityWithCreator[];
  };
};

type LeadSaveAckRow = {
  id: string;
  data_scope: DbDataScope;
  customer_id: string;
  customer_name: string;
  phone_normalized: string;
  source: string;
  current_stage: LeadSaveAck["currentStage"];
  current_intent: LeadSaveAck["currentIntent"];
  priority: LeadSaveAck["priority"];
  next_follow_up_at: Date | null;
  follow_up_reason: LeadSaveAck["followUpReason"];
  not_receiving_count: number;
  assigned_to_name: string | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class PrismaLeadRepository implements LeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByNormalizedPhone(dataScope: DataScope, phoneNormalized: string): Promise<ExistingPhoneRecord | null> {
    const phoneEntry = await this.prisma.phoneIndex.findUnique({
      where: {
        dataScope_phoneNormalized: {
          dataScope: toDbDataScope(dataScope),
          phoneNormalized,
        },
      },
      include: {
        customer: true,
        currentLead: {
          include: {
            assignedTo: { select: { name: true } },
            activities: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    return phoneEntry ? this.toExistingPhoneRecord(phoneEntry as PhoneIndexWithRelations) : null;
  }

  async createCustomerAndLead(input: CreateLeadRecordInput): Promise<CreateLeadRecordResult> {
    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.phoneIndex.findUnique({
        where: {
          dataScope_phoneNormalized: {
            dataScope: toDbDataScope(input.dataScope),
            phoneNormalized: input.phoneNormalized,
          },
        },
        include: {
          customer: true,
          currentLead: {
            include: {
              assignedTo: { select: { name: true } },
              activities: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (existing) {
        throw new DuplicatePhoneConflictError(this.toExistingPhoneRecord(existing as PhoneIndexWithRelations));
      }

      const customer = await tx.customer.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          businessName: input.businessName,
          primaryPhoneNormalized: input.phoneNormalized,
          lastInteractionAt: input.now,
        },
      });

      const lead = await tx.lead.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          customerId: customer.id,
          leadCycleNumber: 1,
          source: input.source,
          currentStage: "RAW_UNTOUCHED",
          currentIntent: "UNKNOWN",
          assignedToId: input.assignedToId,
          priority: "MEDIUM",
          createdAt: input.now,
          updatedAt: input.now,
        },
      });

      const activity = await tx.leadActivity.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          leadId: lead.id,
          customerId: customer.id,
          type: "LEAD_CREATED",
          summary: `Lead created from ${input.source}.`,
          createdById: input.createdById,
          createdAt: input.now,
        },
      });

      if (input.createdById) {
        await tx.staffActivityEvent.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            userId: input.createdById,
            leadId: lead.id,
            customerId: customer.id,
            type: input.source.toUpperCase().includes("IMPORT") || input.source.toUpperCase().includes("CSV") ? "LEAD_IMPORTED" : "LEAD_CREATED",
            summary: `Created raw lead for ${customer.businessName} from ${input.source}.`,
            metadata: {
              source: input.source,
              phoneNormalized: input.phoneNormalized,
            },
            occurredAt: input.now,
            createdAt: input.now,
          },
        });
      }

      await tx.phoneIndex.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          phoneNormalized: input.phoneNormalized,
          customerId: customer.id,
          currentLeadId: lead.id,
          currentStage: "RAW_UNTOUCHED",
          isPrimary: true,
          isActive: true,
          isArchived: false,
        },
      });

      return { customer, lead, activity };
    });

    return {
      customer: {
        id: created.customer.id,
        dataScope: toAppDataScope(created.customer.dataScope),
        businessName: created.customer.businessName,
        primaryPhoneNormalized: created.customer.primaryPhoneNormalized,
        createdAt: created.customer.createdAt,
      },
      lead: {
        id: created.lead.id,
        dataScope: toAppDataScope(created.lead.dataScope),
        customerId: created.lead.customerId,
        leadCycleNumber: created.lead.leadCycleNumber,
        currentStage: created.lead.currentStage,
        currentIntent: created.lead.currentIntent,
        source: created.lead.source,
        priority: created.lead.priority,
        nextFollowUpAt: created.lead.nextFollowUpAt,
        followUpReason: created.lead.followUpReason,
        siteVisitStatus: created.lead.siteVisitStatus,
        siteVisitScheduledAt: created.lead.siteVisitScheduledAt,
        notReceivingCount: created.lead.notReceivingCount,
        spokenCount: created.lead.spokenCount,
        isArchived: created.lead.isArchived,
        archiveCategory: created.lead.archiveCategory,
        createdAt: created.lead.createdAt,
        updatedAt: created.lead.updatedAt,
      },
      activity: {
        id: created.activity.id,
        leadId: created.activity.leadId,
        customerId: created.activity.customerId,
        type: created.activity.type,
        summary: created.activity.summary ?? "",
        createdAt: created.activity.createdAt,
      },
    };
  }

  async listRawLeads(dataScope: DataScope, access: LeadAccessScope | null = null): Promise<RawLeadListItem[]> {
    return this.listLeadsByQueue(dataScope, "RAW", access);
  }

  async listLeadsByQueue(dataScope: DataScope, queue: LeadQueue, access: LeadAccessScope | null = null): Promise<RawLeadListItem[]> {
    const leads = await this.prisma.lead.findMany({
      where: this.whereForQueue(dataScope, queue, access),
      include: {
        customer: true,
        assignedTo: { select: { name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });

    return leads.map((lead) => this.toRawLeadListItem(lead as LeadWithCustomer));
  }

  async getQueueCounts(dataScope: DataScope, access: LeadAccessScope | null = null): Promise<QueueCounts> {
    const [raw, warm, hotInstallation, hotRepairService, unanswered, ghosting, won, lost, archive] = await Promise.all([
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "RAW", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "WARM", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "HOT_INSTALLATION", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "HOT_REPAIR_SERVICE", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "UNANSWERED", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "GHOSTING", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "WON", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "LOST", access) }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "ARCHIVE", access) }),
    ]);

    return {
      RAW: raw,
      WARM: warm,
      HOT_INSTALLATION: hotInstallation,
      HOT_REPAIR_SERVICE: hotRepairService,
      UNANSWERED: unanswered,
      GHOSTING: ghosting,
      WON: won,
      LOST: lost,
      ARCHIVE: archive,
    };
  }

  async deleteRawLeads(input: DeleteRawLeadsRecordInput): Promise<DeleteRawLeadsResult> {
    const dbScope = toDbDataScope(input.dataScope);
    const result = await this.prisma.$transaction(async (tx) => {
      const requestedIds = Array.from(new Set(input.leadIds));
      const targets = await tx.lead.findMany({
        where: {
          dataScope: dbScope,
          currentStage: "RAW_UNTOUCHED",
          isArchived: false,
          ...this.whereForLeadAccess(input.access),
          ...(input.deleteAllRaw ? {} : { id: { in: requestedIds } }),
        },
        select: {
          id: true,
          customerId: true,
        },
      });

      if (!targets.length) {
        return {
          deletedLeadIds: [],
          deletedCustomerIds: [],
          skippedCount: input.deleteAllRaw ? 0 : requestedIds.length,
        };
      }

      const targetLeadIds = targets.map((lead) => lead.id);
      const targetCustomerIds = Array.from(new Set(targets.map((lead) => lead.customerId)));
      const protectedJobLeadIds = new Set(
        (
          await tx.job.findMany({
            where: { leadId: { in: targetLeadIds } },
            select: { leadId: true },
          })
        ).map((job) => job.leadId),
      );
      const safeLeadIds = targetLeadIds.filter((leadId) => !protectedJobLeadIds.has(leadId));
      const safeCustomerIds = Array.from(new Set(targets.filter((lead) => safeLeadIds.includes(lead.id)).map((lead) => lead.customerId)));

      if (!safeLeadIds.length) {
        return {
          deletedLeadIds: [],
          deletedCustomerIds: [],
          skippedCount: input.deleteAllRaw ? targetLeadIds.length : Math.max(0, requestedIds.length),
        };
      }

      await tx.importRow.updateMany({
        where: { leadId: { in: safeLeadIds } },
        data: { leadId: null },
      });
      await tx.staffActivityEvent.updateMany({
        where: { leadId: { in: safeLeadIds } },
        data: { leadId: null },
      });
      await tx.wonLeadDetails.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.leadQuotation.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.whatsAppMessage.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.followUp.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.archiveRecord.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.leadActivity.deleteMany({ where: { leadId: { in: safeLeadIds } } });
      await tx.phoneIndex.updateMany({
        where: { currentLeadId: { in: safeLeadIds } },
        data: {
          currentLeadId: null,
          currentStage: "RAW_UNTOUCHED",
          isActive: false,
          isArchived: false,
        },
      });
      await tx.lead.deleteMany({ where: { id: { in: safeLeadIds } } });

      const remainingLeadCustomerIds = new Set(
        (
          await tx.lead.findMany({
            where: { customerId: { in: safeCustomerIds } },
            select: { customerId: true },
          })
        ).map((lead) => lead.customerId),
      );
      const jobCustomerIds = new Set(
        (
          await tx.job.findMany({
            where: { customerId: { in: safeCustomerIds } },
            select: { customerId: true },
          })
        ).map((job) => job.customerId),
      );
      const certificateCustomerIds = new Set(
        (
          await tx.workCertificate.findMany({
            where: { customerId: { in: safeCustomerIds } },
            select: { customerId: true },
          })
        ).map((certificate) => certificate.customerId),
      );
      const deletableCustomerIds = safeCustomerIds.filter(
        (customerId) => !remainingLeadCustomerIds.has(customerId) && !jobCustomerIds.has(customerId) && !certificateCustomerIds.has(customerId),
      );

      if (deletableCustomerIds.length) {
        await tx.phoneIndex.deleteMany({ where: { customerId: { in: deletableCustomerIds } } });
        await tx.customer.deleteMany({ where: { id: { in: deletableCustomerIds } } });
      }

      await tx.auditLog.create({
        data: {
          dataScope: dbScope,
          actorId: input.actorId,
          action: "RAW_LEADS_DELETED",
          entityType: "Lead",
          entityId: input.deleteAllRaw ? "ALL_RAW" : safeLeadIds.slice(0, 5).join(","),
          before: {
            leadIds: safeLeadIds,
            customerIds: safeCustomerIds,
          },
          after: Prisma.JsonNull,
          metadata: {
            mode: input.deleteAllRaw ? "allRaw" : "selected",
            requestedCount: input.deleteAllRaw ? "ALL_RAW" : requestedIds.length,
            deletedCount: safeLeadIds.length,
            skippedCount: input.deleteAllRaw ? targetLeadIds.length - safeLeadIds.length : Math.max(0, requestedIds.length - safeLeadIds.length),
          },
          createdAt: input.now,
        },
      });

      return {
        deletedLeadIds: safeLeadIds,
        deletedCustomerIds: deletableCustomerIds,
        skippedCount: input.deleteAllRaw ? targetLeadIds.length - safeLeadIds.length : Math.max(0, requestedIds.length - safeLeadIds.length),
      };
    });

    return {
      mode: input.deleteAllRaw ? "allRaw" : "selected",
      deletedCount: result.deletedLeadIds.length,
      skippedCount: result.skippedCount,
      deletedLeadIds: result.deletedLeadIds,
      deletedCustomerIds: result.deletedCustomerIds,
    };
  }

  async getLeadWorkflowState(dataScope: DataScope, leadId: string, access: LeadAccessScope | null = null): Promise<LeadWorkflowState | null> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        dataScope: toDbDataScope(dataScope),
        ...this.whereForLeadAccess(access),
      },
      include: {
        customer: true,
        assignedTo: { select: { name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return lead ? this.toLeadWorkflowState(lead as LeadWithCustomer) : null;
  }

  async getLeadDetail(dataScope: DataScope, leadId: string, access: LeadAccessScope | null = null): Promise<LeadDetail | null> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        dataScope: toDbDataScope(dataScope),
        ...this.whereForLeadAccess(access),
      },
      include: {
        customer: true,
        assignedTo: { select: { name: true } },
        activities: {
          orderBy: { createdAt: "asc" },
          include: { createdBy: { select: { name: true } } },
        },
        quotations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            packages: {
              orderBy: { sortOrder: "asc" },
              include: {
                items: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
        wonDetails: true,
      },
    });

    if (!lead) {
      return null;
    }

    const quotationSuggestions = await this.getQuotationSuggestions(dataScope);
    return this.toLeadDetail(lead as LeadWithCustomer, quotationSuggestions);
  }

  private async getQuotationSuggestions(dataScope: DataScope): Promise<QuotationSuggestion> {
    const [items, packages] = await Promise.all([
      this.prisma.quotationItem.findMany({
        where: { dataScope: toDbDataScope(dataScope) },
        orderBy: { itemName: "asc" },
      }),
      this.prisma.quotationPackageTemplate.findMany({
        where: { dataScope: toDbDataScope(dataScope) },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: { quotationItem: true },
          },
        },
        orderBy: { packageName: "asc" },
      }),
    ]);

    return {
      items: items.map((item) => ({
        itemName: item.itemName,
        lastPricePaise: item.lastPricePaise,
      })),
      packages: (packages as PackageTemplateWithItems[]).map((pkg) => ({
        packageName: pkg.packageName,
        items: pkg.items.map((item) => ({
          itemName: item.quotationItem.itemName,
          unitPricePaise: item.unitPricePaise,
          quantity: item.quantity,
        })),
      })),
    };
  }

  async updateLeadOutcome(input: UpdateLeadOutcomeRecordInput): Promise<LeadDetail> {
    const persisted = await this.persistLeadOutcome(input);
    const detail = await this.getLeadDetail(input.dataScope, persisted.lead.id);

    if (!detail) {
      throw new Error(`Lead ${persisted.lead.id} was not found after update.`);
    }

    return detail;
  }

  async updateLeadOutcomeAck(input: UpdateLeadOutcomeRecordInput): Promise<LeadSaveAck> {
    if (this.canUseCompactAck(input)) {
      return this.updateLeadOutcomeAckCompact(input);
    }

    const persisted = await this.persistLeadOutcome(input);
    return this.toLeadSaveAck(persisted.existing, persisted.lead, input);
  }

  async transferLead(input: TransferLeadRecordInput): Promise<LeadDetail> {
    await this.prisma.$transaction(async (tx) => {
      const dataScope = toDbDataScope(input.dataScope);
      const [lead, actor, target] = await Promise.all([
        tx.lead.findUnique({
          where: { id: input.leadId },
          include: { customer: true, assignedTo: { select: { id: true, name: true } } },
        }),
        tx.user.findUnique({ where: { id: input.fromUserId }, select: { id: true, name: true, dataScope: true, status: true } }),
        tx.user.findUnique({ where: { id: input.toUserId }, select: { id: true, name: true, dataScope: true, status: true } }),
      ]);

      if (!lead || lead.dataScope !== dataScope) {
        throw new Error(`Lead ${input.leadId} was not found.`);
      }

      if (!actor || actor.dataScope !== dataScope || actor.status !== "ACTIVE") {
        throw new Error("Transfer actor is not an active CI4U user.");
      }

      if (!target || target.dataScope !== dataScope || target.status !== "ACTIVE") {
        throw new Error("Transfer target is not an active CI4U user.");
      }

      await tx.lead.update({
        where: { id: lead.id },
        data: {
          assignedToId: target.id,
          nextFollowUpAt: input.followUpAt,
          updatedAt: input.now,
        },
      });

      await tx.followUp.updateMany({
        where: {
          dataScope,
          leadId: lead.id,
          status: "OPEN",
        },
        data: {
          status: "CANCELLED",
          updatedAt: input.now,
        },
      });

      await tx.followUp.create({
        data: {
          dataScope,
          leadId: lead.id,
          customerId: lead.customerId,
          dueAt: input.followUpAt,
          reason: "TRANSFERRED_LEAD",
          priority: lead.priority,
          status: "OPEN",
          assignedToId: target.id,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });

      const previousOwner = lead.assignedTo?.name ?? "Unassigned";
      const summary = `Lead transferred from ${previousOwner} to ${target.name} by ${actor.name}. Reason: ${input.reason}`;

      await tx.leadActivity.create({
        data: {
          dataScope,
          leadId: lead.id,
          customerId: lead.customerId,
          type: "LEAD_TRANSFERRED",
          oldStage: lead.currentStage,
          newStage: lead.currentStage,
          oldIntent: lead.currentIntent,
          newIntent: lead.currentIntent,
          summary,
          metadata: {
            fromUserId: lead.assignedToId,
            transferredById: actor.id,
            toUserId: target.id,
            followUpAt: input.followUpAt.toISOString(),
            reason: input.reason,
          },
          createdById: actor.id,
          createdAt: input.now,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope,
          userId: actor.id,
          targetUserId: target.id,
          leadId: lead.id,
          customerId: lead.customerId,
          type: "LEAD_TRANSFERRED",
          summary,
          metadata: {
            fromUserId: lead.assignedToId,
            toUserId: target.id,
            followUpAt: input.followUpAt.toISOString(),
            reason: input.reason,
          },
          occurredAt: input.now,
          createdAt: input.now,
        },
      });

      await tx.notification.create({
        data: {
          dataScope,
          userId: target.id,
          customerId: lead.customerId,
          type: "LEAD_TRANSFERRED",
          priority: lead.priority === "HIGH" || lead.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
          title: "Lead transferred to you",
          message: `${actor.name} transferred ${lead.customer.businessName} to you. Follow-up is due ${input.followUpAt.toLocaleString("en-IN")}.`,
          relatedId: lead.id,
          createdAt: input.now,
        },
      });
    });

    const detail = await this.getLeadDetail(input.dataScope, input.leadId);

    if (!detail) {
      throw new Error(`Lead ${input.leadId} was not found after transfer.`);
    }

    return detail;
  }

  async listDueFollowUpAlerts(dataScope: DataScope, userId: string, now: Date): Promise<FollowUpAlert[]> {
    const dbScope = toDbDataScope(dataScope);
    const followUps = await this.prisma.followUp.findMany({
      where: {
        dataScope: dbScope,
        assignedToId: userId,
        status: "OPEN",
        dueAt: { lte: now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        lead: {
          dataScope: dbScope,
          isArchived: false,
        },
      },
      include: {
        lead: {
          include: {
            customer: true,
            assignedTo: { select: { name: true } },
            activities: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 10,
    });

    if (followUps.length) {
      await this.prisma.followUp.updateMany({
        where: {
          id: { in: followUps.map((followUp) => followUp.id) },
          dataScope: dbScope,
          assignedToId: userId,
          status: "OPEN",
        },
        data: {
          lastAlertedAt: now,
          updatedAt: now,
        },
      });
    }

    return (followUps as FollowUpWithLead[]).map((followUp) => this.toFollowUpAlert(followUp));
  }

  async snoozeFollowUp(input: SnoozeFollowUpRecordInput): Promise<FollowUpAlert> {
    const followUp = await this.requireOwnedOpenFollowUp(input.dataScope, input.followUpId, input.userId);

    if (followUp.snoozeCount >= 3) {
      throw new Error("This follow-up has already been snoozed 3 times. You must handle it or assign it now.");
    }

    const snoozedUntil = new Date(input.now.getTime() + input.minutes * 60 * 1000);
    const nextSnoozeCount = followUp.snoozeCount + 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.followUp.update({
        where: { id: followUp.id },
        data: {
          snoozeCount: nextSnoozeCount,
          snoozedUntil,
          updatedAt: input.now,
        },
        include: {
          lead: {
            include: {
              customer: true,
              assignedTo: { select: { name: true } },
              activities: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      const summary = `Follow-up snoozed for ${input.minutes} minutes. Snooze ${nextSnoozeCount}/3.`;

      await tx.leadActivity.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          leadId: followUp.leadId,
          customerId: followUp.customerId,
          type: "FOLLOW_UP_SCHEDULED",
          summary,
          createdById: input.userId,
          createdAt: input.now,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          userId: input.userId,
          leadId: followUp.leadId,
          customerId: followUp.customerId,
          type: "FOLLOW_UP_SCHEDULED",
          summary,
          metadata: {
            followUpId: followUp.id,
            snoozeMinutes: input.minutes,
            snoozeCount: nextSnoozeCount,
            snoozedUntil: snoozedUntil.toISOString(),
          },
          occurredAt: input.now,
          createdAt: input.now,
        },
      });

      return next;
    });

    return this.toFollowUpAlert(updated as FollowUpWithLead);
  }

  async holdFollowUpForHandling(input: HoldFollowUpRecordInput): Promise<FollowUpAlert> {
    const followUp = await this.requireOwnedOpenFollowUp(input.dataScope, input.followUpId, input.userId);
    const snoozedUntil = new Date(input.now.getTime() + input.holdMinutes * 60 * 1000);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.followUp.update({
        where: { id: followUp.id },
        data: {
          snoozedUntil,
          updatedAt: input.now,
        },
        include: {
          lead: {
            include: {
              customer: true,
              assignedTo: { select: { name: true } },
              activities: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });

      const summary = `Follow-up opened for handling. Alert held for ${input.holdMinutes} minutes.`;

      await tx.leadActivity.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          leadId: followUp.leadId,
          customerId: followUp.customerId,
          type: "FOLLOW_UP_COMPLETED",
          summary,
          createdById: input.userId,
          createdAt: input.now,
        },
      });

      return next;
    });

    return this.toFollowUpAlert(updated as FollowUpWithLead);
  }

  private canUseCompactAck(input: UpdateLeadOutcomeRecordInput): boolean {
    return Boolean(
      input.nextFollowUpAt &&
        !input.isArchived &&
        !input.archiveCategory &&
        !input.whatsappMessageBody &&
        !input.quotation &&
        !input.wonDetails,
    );
  }

  private async updateLeadOutcomeAckCompact(input: UpdateLeadOutcomeRecordInput): Promise<LeadSaveAck> {
    const dataScope = toDbDataScope(input.dataScope);
    const activityId = randomUUID();
    const staffActivityId = randomUUID();
    const followUpId = randomUUID();
    const updateLastCallAt = input.activityType === "CALL_OUTCOME" || input.activityType === "ARCHIVED";
    const staffActivityType = staffActivityTypeForLeadOutcome(input);
    const staffActivityMetadata = JSON.stringify({
      activityType: input.activityType,
      currentStage: input.currentStage,
      currentIntent: input.currentIntent,
      followUpReason: input.followUpReason,
      nextFollowUpAt: input.nextFollowUpAt?.toISOString() ?? null,
    });

    const rows = await this.prisma.$queryRaw<LeadSaveAckRow[]>(
      Prisma.sql`
        WITH existing AS (
          SELECT
            l.*,
            c.business_name AS customer_name,
            c.primary_phone_normalized AS phone_normalized,
            u.name AS assigned_to_name
          FROM leads l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN users u ON u.id = l.assigned_to_id
          WHERE l.id = ${input.leadId}
            AND l.data_scope = ${dataScope}::"DataScope"
        ),
        updated_lead AS (
          UPDATE leads l
          SET
            current_stage = ${input.currentStage}::"LeadStage",
            current_intent = ${input.currentIntent}::"LeadIntent",
            priority = ${input.priority}::"LeadPriority",
            next_follow_up_at = ${input.nextFollowUpAt},
            follow_up_reason = ${input.followUpReason}::"FollowUpReason",
            site_visit_status = ${input.siteVisitStatus}::"SiteVisitScheduleStatus",
            site_visit_scheduled_at = ${input.siteVisitScheduledAt},
            not_receiving_count = ${input.notReceivingCount},
            spoken_count = ${input.spokenCount},
            is_archived = ${input.isArchived},
            archive_category = ${input.archiveCategory}::"ArchiveCategory",
            last_call_at = CASE WHEN ${updateLastCallAt} THEN ${input.now} ELSE l.last_call_at END,
            updated_at = ${input.now}
          FROM existing
          WHERE l.id = existing.id
          RETURNING l.*
        ),
        updated_phone AS (
          UPDATE phone_index p
          SET
            current_stage = ${input.currentStage}::"LeadStage",
            is_active = ${!input.isArchived},
            is_archived = ${input.isArchived}
          FROM existing
          WHERE p.data_scope = ${dataScope}::"DataScope"
            AND p.phone_normalized = existing.phone_normalized
          RETURNING p.id
        ),
        completed_followups AS (
          UPDATE follow_ups f
          SET
            status = 'COMPLETED'::"FollowUpStatus",
            completed_at = ${input.now},
            updated_at = ${input.now}
          FROM existing
          WHERE f.data_scope = ${dataScope}::"DataScope"
            AND f.lead_id = existing.id
            AND f.status = 'OPEN'::"FollowUpStatus"
          RETURNING f.id
        ),
        created_activity AS (
          INSERT INTO lead_activities (
            id,
            data_scope,
            lead_id,
            customer_id,
            type,
            old_stage,
            new_stage,
            old_intent,
            new_intent,
            summary,
            created_by_id,
            created_at
          )
          SELECT
            ${activityId},
            ${dataScope}::"DataScope",
            existing.id,
            existing.customer_id,
            ${input.activityType}::"ActivityType",
            existing.current_stage,
            ${input.currentStage}::"LeadStage",
            existing.current_intent,
            ${input.currentIntent}::"LeadIntent",
            ${input.activitySummary},
            ${input.actorId},
            ${input.now}
          FROM existing
          RETURNING id
        ),
        created_staff_activity AS (
          INSERT INTO staff_activity_events (
            id,
            data_scope,
            user_id,
            lead_id,
            customer_id,
            type,
            summary,
            metadata,
            occurred_at,
            created_at
          )
          SELECT
            ${staffActivityId},
            ${dataScope}::"DataScope",
            ${input.actorId},
            existing.id,
            existing.customer_id,
            ${staffActivityType}::"StaffActivityType",
            ${input.activitySummary},
            ${staffActivityMetadata}::jsonb,
            ${input.now},
            ${input.now}
          FROM existing
          RETURNING id
        ),
        created_followup AS (
          INSERT INTO follow_ups (
            id,
            data_scope,
            lead_id,
            customer_id,
            due_at,
            reason,
            priority,
            status,
            assigned_to_id,
            created_at,
            updated_at
          )
          SELECT
            ${followUpId},
            ${dataScope}::"DataScope",
            existing.id,
            existing.customer_id,
            ${input.nextFollowUpAt},
            ${input.followUpReason ?? "FOLLOW_UP"},
            ${input.priority}::"LeadPriority",
            'OPEN'::"FollowUpStatus",
            existing.assigned_to_id,
            ${input.now},
            ${input.now}
          FROM existing
          RETURNING id
        )
        SELECT
          updated_lead.id,
          updated_lead.data_scope,
          updated_lead.customer_id,
          existing.customer_name,
          existing.phone_normalized,
          updated_lead.source,
          updated_lead.current_stage,
          updated_lead.current_intent,
          updated_lead.priority,
          updated_lead.next_follow_up_at,
          updated_lead.follow_up_reason,
          updated_lead.not_receiving_count,
          existing.assigned_to_name,
          updated_lead.created_at,
          updated_lead.updated_at
        FROM updated_lead
        JOIN existing ON existing.id = updated_lead.id
      `,
    );

    const row = rows[0];

    if (!row) {
      throw new Error(`Lead ${input.leadId} was not found.`);
    }

    return this.toLeadSaveAckFromRow(row, input);
  }

  private async persistLeadOutcome(input: UpdateLeadOutcomeRecordInput): Promise<{ existing: LeadWithCustomer; lead: DbLead }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.lead.findUnique({
        where: { id: input.leadId },
        include: {
          customer: true,
          assignedTo: { select: { name: true } },
        },
      });

      if (!existing || existing.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Lead ${input.leadId} was not found.`);
      }

      const lead = await tx.lead.update({
        where: { id: input.leadId },
        data: {
          currentStage: input.currentStage,
          currentIntent: input.currentIntent,
          priority: input.priority,
          nextFollowUpAt: input.nextFollowUpAt,
          followUpReason: input.followUpReason,
          siteVisitStatus: input.siteVisitStatus,
          siteVisitScheduledAt: input.siteVisitScheduledAt,
          notReceivingCount: input.notReceivingCount,
          spokenCount: input.spokenCount,
          isArchived: input.isArchived,
          archiveCategory: input.archiveCategory as DbArchiveCategory | null,
          lastCallAt: input.activityType === "CALL_OUTCOME" || input.activityType === "ARCHIVED" ? input.now : existing.lastCallAt,
          updatedAt: input.now,
        },
      });

      await tx.phoneIndex.update({
        where: {
          dataScope_phoneNormalized: {
            dataScope: toDbDataScope(input.dataScope),
            phoneNormalized: existing.customer.primaryPhoneNormalized,
          },
        },
        data: {
          currentStage: input.currentStage,
          isActive: !input.isArchived,
          isArchived: input.isArchived,
        },
      });

      await tx.leadActivity.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          leadId: existing.id,
          customerId: existing.customerId,
          type: input.activityType,
          oldStage: existing.currentStage,
          newStage: input.currentStage,
          oldIntent: existing.currentIntent,
          newIntent: input.currentIntent,
          summary: input.activitySummary,
          createdById: input.actorId,
          createdAt: input.now,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          userId: input.actorId,
          leadId: existing.id,
          customerId: existing.customerId,
          type: staffActivityTypeForLeadOutcome(input),
          summary: input.activitySummary,
          metadata: {
            activityType: input.activityType,
            oldStage: existing.currentStage,
            newStage: input.currentStage,
            oldIntent: existing.currentIntent,
            newIntent: input.currentIntent,
            followUpReason: input.followUpReason,
            nextFollowUpAt: input.nextFollowUpAt?.toISOString() ?? null,
          },
          occurredAt: input.now,
          createdAt: input.now,
        },
      });

      await tx.followUp.updateMany({
        where: {
          dataScope: toDbDataScope(input.dataScope),
          leadId: existing.id,
          status: "OPEN",
        },
        data: {
          status: "COMPLETED",
          completedAt: input.now,
          updatedAt: input.now,
        },
      });

      if (input.nextFollowUpAt) {
        await tx.followUp.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            dueAt: input.nextFollowUpAt,
            reason: input.followUpReason ?? "FOLLOW_UP",
            priority: input.priority,
            assignedToId: existing.assignedToId,
            createdAt: input.now,
            updatedAt: input.now,
          },
        });
      }

      if (input.isArchived && input.archiveCategory) {
        await tx.archiveRecord.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            category: input.archiveCategory as DbArchiveCategory,
            month: input.now.getMonth() + 1,
            year: input.now.getFullYear(),
            archivedAt: input.now,
            archivedById: input.actorId,
            reason: input.activitySummary,
          },
        });
      }

      if (input.whatsappMessageBody) {
        await tx.whatsAppMessage.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            phone: existing.customer.primaryPhoneNormalized,
            messageBody: input.whatsappMessageBody,
            messageType: "LEAD_FOLLOW_UP",
            generatedBy: "DETERMINISTIC_DRAFT",
            editedByUser: true,
            status: "DRAFT",
            sentById: input.actorId,
            createdAt: input.now,
          },
        });

        await tx.staffActivityEvent.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            userId: input.actorId,
            leadId: existing.id,
            customerId: existing.customerId,
            type: "WHATSAPP_DRAFTED",
            summary: `WhatsApp draft created for ${existing.customer.businessName}.`,
            metadata: {
              messageType: "LEAD_FOLLOW_UP",
              bodyLength: input.whatsappMessageBody.length,
            },
            occurredAt: input.now,
            createdAt: input.now,
          },
        });
      }

      if (input.quotation) {
        await tx.leadQuotation.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            title: input.quotation.title,
            totalPricePaise: input.quotation.totalPricePaise,
            createdAt: input.now,
            packages: {
              create: input.quotation.packages.map((pkg, packageIndex) => ({
                packageName: pkg.packageName,
                multiplier: pkg.multiplier,
                packageTotalPaise: pkg.packageTotalPaise,
                sortOrder: packageIndex,
                items: {
                  create: pkg.items.map((item, itemIndex) => ({
                    itemName: item.itemName,
                    unitPricePaise: item.unitPricePaise,
                    quantity: item.quantity,
                    lineTotalPaise: item.lineTotalPaise,
                    sortOrder: itemIndex,
                  })),
                },
              })),
            },
          },
        });

        await tx.staffActivityEvent.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            userId: input.actorId,
            leadId: existing.id,
            customerId: existing.customerId,
            type: "QUOTATION_CREATED",
            summary: `Quotation saved for ${existing.customer.businessName}: ${input.quotation.title}.`,
            metadata: {
              title: input.quotation.title,
              totalPricePaise: input.quotation.totalPricePaise,
              packageCount: input.quotation.packages.length,
            },
            occurredAt: input.now,
            createdAt: input.now,
          },
        });

        for (const pkg of input.quotation.packages) {
          const template = await tx.quotationPackageTemplate.upsert({
            where: {
              dataScope_packageName: {
                dataScope: toDbDataScope(input.dataScope),
                packageName: pkg.packageName,
              },
            },
            update: { updatedAt: input.now },
            create: {
              dataScope: toDbDataScope(input.dataScope),
              packageName: pkg.packageName,
              createdAt: input.now,
              updatedAt: input.now,
            },
          });

          await tx.quotationPackageTemplateItem.deleteMany({
            where: { templateId: template.id },
          });

          for (const [itemIndex, item] of pkg.items.entries()) {
            const quotationItem = await tx.quotationItem.upsert({
              where: {
                dataScope_itemName: {
                  dataScope: toDbDataScope(input.dataScope),
                  itemName: item.itemName,
                },
              },
              update: {
                lastPricePaise: item.unitPricePaise,
                updatedAt: input.now,
              },
              create: {
                dataScope: toDbDataScope(input.dataScope),
                itemName: item.itemName,
                lastPricePaise: item.unitPricePaise,
                createdAt: input.now,
                updatedAt: input.now,
              },
            });

            await tx.quotationPackageTemplateItem.create({
              data: {
                templateId: template.id,
                quotationItemId: quotationItem.id,
                unitPricePaise: item.unitPricePaise,
                quantity: item.quantity,
                sortOrder: itemIndex,
                createdAt: input.now,
              },
            });
          }
        }
      }

      if (input.wonDetails) {
        await tx.wonLeadDetails.upsert({
          where: { leadId: existing.id },
          update: {
            siteContactNumber: input.wonDetails.siteContactNumber,
            useCustomerPhoneAsSiteContact: input.wonDetails.useCustomerPhoneAsSiteContact,
            address: input.wonDetails.address,
            scopeOfWork: input.wonDetails.scopeOfWork,
            scheduleStatus: input.wonDetails.scheduleStatus,
            scheduledAt: input.wonDetails.scheduledAt,
            quotedPricePaise: input.wonDetails.quotedPricePaise,
            acceptedPricePaise: input.wonDetails.acceptedPricePaise,
            advancePaymentPaise: input.wonDetails.advancePaymentPaise,
            updatedAt: input.now,
          },
          create: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            siteContactNumber: input.wonDetails.siteContactNumber,
            useCustomerPhoneAsSiteContact: input.wonDetails.useCustomerPhoneAsSiteContact,
            address: input.wonDetails.address,
            scopeOfWork: input.wonDetails.scopeOfWork,
            scheduleStatus: input.wonDetails.scheduleStatus,
            scheduledAt: input.wonDetails.scheduledAt,
            quotedPricePaise: input.wonDetails.quotedPricePaise,
            acceptedPricePaise: input.wonDetails.acceptedPricePaise,
            advancePaymentPaise: input.wonDetails.advancePaymentPaise,
            createdAt: input.now,
            updatedAt: input.now,
          },
        });
      }

      return {
        existing: existing as LeadWithCustomer,
        lead,
      };
    });
  }

  private whereForQueue(dataScope: DataScope, queue: LeadQueue, access: LeadAccessScope | null = null) {
    if (queue === "ARCHIVE") {
      return {
        dataScope: toDbDataScope(dataScope),
        isArchived: true,
        ...this.whereForLeadAccess(access),
      };
    }

    const stages: Record<Exclude<LeadQueue, "ARCHIVE">, DbLeadStage> = {
      RAW: DbLeadStage.RAW_UNTOUCHED,
      WARM: DbLeadStage.WARM,
      HOT_INSTALLATION: DbLeadStage.HOT_INSTALLATION,
      HOT_REPAIR_SERVICE: DbLeadStage.HOT_REPAIR_SERVICE,
      UNANSWERED: DbLeadStage.NOT_RECEIVING,
      GHOSTING: DbLeadStage.GHOSTING,
      WON: DbLeadStage.CAPTURED_WON,
      LOST: DbLeadStage.LOST,
    };

    return {
      dataScope: toDbDataScope(dataScope),
      isArchived: false,
      currentStage: stages[queue],
      ...this.whereForLeadAccess(access),
    };
  }

  private whereForLeadAccess(access: LeadAccessScope | null | undefined): Prisma.LeadWhereInput {
    if (!access || access.canViewAllLeads) {
      return {};
    }

    return { assignedToId: access.actorId };
  }

  private toExistingPhoneRecord(phoneEntry: PhoneIndexWithRelations): ExistingPhoneRecord {
    const lastActivity = phoneEntry.currentLead?.activities?.[0] ?? null;

    return {
      dataScope: toAppDataScope(phoneEntry.dataScope),
      phoneNormalized: phoneEntry.phoneNormalized,
      customerId: phoneEntry.customerId,
      customerName: phoneEntry.customer.businessName,
      currentLeadId: phoneEntry.currentLeadId,
      currentStage: phoneEntry.currentStage,
      isActive: phoneEntry.isActive,
      isArchived: phoneEntry.isArchived,
      assignedToName: phoneEntry.currentLead?.assignedTo?.name ?? null,
      nextFollowUpAt: phoneEntry.currentLead?.nextFollowUpAt ?? null,
      lastActivitySummary: lastActivity?.summary ?? null,
      lastUpdatedAt: phoneEntry.lastUpdatedAt,
      totalJobs: phoneEntry.customer.totalJobs,
    };
  }

  private toRawLeadListItem(lead: LeadWithCustomer): RawLeadListItem {
    const lastActivity = lead.activities?.[0] ?? null;

    return {
      id: lead.id,
      dataScope: toAppDataScope(lead.dataScope),
      customerId: lead.customerId,
      customerName: lead.customer.businessName,
      phoneNormalized: lead.customer.primaryPhoneNormalized,
      source: lead.source,
      currentStage: lead.currentStage,
      currentIntent: lead.currentIntent,
      priority: lead.priority,
      nextFollowUpAt: lead.nextFollowUpAt,
      followUpReason: lead.followUpReason,
      notReceivingCount: lead.notReceivingCount,
      assignedToName: lead.assignedTo?.name ?? null,
      lastActivitySummary: lastActivity?.summary ?? null,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  private async requireOwnedOpenFollowUp(dataScope: DataScope, followUpId: string, userId: string): Promise<FollowUpWithLead> {
    const followUp = await this.prisma.followUp.findUnique({
      where: { id: followUpId },
      include: {
        lead: {
          include: {
            customer: true,
            assignedTo: { select: { name: true } },
            activities: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (
      !followUp ||
      followUp.dataScope !== toDbDataScope(dataScope) ||
      followUp.status !== "OPEN" ||
      followUp.assignedToId !== userId ||
      followUp.lead.isArchived
    ) {
      throw new Error("Follow-up alert was not found for this user.");
    }

    return followUp as FollowUpWithLead;
  }

  private toFollowUpAlert(followUp: FollowUpWithLead): FollowUpAlert {
    const lastActivity = followUp.lead.activities?.[0] ?? null;

    return {
      id: followUp.id,
      leadId: followUp.leadId,
      customerId: followUp.customerId,
      customerName: followUp.lead.customer.businessName,
      phoneNormalized: followUp.lead.customer.primaryPhoneNormalized,
      currentStage: followUp.lead.currentStage,
      currentIntent: followUp.lead.currentIntent,
      priority: followUp.priority,
      reason: followUp.reason,
      dueAt: followUp.dueAt,
      assignedToName: followUp.lead.assignedTo?.name ?? null,
      lastActivitySummary: lastActivity?.summary ?? null,
      snoozeCount: followUp.snoozeCount,
      snoozedUntil: followUp.snoozedUntil,
      maxSnoozes: 3,
      isTransfer: followUp.reason === "TRANSFERRED_LEAD",
    };
  }

  private toLeadWorkflowState(lead: LeadWithCustomer): LeadWorkflowState {
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

  private toLeadSaveAck(existing: LeadWithCustomer, lead: DbLead, input: UpdateLeadOutcomeRecordInput): LeadSaveAck {
    return {
      id: lead.id,
      dataScope: toAppDataScope(lead.dataScope),
      customerId: lead.customerId,
      customerName: existing.customer.businessName,
      phoneNormalized: existing.customer.primaryPhoneNormalized,
      source: lead.source,
      currentStage: lead.currentStage,
      currentIntent: lead.currentIntent,
      priority: lead.priority,
      nextFollowUpAt: lead.nextFollowUpAt,
      followUpReason: lead.followUpReason,
      notReceivingCount: lead.notReceivingCount,
      assignedToName: existing.assignedTo?.name ?? null,
      lastActivitySummary: input.activitySummary,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      savedAt: input.now,
      serverConfirmed: true,
    };
  }

  private toLeadSaveAckFromRow(row: LeadSaveAckRow, input: UpdateLeadOutcomeRecordInput): LeadSaveAck {
    return {
      id: row.id,
      dataScope: toAppDataScope(row.data_scope),
      customerId: row.customer_id,
      customerName: row.customer_name,
      phoneNormalized: row.phone_normalized,
      source: row.source,
      currentStage: row.current_stage,
      currentIntent: row.current_intent,
      priority: row.priority,
      nextFollowUpAt: row.next_follow_up_at,
      followUpReason: row.follow_up_reason,
      notReceivingCount: row.not_receiving_count,
      assignedToName: row.assigned_to_name,
      lastActivitySummary: input.activitySummary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      savedAt: input.now,
      serverConfirmed: true,
    };
  }

  private toLeadDetail(lead: LeadWithCustomer, quotationSuggestions: QuotationSuggestion): LeadDetail {
    return {
      ...this.toLeadWorkflowState(lead),
      latestQuotation: lead.quotations?.[0] ? this.toQuotationSnapshot(lead.quotations[0]) : null,
      wonDetails: lead.wonDetails ? this.toWonDetailsSnapshot(lead.wonDetails) : null,
      quotationSuggestions,
      timeline: (lead.activities ?? []).map((activity) => ({
        id: activity.id,
        type: activity.type,
        summary: activity.summary ?? "",
        createdByName: activity.createdBy?.name ?? null,
        createdAt: activity.createdAt,
      })),
      firstCallOutcomeOptions: ["SPOKE", "WARM", "NOT_INTERESTED", "WRONG_NUMBER", "NOT_RECEIVING"],
      followUpOutcomeOptions:
        lead.spokenCount === 0 || lead.currentStage === "WARM"
          ? ["SPOKE", "WARM", "NOT_INTERESTED", "WRONG_NUMBER", "NOT_RECEIVING"]
          : ["SPOKE", "WARM", "NOT_INTERESTED", "NOT_RECEIVING"],
    };
  }

  private toQuotationSnapshot(quotation: QuotationWithPackages): QuotationSnapshot {
    return {
      id: quotation.id,
      title: quotation.title,
      totalPricePaise: quotation.totalPricePaise,
      createdAt: quotation.createdAt,
      packages: quotation.packages.map((pkg) => ({
        packageName: pkg.packageName,
        multiplier: pkg.multiplier,
        packageTotalPaise: pkg.packageTotalPaise,
        items: pkg.items.map((item) => ({
          itemName: item.itemName,
          unitPricePaise: item.unitPricePaise,
          quantity: item.quantity,
          lineTotalPaise: item.lineTotalPaise,
        })),
      })),
    };
  }

  private toWonDetailsSnapshot(wonDetails: DbWonLeadDetails): WonDetailsSnapshot {
    return {
      siteContactNumber: wonDetails.siteContactNumber,
      useCustomerPhoneAsSiteContact: wonDetails.useCustomerPhoneAsSiteContact,
      address: wonDetails.address,
      scopeOfWork: wonDetails.scopeOfWork,
      scheduleStatus: wonDetails.scheduleStatus,
      scheduledAt: wonDetails.scheduledAt,
      quotedPricePaise: wonDetails.quotedPricePaise,
      acceptedPricePaise: wonDetails.acceptedPricePaise,
      advancePaymentPaise: wonDetails.advancePaymentPaise,
      createdAt: wonDetails.createdAt,
    };
  }
}

function toDbDataScope(dataScope: DataScope): DbDataScope {
  return dataScope === "production" ? DbDataScope.PRODUCTION : DbDataScope.DEVELOPMENT;
}

function toAppDataScope(dataScope: DbDataScope): DataScope {
  return dataScope === DbDataScope.PRODUCTION ? "production" : "development";
}

function staffActivityTypeForLeadOutcome(input: UpdateLeadOutcomeRecordInput): DbStaffActivityType {
  if (input.currentStage === "CAPTURED_WON") {
    return "LEAD_WON_MARKED";
  }

  if (input.currentStage === "LOST") {
    return "LEAD_LOST_MARKED";
  }

  if (input.currentStage === "WARM") {
    return "LEAD_WARM_MARKED";
  }

  if (input.currentStage === "HOT_INSTALLATION" || input.currentStage === "HOT_REPAIR_SERVICE") {
    return input.followUpReason === "SITE_VISIT" ? "SITE_VISIT_COORDINATED" : "LEAD_HOT_MARKED";
  }

  if (input.nextFollowUpAt) {
    return "FOLLOW_UP_SCHEDULED";
  }

  if (input.activityType === "ARCHIVED") {
    return "LEAD_STAGE_CHANGED";
  }

  return "LEAD_INTERACTION";
}
