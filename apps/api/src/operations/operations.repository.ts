import { randomUUID } from "node:crypto";
import type { DataScope } from "../auth/auth.types";
import type {
  AssignVendorOffersInput,
  AddJobPhotoRecordInput,
  CreateWorkCertificatesRecordInput,
  CreateJobFromWonRecordInput,
  CreateVendorRecordInput,
  SaveJobChecklistRecordInput,
  JobEventSummary,
  JobOperation,
  JobStatus,
  TransitionJobInput,
  VendorOfferSummary,
  VendorSummary,
} from "./operations.types";

export const operationsRepositoryToken = Symbol("OperationsRepository");

export interface OperationsRepository {
  listVendors(dataScope: DataScope): Promise<VendorSummary[]>;
  createVendor(input: CreateVendorRecordInput): Promise<VendorSummary>;
  getJobByLeadId(dataScope: DataScope, leadId: string): Promise<JobOperation | null>;
  getJobById(dataScope: DataScope, jobId: string): Promise<JobOperation | null>;
  createJobFromWonLead(input: CreateJobFromWonRecordInput): Promise<JobOperation>;
  assignVendorOffers(input: AssignVendorOffersInput): Promise<JobOperation>;
  addJobPhoto(input: AddJobPhotoRecordInput): Promise<JobOperation>;
  saveJobChecklist(input: SaveJobChecklistRecordInput): Promise<JobOperation>;
  createWorkCertificates(input: CreateWorkCertificatesRecordInput): Promise<JobOperation>;
  transitionJob(input: TransitionJobInput): Promise<JobOperation>;
}

export class DuplicateVendorPhoneError extends Error {
  constructor(readonly vendor: VendorSummary) {
    super(`Phone number already belongs to vendor ${vendor.vendorCode}.`);
  }
}

export class InMemoryOperationsRepository implements OperationsRepository {
  private readonly vendors = new Map<string, VendorSummary>();
  private readonly jobs = new Map<string, JobOperation>();
  private readonly jobByLeadId = new Map<string, string>();

