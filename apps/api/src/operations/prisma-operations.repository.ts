import { Injectable } from "@nestjs/common";
import type { DataScope } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import {
  DataScope as DbDataScope,
  type Customer as DbCustomer,
  type Job as DbJob,
  type JobChecklist as DbJobChecklist,
  type JobEvent as DbJobEvent,
  type JobPhoto as DbJobPhoto,
  type Vendor as DbVendor,
  type VendorOffer as DbVendorOffer,
  type VendorTeamMember as DbVendorTeamMember,
  type WorkCertificate as DbWorkCertificate,
} from "../generated/prisma/client";
import {
  buildVendorOfferMessage,
  DuplicateVendorPhoneError,
  type OperationsRepository,
} from "./operations.repository";
import type {
  AddJobPhotoRecordInput,
  AssignVendorOffersInput,
  CreateWorkCertificatesRecordInput,
  CreateJobFromWonRecordInput,
  CreateVendorRecordInput,
  ChecklistItem,
  JobEventSummary,
  JobOperation,
  SaveJobChecklistRecordInput,
  JobChecklistSummary,
  JobPhotoSummary,
  TransitionJobInput,
  VendorOfferSummary,
  VendorSummary,
  WorkCertificateSummary,
} from "./operations.types";

type VendorWithTeamMembers = DbVendor & {
  teamMembers: DbVendorTeamMember[];
};

type JobWithRelations = DbJob & {
  customer: DbCustomer;
  assignedVendor?: Pick<DbVendor, "id" | "vendorName"> | null;
  offers: Array<
    DbVendorOffer & {
      vendor: Pick<DbVendor, "vendorName" | "phone">;
    }
  >;
  events: DbJobEvent[];
  photos: DbJobPhoto[];
  checklists: DbJobChecklist[];
  certificates: DbWorkCertificate[];
};

