import { Injectable } from "@nestjs/common";
import type { DataScope } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import {
  ArchiveCategory as DbArchiveCategory,
  type Customer as DbCustomer,
  DataScope as DbDataScope,
  type Lead as DbLead,
  type LeadActivity as DbLeadActivity,
  type LeadQuotation as DbLeadQuotation,
  type LeadQuotationItem as DbLeadQuotationItem,
  type LeadQuotationPackage as DbLeadQuotationPackage,
  LeadStage as DbLeadStage,
  type PhoneIndex as DbPhoneIndex,
  type QuotationItem as DbQuotationItem,
  type QuotationPackageTemplate as DbQuotationPackageTemplate,
  type QuotationPackageTemplateItem as DbQuotationPackageTemplateItem,
  type WonLeadDetails as DbWonLeadDetails,
} from "../generated/prisma/client";
import {
  type CreateLeadRecordInput,
  type CreateLeadRecordResult,
  type ExistingPhoneRecord,
  type LeadDetail,
  type LeadQueue,
  type QuotationSnapshot,
  type QuotationSuggestion,
  type QueueCounts,
  type RawLeadListItem,
  type WonDetailsSnapshot,
  type UpdateLeadOutcomeRecordInput,
} from "./lead.types";
import { DuplicatePhoneConflictError, type LeadRepository } from "./lead.repository";

type LeadWithCustomer = DbLead & {
  customer: DbCustomer;
  assignedTo?: { name: string } | null;
  activities?: DbLeadActivity[];
  quotations?: QuotationWithPackages[];
  wonDetails?: DbWonLeadDetails | null;
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
    activities?: DbLeadActivity[];
  }) | null;
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

  async listRawLeads(dataScope: DataScope): Promise<RawLeadListItem[]> {
    return this.listLeadsByQueue(dataScope, "RAW");
  }

  async listLeadsByQueue(dataScope: DataScope, queue: LeadQueue): Promise<RawLeadListItem[]> {
    const leads = await this.prisma.lead.findMany({
      where: this.whereForQueue(dataScope, queue),
      include: {
        customer: true,
        assignedTo: { select: { name: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });

    return leads.map((lead) => this.toRawLeadListItem(lead as LeadWithCustomer));
  }

  async getQueueCounts(dataScope: DataScope): Promise<QueueCounts> {
    const [raw, warm, hotInstallation, hotRepairService, unanswered, ghosting, won, lost, archive] = await Promise.all([
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "RAW") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "WARM") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "HOT_INSTALLATION") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "HOT_REPAIR_SERVICE") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "UNANSWERED") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "GHOSTING") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "WON") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "LOST") }),
      this.prisma.lead.count({ where: this.whereForQueue(dataScope, "ARCHIVE") }),
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

  async getLeadDetail(dataScope: DataScope, leadId: string): Promise<LeadDetail | null> {
    const [lead, quotationSuggestions] = await Promise.all([
      this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          customer: true,
          assignedTo: { select: { name: true } },
          activities: { orderBy: { createdAt: "asc" } },
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
      }),
      this.getQuotationSuggestions(dataScope),
    ]);

    return lead && lead.dataScope === toDbDataScope(dataScope) ? this.toLeadDetail(lead as LeadWithCustomer, quotationSuggestions) : null;
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.lead.findUnique({
        where: { id: input.leadId },
        include: { customer: true },
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
          createdAt: input.now,
        },
      });

      if (input.nextFollowUpAt) {
        await tx.followUp.updateMany({
          where: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            status: "OPEN",
          },
          data: {
            status: "CANCELLED",
          },
        });

        await tx.followUp.create({
          data: {
            dataScope: toDbDataScope(input.dataScope),
            leadId: existing.id,
            customerId: existing.customerId,
            dueAt: input.nextFollowUpAt,
            reason: input.followUpReason ?? "FOLLOW_UP",
            priority: input.priority,
            assignedToId: existing.assignedToId,
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

      return lead;
    });

    const detail = await this.getLeadDetail(input.dataScope, updated.id);

    if (!detail) {
      throw new Error(`Lead ${updated.id} was not found after update.`);
    }

    return detail;
  }

  private whereForQueue(dataScope: DataScope, queue: LeadQueue) {
    if (queue === "ARCHIVE") {
      return { dataScope: toDbDataScope(dataScope), isArchived: true };
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
    };
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

  private toLeadDetail(lead: LeadWithCustomer, quotationSuggestions: QuotationSuggestion): LeadDetail {
    return {
      ...this.toRawLeadListItem(lead),
      leadCycleNumber: lead.leadCycleNumber,
      siteVisitStatus: lead.siteVisitStatus,
      siteVisitScheduledAt: lead.siteVisitScheduledAt,
      spokenCount: lead.spokenCount,
      isArchived: lead.isArchived,
      archiveCategory: lead.archiveCategory,
      latestQuotation: lead.quotations?.[0] ? this.toQuotationSnapshot(lead.quotations[0]) : null,
      wonDetails: lead.wonDetails ? this.toWonDetailsSnapshot(lead.wonDetails) : null,
      quotationSuggestions,
      timeline: (lead.activities ?? []).map((activity) => ({
        id: activity.id,
        type: activity.type,
        summary: activity.summary ?? "",
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