  async listVendors(dataScope: DataScope): Promise<VendorSummary[]> {
    return Array.from(this.vendors.values())
      .filter((vendor) => vendor.dataScope === dataScope)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async createVendor(input: CreateVendorRecordInput): Promise<VendorSummary> {
    const duplicate = Array.from(this.vendors.values()).find(
      (vendor) => vendor.dataScope === input.dataScope && vendor.phone === input.phone,
    );

    if (duplicate) {
      throw new DuplicateVendorPhoneError(duplicate);
    }

    const vendor: VendorSummary = {
      id: randomUUID(),
      dataScope: input.dataScope,
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
      teamMembers: input.teamMembers.map((member) => ({
        id: randomUUID(),
        name: member.name,
        phone: member.phone ?? null,
        aadhaarDocumentName: member.aadhaarDocumentName,
      })),
    };
    this.vendors.set(vendor.id, vendor);
    return vendor;
  }

  async getJobByLeadId(dataScope: DataScope, leadId: string): Promise<JobOperation | null> {
    const jobId = this.jobByLeadId.get(`${dataScope}:${leadId}`);
    const job = jobId ? this.jobs.get(jobId) ?? null : null;
    return job && job.dataScope === dataScope ? cloneJob(job) : null;
  }

  async getJobById(dataScope: DataScope, jobId: string): Promise<JobOperation | null> {
    const job = this.jobs.get(jobId) ?? null;
    return job && job.dataScope === dataScope ? cloneJob(job) : null;
  }

  async createJobFromWonLead(input: CreateJobFromWonRecordInput): Promise<JobOperation> {
    const existing = await this.getJobByLeadId(input.dataScope, input.lead.id);

    if (existing) {
      return existing;
    }

    const job: JobOperation = {
      id: randomUUID(),
      dataScope: input.dataScope,
      leadId: input.lead.id,
      customerId: input.lead.customerId,
      customerName: input.lead.customerName,
      phoneNormalized: input.lead.phoneNormalized,
      jobType: input.lead.currentIntent === "REPAIR_SERVICE" ? "Repair / Service" : "Installation",
      status: "WAITING_VENDOR_ASSIGNMENT",
      siteContactNumber: input.wonDetails.siteContactNumber,
      address: input.wonDetails.address,
      scopeOfWork: input.wonDetails.scopeOfWork,
      scheduledAt: input.wonDetails.scheduledAt,
      vendorOfferPricePaise: null,
      assignedVendorId: null,
      assignedVendorName: null,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      completionSummary: null,
      vendorBonusPaise: 0,
      vendorDeductionPaise: 0,
      completionCertificateText: null,
      createdAt: input.now,
      updatedAt: input.now,
      offers: [],
      events: [
        {
          id: randomUUID(),
          type: "JOB_CREATED",
          oldStatus: null,
          newStatus: "WAITING_VENDOR_ASSIGNMENT",
          summary: `Operations job created from won lead ${input.lead.customerName}.`,
          createdAt: input.now,
        },
      ],
      photos: [],
      checklists: [],
      certificates: [],
    };

    this.jobs.set(job.id, job);
    this.jobByLeadId.set(`${input.dataScope}:${input.lead.id}`, job.id);
    return cloneJob(job);
  }

  async assignVendorOffers(input: AssignVendorOffersInput): Promise<JobOperation> {
    const job = this.requireJob(input.dataScope, input.jobId);
    const vendors = input.vendorIds.map((vendorId) => this.requireVendor(input.dataScope, vendorId));
    const messageBodies = vendors.map((vendor) => ({
      vendor,
      body: buildVendorOfferMessage(job, vendor.vendorName, input.offerPricePaise),
    }));

    for (const { vendor, body } of messageBodies) {
      const existingIndex = job.offers.findIndex((offer) => offer.vendorId === vendor.id);
      const existingOffer = existingIndex >= 0 ? job.offers[existingIndex] : null;
      const offer: VendorOfferSummary = {
        id: existingOffer ? existingOffer.id : randomUUID(),
        jobId: job.id,
        vendorId: vendor.id,
        vendorName: vendor.vendorName,
        vendorPhone: vendor.phone,
        offerPricePaise: input.offerPricePaise,
        status: "OFFER_SENT",
        messageBody: body,
        sentAt: input.now,
        respondedAt: null,
      };

      if (existingIndex >= 0) {
        job.offers[existingIndex] = offer;
      } else {
        job.offers.push(offer);
      }
    }

    const previousStatus = job.status;
    job.status = "VENDOR_OFFER_SENT";
    job.vendorOfferPricePaise = input.offerPricePaise;
    job.assignedVendorId = vendors[0]?.id ?? null;
    job.assignedVendorName = vendors[0]?.vendorName ?? null;
    job.updatedAt = input.now;
    job.events.push(makeEvent("VENDOR_OFFER_SENT", previousStatus, job.status, `Vendor offer sent to ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}.`, input.now));
    return cloneJob(job);
  }

  async transitionJob(input: TransitionJobInput): Promise<JobOperation> {
    const job = this.requireJob(input.dataScope, input.jobId);
    const previousStatus = job.status;
    job.status = input.nextStatus;
    job.updatedAt = input.now;

    if (input.nextStatus === "WORK_STARTED") {
      job.startedAt = job.startedAt ?? input.now;
      job.pausedAt = null;
    }

    if (input.nextStatus === "WORK_PAUSED") {
      job.pausedAt = input.now;
    }

    if (input.nextStatus === "WORK_COMPLETED" || input.nextStatus === "CLOSED") {
      job.completedAt = input.now;
      job.completionSummary = input.completionSummary ?? job.completionSummary;
      job.vendorBonusPaise = input.vendorBonusPaise ?? job.vendorBonusPaise;
      job.vendorDeductionPaise = input.vendorDeductionPaise ?? job.vendorDeductionPaise;
      job.completionCertificateText = input.completionCertificateText ?? job.completionCertificateText;
    }

    job.events.push(makeEvent(input.eventType, previousStatus, input.nextStatus, input.summary, input.now));
    return cloneJob(job);
  }

  async addJobPhoto(input: AddJobPhotoRecordInput): Promise<JobOperation> {
    const job = this.requireJob(input.dataScope, input.jobId);
    job.photos.push({
      id: randomUUID(),
      jobId: job.id,
      vendorId: job.assignedVendorId,
      type: input.type,
      fileName: input.fileName,
      storageKey: input.storageKey,
      notes: input.notes,
      uploadedById: input.uploadedById,
      uploadedAt: input.now,
    });
    job.events.push(makeEvent("JOB_PHOTO_ADDED", job.status, job.status, `Photo proof added: ${input.fileName}.`, input.now));
    job.updatedAt = input.now;
    return cloneJob(job);
  }

  async saveJobChecklist(input: SaveJobChecklistRecordInput): Promise<JobOperation> {
    const job = this.requireJob(input.dataScope, input.jobId);
    const existingIndex = job.checklists.findIndex((checklist) => checklist.type === input.type);
    const checklist = {
      id: existingIndex >= 0 ? job.checklists[existingIndex]?.id ?? randomUUID() : randomUUID(),
      jobId: job.id,
      vendorId: job.assignedVendorId,
      type: input.type,
      status: input.status,
      items: input.items.map((item) => ({ ...item })),
      submittedAt: input.status === "SUBMITTED" ? input.now : null,
      approvedAt: null,
      createdAt: existingIndex >= 0 ? job.checklists[existingIndex]?.createdAt ?? input.now : input.now,
      updatedAt: input.now,
    };

    if (existingIndex >= 0) {
      job.checklists[existingIndex] = checklist;
    } else {
      job.checklists.push(checklist);
    }

    job.events.push(makeEvent("JOB_CHECKLIST_SAVED", job.status, job.status, `${input.type.replaceAll("_", " ")} checklist ${input.status.toLowerCase()}.`, input.now));
    job.updatedAt = input.now;
    return cloneJob(job);
  }

  async createWorkCertificates(input: CreateWorkCertificatesRecordInput): Promise<JobOperation> {
    const job = this.requireJob(input.dataScope, input.job.id);
    const certificates = [
      {
        id: job.certificates.find((certificate) => certificate.audience === "CUSTOMER")?.id ?? randomUUID(),
        jobId: job.id,
        customerId: job.customerId,
        vendorId: job.assignedVendorId,
        audience: "CUSTOMER" as const,
        title: "Customer Work Completion Certificate",
        pdfFileName: `CI4U-${job.id}-customer-certificate.pdf`,
        storageKey: `development/work-certificates/${job.id}/customer.pdf`,
        bodyText: input.customerBodyText,
        issuedAt: input.now,
      },
      {
        id: job.certificates.find((certificate) => certificate.audience === "VENDOR")?.id ?? randomUUID(),
        jobId: job.id,
        customerId: job.customerId,
        vendorId: job.assignedVendorId,
        audience: "VENDOR" as const,
        title: "Vendor Work Completion Certificate",
        pdfFileName: `CI4U-${job.id}-vendor-certificate.pdf`,
        storageKey: `development/work-certificates/${job.id}/vendor.pdf`,
        bodyText: input.vendorBodyText,
        issuedAt: input.now,
      },
    ];

    job.certificates = certificates;
    job.completionCertificateText = input.customerBodyText;
    job.events.push(makeEvent("CERTIFICATE_CREATED", job.status, job.status, "Customer and vendor completion certificates created.", input.now));
    job.updatedAt = input.now;
    return cloneJob(job);
  }

  private requireJob(dataScope: DataScope, jobId: string): JobOperation {
    const job = this.jobs.get(jobId);

    if (!job || job.dataScope !== dataScope) {
      throw new Error(`Job ${jobId} was not found.`);
    }

    return job;
  }

  private requireVendor(dataScope: DataScope, vendorId: string): VendorSummary {
    const vendor = this.vendors.get(vendorId);

    if (!vendor || vendor.dataScope !== dataScope || !vendor.active) {
      throw new Error(`Vendor ${vendorId} was not found or is inactive.`);
    }

    return vendor;
  }
}

function makeEvent(type: JobEventSummary["type"], oldStatus: JobStatus | null, newStatus: JobStatus, summary: string, now: Date): JobEventSummary {
  return {
    id: randomUUID(),
    type,
    oldStatus,
    newStatus,
    summary,
    createdAt: now,
  };
}

function cloneJob(job: JobOperation): JobOperation {
  return {
    ...job,
    offers: job.offers.map((offer) => ({ ...offer })),
    events: job.events.map((event) => ({ ...event })),
    photos: job.photos.map((photo) => ({ ...photo })),
    checklists: job.checklists.map((checklist) => ({
      ...checklist,
      items: checklist.items.map((item) => ({ ...item })),
    })),
    certificates: job.certificates.map((certificate) => ({ ...certificate })),
  };
}

export function buildVendorOfferMessage(job: JobOperation, vendorName: string, offerPricePaise: number): string {
  const schedule = job.scheduledAt ? job.scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled yet";

  return [
    `Hello ${vendorName}, CI4U has a work offer.`,
    "",
    `Customer: ${job.customerName}`,
    `Site contact: ${job.siteContactNumber}`,
    `Location / address: ${job.address}`,
    `Scope of work: ${job.scopeOfWork}`,
    `Schedule: ${schedule}`,
    `Vendor offer price: Rs ${Math.round(offerPricePaise / 100)}`,
    "",
    "Please reply Accept, Negotiate, or Reject.",
  ].join("\n");
}