@Injectable()
export class PrismaOperationsRepository implements OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listVendors(dataScope: DataScope): Promise<VendorSummary[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { dataScope: toDbDataScope(dataScope) },
      include: { teamMembers: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });

    return vendors.map((vendor) => this.toVendorSummary(vendor as VendorWithTeamMembers));
  }

  async createVendor(input: CreateVendorRecordInput): Promise<VendorSummary> {
    const existing = await this.prisma.vendor.findUnique({
      where: {
        dataScope_phone: {
          dataScope: toDbDataScope(input.dataScope),
          phone: input.phone,
        },
      },
      include: { teamMembers: true },
    });

    if (existing) {
      throw new DuplicateVendorPhoneError(this.toVendorSummary(existing as VendorWithTeamMembers));
    }

    const vendor = await this.prisma.vendor.create({
      data: {
        dataScope: toDbDataScope(input.dataScope),
        vendorCode: input.vendorCode,
        vendorName: input.vendorName,
        phone: input.phone,
        workingAddress: input.workingAddress,
        address: input.address,
        pincode: input.pincode,
        dateOfBirth: input.dateOfBirth,
        experienceYears: input.experienceYears,
        aadhaarDocumentName: input.aadhaarDocumentName,
        selfieDocumentName: input.selfieDocumentName,
        signatureReference: input.signatureReference,
        teamType: input.teamType,
        teamSize: input.teamSize,
        skills: input.skills,
        kycStatus: input.kycStatus,
        active: input.active,
        createdAt: input.now,
        updatedAt: input.now,
        teamMembers: {
          create: input.teamMembers.map((member) => ({
            dataScope: toDbDataScope(input.dataScope),
            name: member.name,
            phone: member.phone ?? null,
            aadhaarDocumentName: member.aadhaarDocumentName,
            createdAt: input.now,
          })),
        },
      },
      include: { teamMembers: { orderBy: { createdAt: "asc" } } },
    });

    return this.toVendorSummary(vendor as VendorWithTeamMembers);
  }

  async getJobByLeadId(dataScope: DataScope, leadId: string): Promise<JobOperation | null> {
    const job = await this.prisma.job.findUnique({
      where: { leadId },
      include: this.jobInclude(),
    });

    return job && job.dataScope === toDbDataScope(dataScope) ? this.toJobOperation(job as JobWithRelations) : null;
  }

  async getJobById(dataScope: DataScope, jobId: string): Promise<JobOperation | null> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: this.jobInclude(),
    });

    return job && job.dataScope === toDbDataScope(dataScope) ? this.toJobOperation(job as JobWithRelations) : null;
  }

  async createJobFromWonLead(input: CreateJobFromWonRecordInput): Promise<JobOperation> {
    const existing = await this.getJobByLeadId(input.dataScope, input.lead.id);

    if (existing) {
      return existing;
    }

    const job = await this.prisma.job.create({
      data: {
        dataScope: toDbDataScope(input.dataScope),
        leadId: input.lead.id,
        customerId: input.lead.customerId,
        jobType: input.lead.currentIntent === "REPAIR_SERVICE" ? "Repair / Service" : "Installation",
        status: "WAITING_VENDOR_ASSIGNMENT",
        siteContactNumber: input.wonDetails.siteContactNumber,
        address: input.wonDetails.address,
        scopeOfWork: input.wonDetails.scopeOfWork,
        scheduledAt: input.wonDetails.scheduledAt,
        createdAt: input.now,
        updatedAt: input.now,
        events: {
          create: {
            dataScope: toDbDataScope(input.dataScope),
            type: "JOB_CREATED",
            newStatus: "WAITING_VENDOR_ASSIGNMENT",
            summary: `Operations job created from won lead ${input.lead.customerName}.`,
            actorId: input.actorId,
            createdAt: input.now,
          },
        },
      },
      include: this.jobInclude(),
    });

    return this.toJobOperation(job as JobWithRelations);
  }

  async assignVendorOffers(input: AssignVendorOffersInput): Promise<JobOperation> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: input.jobId },
        include: {
          customer: true,
          assignedVendor: { select: { id: true, vendorName: true } },
          offers: {
            include: { vendor: { select: { vendorName: true, phone: true } } },
            orderBy: { sentAt: "desc" },
          },
          events: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!job || job.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Job ${input.jobId} was not found.`);
      }

      const vendors = await tx.vendor.findMany({
        where: {
          dataScope: toDbDataScope(input.dataScope),
          id: { in: input.vendorIds },
          active: true,
        },
      });

      if (vendors.length !== input.vendorIds.length) {
        throw new Error("One or more selected vendors were not found or are inactive.");
      }

      const jobOperation = this.toJobOperation(job as JobWithRelations);

      for (const vendor of vendors) {
        const messageBody = buildVendorOfferMessage(jobOperation, vendor.vendorName, input.offerPricePaise);

        await tx.vendorOffer.upsert({
          where: {
            jobId_vendorId: {
              jobId: input.jobId,
              vendorId: vendor.id,
            },
          },
          update: {
            offerPricePaise: input.offerPricePaise,
            status: "OFFER_SENT",
            messageBody,
            sentAt: input.now,
            respondedAt: null,
          },
          create: {
            dataScope: toDbDataScope(input.dataScope),
            jobId: input.jobId,
            vendorId: vendor.id,
            offerPricePaise: input.offerPricePaise,
            status: "OFFER_SENT",
            messageBody,
            sentAt: input.now,
            createdAt: input.now,
          },
        });
      }

      await tx.job.update({
        where: { id: input.jobId },
        data: {
          status: "VENDOR_OFFER_SENT",
          vendorOfferPricePaise: input.offerPricePaise,
          assignedVendorId: vendors[0]?.id ?? null,
          updatedAt: input.now,
        },
      });

      await tx.jobEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          type: "VENDOR_OFFER_SENT",
          oldStatus: job.status,
          newStatus: "VENDOR_OFFER_SENT",
          summary: `Vendor offer sent to ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}.`,
          actorId: input.actorId,
          createdAt: input.now,
        },
      });
    });

    const updated = await this.getJobById(input.dataScope, input.jobId);

    if (!updated) {
      throw new Error(`Job ${input.jobId} was not found after assignment.`);
    }

    return updated;
  }

  async addJobPhoto(input: AddJobPhotoRecordInput): Promise<JobOperation> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: input.jobId } });

      if (!job || job.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Job ${input.jobId} was not found.`);
      }

      await tx.jobPhoto.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          vendorId: job.assignedVendorId,
          type: input.type,
          fileName: input.fileName,
          storageKey: input.storageKey,
          notes: input.notes,
          uploadedById: input.uploadedById,
          uploadedAt: input.now,
        },
      });

      await tx.job.update({
        where: { id: input.jobId },
        data: { updatedAt: input.now },
      });

      await tx.jobEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          type: "JOB_PHOTO_ADDED",
          oldStatus: job.status,
          newStatus: job.status,
          summary: `Photo proof added: ${input.fileName}.`,
          actorId: input.uploadedById,
          createdAt: input.now,
        },
      });
    });

    return this.requireUpdatedJob(input.dataScope, input.jobId, "photo");
  }

  async saveJobChecklist(input: SaveJobChecklistRecordInput): Promise<JobOperation> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: input.jobId } });

      if (!job || job.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Job ${input.jobId} was not found.`);
      }

      await tx.jobChecklist.upsert({
        where: {
          jobId_type: {
            jobId: input.jobId,
            type: input.type,
          },
        },
        update: {
          vendorId: job.assignedVendorId,
          status: input.status,
          items: input.items,
          submittedById: input.submittedById,
          submittedAt: input.status === "SUBMITTED" ? input.now : null,
          updatedAt: input.now,
        },
        create: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          vendorId: job.assignedVendorId,
          type: input.type,
          status: input.status,
          items: input.items,
          submittedById: input.submittedById,
          submittedAt: input.status === "SUBMITTED" ? input.now : null,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });

      await tx.job.update({
        where: { id: input.jobId },
        data: { updatedAt: input.now },
      });

      await tx.jobEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          type: "JOB_CHECKLIST_SAVED",
          oldStatus: job.status,
          newStatus: job.status,
          summary: `${input.type.replaceAll("_", " ")} checklist ${input.status.toLowerCase()}.`,
          actorId: input.submittedById,
          createdAt: input.now,
        },
      });
    });

    return this.requireUpdatedJob(input.dataScope, input.jobId, "checklist");
  }

  async createWorkCertificates(input: CreateWorkCertificatesRecordInput): Promise<JobOperation> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: input.job.id } });

      if (!job || job.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Job ${input.job.id} was not found.`);
      }

      const certificateRows = [
        {
          audience: "CUSTOMER" as const,
          title: "Customer Work Completion Certificate",
          pdfFileName: `CI4U-${input.job.id}-customer-certificate.pdf`,
          storageKey: `${input.dataScope}/work-certificates/${input.job.id}/customer.pdf`,
          bodyText: input.customerBodyText,
        },
        {
          audience: "VENDOR" as const,
          title: "Vendor Work Completion Certificate",
          pdfFileName: `CI4U-${input.job.id}-vendor-certificate.pdf`,
          storageKey: `${input.dataScope}/work-certificates/${input.job.id}/vendor.pdf`,
          bodyText: input.vendorBodyText,
        },
      ];

      for (const certificate of certificateRows) {
        await tx.workCertificate.upsert({
          where: {
            jobId_audience: {
              jobId: input.job.id,
              audience: certificate.audience,
            },
          },
          update: {
            vendorId: input.job.assignedVendorId,
            title: certificate.title,
            pdfFileName: certificate.pdfFileName,
            storageKey: certificate.storageKey,
            bodyText: certificate.bodyText,
            issuedAt: input.now,
            issuedById: input.actorId,
          },
          create: {
            dataScope: toDbDataScope(input.dataScope),
            jobId: input.job.id,
            customerId: input.job.customerId,
            vendorId: input.job.assignedVendorId,
            audience: certificate.audience,
            title: certificate.title,
            pdfFileName: certificate.pdfFileName,
            storageKey: certificate.storageKey,
            bodyText: certificate.bodyText,
            issuedAt: input.now,
            issuedById: input.actorId,
          },
        });
      }

      await tx.job.update({
        where: { id: input.job.id },
        data: {
          completionCertificateText: input.customerBodyText,
          updatedAt: input.now,
        },
      });

      await tx.jobEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.job.id,
          type: "CERTIFICATE_CREATED",
          oldStatus: job.status,
          newStatus: job.status,
          summary: "Customer and vendor completion certificates created.",
          actorId: input.actorId,
          createdAt: input.now,
        },
      });
    });

    return this.requireUpdatedJob(input.dataScope, input.job.id, "certificates");
  }

  async transitionJob(input: TransitionJobInput): Promise<JobOperation> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: input.jobId } });

      if (!job || job.dataScope !== toDbDataScope(input.dataScope)) {
        throw new Error(`Job ${input.jobId} was not found.`);
      }

      await tx.job.update({
        where: { id: input.jobId },
        data: {
          status: input.nextStatus,
          startedAt: input.nextStatus === "WORK_STARTED" ? (job.startedAt ?? input.now) : job.startedAt,
          pausedAt: input.nextStatus === "WORK_PAUSED" ? input.now : input.nextStatus === "WORK_STARTED" ? null : job.pausedAt,
          completedAt: input.nextStatus === "WORK_COMPLETED" || input.nextStatus === "CLOSED" ? input.now : job.completedAt,
          completionSummary: input.completionSummary ?? job.completionSummary,
          vendorBonusPaise: input.vendorBonusPaise ?? job.vendorBonusPaise,
          vendorDeductionPaise: input.vendorDeductionPaise ?? job.vendorDeductionPaise,
          completionCertificateText: input.completionCertificateText ?? job.completionCertificateText,
          updatedAt: input.now,
        },
      });

      await tx.jobEvent.create({
        data: {
          dataScope: toDbDataScope(input.dataScope),
          jobId: input.jobId,
          type: input.eventType,
          oldStatus: job.status,
          newStatus: input.nextStatus,
          summary: input.summary,
          actorId: input.actorId,
          createdAt: input.now,
        },
      });
    });

    const updated = await this.getJobById(input.dataScope, input.jobId);

    if (!updated) {
      throw new Error(`Job ${input.jobId} was not found after transition.`);
    }

    return updated;
  }

  private jobInclude() {
    return {
      customer: true,
      assignedVendor: { select: { id: true, vendorName: true } },
      offers: {
        include: { vendor: { select: { vendorName: true, phone: true } } },
        orderBy: { sentAt: "desc" as const },
      },
      events: { orderBy: { createdAt: "asc" as const } },
      photos: { orderBy: { uploadedAt: "desc" as const } },
      checklists: { orderBy: { updatedAt: "desc" as const } },
      certificates: { orderBy: { issuedAt: "desc" as const } },
    };
  }

  private async requireUpdatedJob(dataScope: DataScope, jobId: string, reason: string): Promise<JobOperation> {
    const updated = await this.getJobById(dataScope, jobId);

    if (!updated) {
      throw new Error(`Job ${jobId} was not found after ${reason}.`);
    }

    return updated;
  }

  private toVendorSummary(vendor: VendorWithTeamMembers): VendorSummary {
    return {
      id: vendor.id,
      dataScope: toAppDataScope(vendor.dataScope),
      vendorCode: vendor.vendorCode,
      vendorName: vendor.vendorName,
      phone: vendor.phone,
      workingAddress: vendor.workingAddress,
      address: vendor.address,
      pincode: vendor.pincode,
      dateOfBirth: vendor.dateOfBirth,
      experienceYears: vendor.experienceYears,
      aadhaarDocumentName: vendor.aadhaarDocumentName,
      selfieDocumentName: vendor.selfieDocumentName,
      signatureReference: vendor.signatureReference,
      teamType: vendor.teamType,
      teamSize: vendor.teamSize,
      skills: stringArrayFromJson(vendor.skills),
      kycStatus: vendor.kycStatus,
      active: vendor.active,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
      teamMembers: vendor.teamMembers.map((member) => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        aadhaarDocumentName: member.aadhaarDocumentName,
      })),
    };
  }

  private toJobOperation(job: JobWithRelations): JobOperation {
    return {
      id: job.id,
      dataScope: toAppDataScope(job.dataScope),
      leadId: job.leadId,
      customerId: job.customerId,
      customerName: job.customer.businessName,
      phoneNormalized: job.customer.primaryPhoneNormalized,
      jobType: job.jobType,
      status: job.status,
      siteContactNumber: job.siteContactNumber,
      address: job.address,
      scopeOfWork: job.scopeOfWork,
      scheduledAt: job.scheduledAt,
      vendorOfferPricePaise: job.vendorOfferPricePaise,
      assignedVendorId: job.assignedVendorId,
      assignedVendorName: job.assignedVendor?.vendorName ?? null,
      startedAt: job.startedAt,
      pausedAt: job.pausedAt,
      completedAt: job.completedAt,
      completionSummary: job.completionSummary,
      vendorBonusPaise: job.vendorBonusPaise,
      vendorDeductionPaise: job.vendorDeductionPaise,
      completionCertificateText: job.completionCertificateText,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      offers: job.offers.map((offer) => this.toVendorOfferSummary(offer)),
      events: job.events.map((event) => this.toJobEventSummary(event)),
      photos: job.photos.map((photo) => this.toJobPhotoSummary(photo)),
      checklists: job.checklists.map((checklist) => this.toJobChecklistSummary(checklist)),
      certificates: job.certificates.map((certificate) => this.toWorkCertificateSummary(certificate)),
    };
  }

  private toVendorOfferSummary(offer: DbVendorOffer & { vendor: Pick<DbVendor, "vendorName" | "phone"> }): VendorOfferSummary {
    return {
      id: offer.id,
      jobId: offer.jobId,
      vendorId: offer.vendorId,
      vendorName: offer.vendor.vendorName,
      vendorPhone: offer.vendor.phone,
      offerPricePaise: offer.offerPricePaise,
      status: offer.status,
      messageBody: offer.messageBody,
      sentAt: offer.sentAt,
      respondedAt: offer.respondedAt,
    };
  }

  private toJobEventSummary(event: DbJobEvent): JobEventSummary {
    return {
      id: event.id,
      type: event.type,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      summary: event.summary,
      createdAt: event.createdAt,
    };
  }

  private toJobPhotoSummary(photo: DbJobPhoto): JobPhotoSummary {
    return {
      id: photo.id,
      jobId: photo.jobId,
      vendorId: photo.vendorId,
      type: photo.type,
      fileName: photo.fileName,
      storageKey: photo.storageKey,
      notes: photo.notes,
      uploadedById: photo.uploadedById,
      uploadedAt: photo.uploadedAt,
    };
  }

  private toJobChecklistSummary(checklist: DbJobChecklist): JobChecklistSummary {
    return {
      id: checklist.id,
      jobId: checklist.jobId,
      vendorId: checklist.vendorId,
      type: checklist.type,
      status: checklist.status,
      items: checklistItemsFromJson(checklist.items),
      submittedAt: checklist.submittedAt,
      approvedAt: checklist.approvedAt,
      createdAt: checklist.createdAt,
      updatedAt: checklist.updatedAt,
    };
  }

  private toWorkCertificateSummary(certificate: DbWorkCertificate): WorkCertificateSummary {
    return {
      id: certificate.id,
      jobId: certificate.jobId,
      customerId: certificate.customerId,
      vendorId: certificate.vendorId,
      audience: certificate.audience,
      title: certificate.title,
      pdfFileName: certificate.pdfFileName,
      storageKey: certificate.storageKey,
      bodyText: certificate.bodyText,
      issuedAt: certificate.issuedAt,
    };
  }
}

function stringArrayFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function checklistItemsFromJson(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      label: typeof item.label === "string" ? item.label : "",
      checked: item.checked === true,
    }))
    .filter((item) => item.id && item.label);
}

function toDbDataScope(dataScope: DataScope): DbDataScope {
  return dataScope === "production" ? DbDataScope.PRODUCTION : DbDataScope.DEVELOPMENT;
}

function toAppDataScope(dataScope: DbDataScope): DataScope {
  return dataScope === DbDataScope.PRODUCTION ? "production" : "development";
}
