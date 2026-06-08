import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { DataScope } from "../auth/auth.types";
import { normalizeIndianMobilePhone } from "../domain/phone-normalization";
import { LeadIntakeService } from "../leads/lead-intake.service";
import { DuplicateVendorPhoneError, type OperationsRepository, operationsRepositoryToken } from "./operations.repository";
import type {
  AddJobPhotoRecordInput,
  ChecklistItem,
  CreateVendorInput,
  JobChecklistType,
  JobPhotoType,
  JobOperation,
  JobStatus,
  VendorTeamMemberInput,
  VendorSummary,
  WonLeadOperationDetail,
} from "./operations.types";

const vendorTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Team member name is required."),
  phone: z.string().trim().optional(),
  aadhaarDocumentName: z.string().trim().min(1, "Team member Aadhaar file name is required."),
});

const createVendorSchema = z
  .object({
    vendorName: z.string().trim().min(1, "Vendor name is required."),
    phone: z.string().trim().min(1, "Vendor phone is required."),
    workingAddress: z.string().trim().min(1, "Working address is required."),
    address: z.string().trim().min(1, "Address is required."),
    pincode: z.string().trim().min(3, "Pincode is required."),
    dateOfBirth: z.string().trim().min(1, "Date of birth is required."),
    experienceYears: z.coerce.number().int().min(0),
    aadhaarDocumentName: z.string().trim().min(1, "Aadhaar document is required."),
    selfieDocumentName: z.string().trim().min(1, "Selfie document is required."),
    signatureReference: z.string().trim().min(1, "Signature is required."),
    teamType: z.enum(["INDIVIDUAL", "TEAM"]),
    teamSize: z.coerce.number().int().min(1).optional(),
    skills: z.array(z.string().trim().min(1)).optional(),
    teamMembers: z.array(vendorTeamMemberSchema).optional(),
  })
  .superRefine((value, context) => {
    if (value.teamType === "TEAM") {
      const teamSize = value.teamSize ?? 0;

      if (teamSize < 2) {
        context.addIssue({
          code: "custom",
          path: ["teamSize"],
          message: "Team size must be at least 2 when vendor type is Team.",
        });
      }

      if ((value.teamMembers ?? []).length !== teamSize) {
        context.addIssue({
          code: "custom",
          path: ["teamMembers"],
          message: "Team member Aadhaar details must match the entered team size.",
        });
      }
    }
  });

export type AssignJobInput = {
  vendorIds?: string[];
  offerPriceRs?: number;
};

export type CompleteJobInput = {
  completionSummary?: string;
  vendorBonusRs?: number;
  vendorDeductionRs?: number;
};

export type AddJobPhotoInput = {
  type?: JobPhotoType;
  fileName?: string;
  notes?: string;
};

export type SaveJobChecklistInput = {
  type?: JobChecklistType;
  items?: ChecklistItem[];
  submit?: boolean;
};

const addJobPhotoSchema = z.object({
  type: z.enum(["BEFORE_WORK", "ISSUE_PHOTO", "COMPLETED_WORK", "CUSTOMER_CONFIRMATION", "OTHER"]),
  fileName: z.string().trim().min(1, "Photo file name is required."),
  notes: z.string().trim().optional(),
});

const checklistItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  checked: z.boolean(),
});

const saveJobChecklistSchema = z.object({
  type: z.enum(["INSTALLATION", "REPAIR_SERVICE"]),
  items: z.array(checklistItemSchema).min(1, "Checklist needs at least one item."),
  submit: z.boolean().optional(),
});

@Injectable()
export class OperationsService {
  constructor(
    @Inject(operationsRepositoryToken)
    private readonly operationsRepository: OperationsRepository,
    @Inject(LeadIntakeService)
    private readonly leadIntakeService: LeadIntakeService,
  ) {}

  async listVendors(dataScope: DataScope): Promise<VendorSummary[]> {
    return this.operationsRepository.listVendors(dataScope);
  }

  async createVendor(dataScope: DataScope, input: CreateVendorInput, actorId: string | null = null): Promise<VendorSummary> {
    const parsed = createVendorSchema.parse(input);
    const phone = normalizeIndianMobilePhone(parsed.phone);

    if (!phone.ok) {
      throw new OperationsValidationError(phone.message, phone.code);
    }

    const dateOfBirth = parseDate(parsed.dateOfBirth, "Date of birth is invalid.");
    const normalizedMembers: VendorTeamMemberInput[] = (parsed.teamMembers ?? []).map((member) => {
      if (!member.phone) {
        return {
          name: member.name,
          aadhaarDocumentName: member.aadhaarDocumentName,
        };
      }

      const memberPhone = normalizeIndianMobilePhone(member.phone);

      if (!memberPhone.ok) {
        throw new OperationsValidationError(`Team member ${member.name}: ${memberPhone.message}`, memberPhone.code);
      }

      return {
        name: member.name,
        aadhaarDocumentName: member.aadhaarDocumentName,
        phone: memberPhone.phoneNormalized,
      };
    });

    const now = new Date();
    const vendorCode = makeVendorCode(now);

    try {
      return await this.operationsRepository.createVendor({
        dataScope,
        vendorCode,
        vendorName: parsed.vendorName,
        phone: phone.phoneNormalized,
        workingAddress: parsed.workingAddress,
        address: parsed.address,
        pincode: parsed.pincode,
        dateOfBirth,
        experienceYears: parsed.experienceYears,
        aadhaarDocumentName: parsed.aadhaarDocumentName,
        selfieDocumentName: parsed.selfieDocumentName,
        signatureReference: parsed.signatureReference,
        teamType: parsed.teamType,
        teamSize: parsed.teamType === "TEAM" ? parsed.teamSize ?? normalizedMembers.length : 1,
        skills: parsed.skills ?? [],
        kycStatus: "VERIFICATION_PENDING",
        active: true,
        teamMembers: parsed.teamType === "TEAM" ? normalizedMembers : [],
        now,
        actorId,
      });
    } catch (error) {
      if (error instanceof DuplicateVendorPhoneError) {
        throw new OperationsValidationError(`Vendor phone already exists: ${error.vendor.vendorName} (${error.vendor.vendorCode}).`, "DUPLICATE_VENDOR_PHONE");
      }

      throw error;
    }
  }

  async getWonLeadOperation(dataScope: DataScope, leadId: string): Promise<WonLeadOperationDetail | null> {
    const lead = await this.leadIntakeService.getLeadDetail(dataScope, leadId);

    if (!lead) {
      return null;
    }

    if (lead.currentStage !== "CAPTURED_WON" || !lead.wonDetails) {
      throw new OperationsValidationError("Only won leads with uploaded won details can enter operations.", "WON_DETAILS_REQUIRED");
    }

    const [job, vendors] = await Promise.all([
      this.operationsRepository.getJobByLeadId(dataScope, leadId),
      this.operationsRepository.listVendors(dataScope),
    ]);

    return {
      lead,
      wonDetails: lead.wonDetails,
      job,
      vendors,
    };
  }

  async createJobFromWonLead(dataScope: DataScope, leadId: string, actorId: string | null): Promise<JobOperation> {
    const detail = await this.getWonLeadOperation(dataScope, leadId);

    if (!detail) {
      throw new OperationsValidationError("Lead was not found.", "LEAD_NOT_FOUND");
    }

    return this.operationsRepository.createJobFromWonLead({
      dataScope,
      lead: detail.lead,
      wonDetails: detail.wonDetails,
      now: new Date(),
      actorId,
    });
  }

  async assignJob(dataScope: DataScope, jobId: string, actorId: string | null, input: AssignJobInput): Promise<JobOperation> {
    const vendorIds = Array.isArray(input.vendorIds) ? Array.from(new Set(input.vendorIds.filter(Boolean))) : [];

    if (!vendorIds.length) {
      throw new OperationsValidationError("Select at least one vendor before sending a work offer.", "VENDOR_REQUIRED");
    }

    const offerPricePaise = rsToPaise(Number(input.offerPriceRs ?? 0));

    if (offerPricePaise <= 0) {
      throw new OperationsValidationError("Vendor offer price must be greater than zero.", "OFFER_PRICE_REQUIRED");
    }

    const job = await this.operationsRepository.getJobById(dataScope, jobId);

    if (!job) {
      throw new OperationsValidationError("Job was not found.", "JOB_NOT_FOUND");
    }

    this.requireStatus(job, ["WAITING_VENDOR_ASSIGNMENT", "VENDOR_OFFER_SENT", "VENDOR_ASSIGNED"], "Vendor offers can only be sent before work starts.");

    return this.operationsRepository.assignVendorOffers({
      dataScope,
      jobId,
      vendorIds,
      offerPricePaise,
      actorId,
      now: new Date(),
    });
  }

  async addJobPhoto(dataScope: DataScope, jobId: string, actorId: string | null, input: AddJobPhotoInput): Promise<JobOperation> {
    const parsed = addJobPhotoSchema.parse(input);
    const job = await this.requireJob(dataScope, jobId);
    this.requireStatus(job, ["WORK_STARTED", "WORK_PAUSED", "VENDOR_OFFER_SENT", "VENDOR_ASSIGNED"], "Photos can be added only after vendor offer/assignment starts.");
    const now = new Date();

    return this.operationsRepository.addJobPhoto({
      dataScope,
      jobId,
      type: parsed.type,
      fileName: parsed.fileName,
      storageKey: buildProofStorageKey(dataScope, jobId, parsed.fileName, now),
      notes: parsed.notes?.trim() || null,
      uploadedById: actorId,
      now,
    });
  }

  async saveJobChecklist(dataScope: DataScope, jobId: string, actorId: string | null, input: SaveJobChecklistInput): Promise<JobOperation> {
    const parsed = saveJobChecklistSchema.parse(input);
    const job = await this.requireJob(dataScope, jobId);
    this.requireStatus(job, ["WORK_STARTED", "WORK_PAUSED", "VENDOR_OFFER_SENT", "VENDOR_ASSIGNED"], "Checklist can be saved only after vendor offer/assignment starts.");
    const status = parsed.submit ? "SUBMITTED" : "DRAFT";

    if (parsed.submit && parsed.items.some((item) => !item.checked)) {
      throw new OperationsValidationError("Every checklist item must be checked before submitting completion proof.", "CHECKLIST_INCOMPLETE");
    }

    return this.operationsRepository.saveJobChecklist({
      dataScope,
      jobId,
      type: parsed.type,
      status,
      items: parsed.items,
      submittedById: actorId,
      now: new Date(),
    });
  }

  async startJob(dataScope: DataScope, jobId: string, actorId: string | null): Promise<JobOperation> {
    const job = await this.requireJob(dataScope, jobId);
    this.requireStatus(job, ["VENDOR_OFFER_SENT", "VENDOR_ASSIGNED", "WORK_PAUSED"], "Work can start only after vendor offer/assignment.");
    const resumed = job.status === "WORK_PAUSED";

    return this.operationsRepository.transitionJob({
      dataScope,
      jobId,
      nextStatus: "WORK_STARTED",
      eventType: resumed ? "WORK_RESUMED" : "WORK_STARTED",
      summary: resumed ? "Work resumed by operations staff." : "Work marked as started by operations staff.",
      now: new Date(),
      actorId,
    });
  }

  async pauseJob(dataScope: DataScope, jobId: string, actorId: string | null): Promise<JobOperation> {
    const job = await this.requireJob(dataScope, jobId);
    this.requireStatus(job, ["WORK_STARTED"], "Only started work can be paused.");

    return this.operationsRepository.transitionJob({
      dataScope,
      jobId,
      nextStatus: "WORK_PAUSED",
      eventType: "WORK_PAUSED",
      summary: "Work paused by operations staff.",
      now: new Date(),
      actorId,
    });
  }

  async completeJob(dataScope: DataScope, jobId: string, actorId: string | null, input: CompleteJobInput): Promise<JobOperation> {
    const job = await this.requireJob(dataScope, jobId);
    this.requireStatus(job, ["WORK_STARTED", "WORK_PAUSED"], "Only started or paused work can be completed.");
    const completionSummary = input.completionSummary?.trim();

    if (!completionSummary) {
      throw new OperationsValidationError("Completion summary is required before closing the work.", "COMPLETION_SUMMARY_REQUIRED");
    }

    const now = new Date();
    const vendorBonusPaise = rsToPaise(Number(input.vendorBonusRs ?? 0));
    const vendorDeductionPaise = rsToPaise(Number(input.vendorDeductionRs ?? 0));
    this.assertCompletionProof(job);
    const customerCertificateText = buildCompletionCertificate("CUSTOMER", job, completionSummary, vendorBonusPaise, vendorDeductionPaise, now);
    const vendorCertificateText = buildCompletionCertificate("VENDOR", job, completionSummary, vendorBonusPaise, vendorDeductionPaise, now);

    const closed = await this.operationsRepository.transitionJob({
      dataScope,
      jobId,
      nextStatus: "CLOSED",
      eventType: "JOB_CLOSED",
      summary: "Work completed, closed, and completion certificate saved.",
      now,
      actorId,
      completionSummary,
      vendorBonusPaise,
      vendorDeductionPaise,
      completionCertificateText: customerCertificateText,
    });

    return this.operationsRepository.createWorkCertificates({
      dataScope,
      job: closed,
      customerBodyText: customerCertificateText,
      vendorBodyText: vendorCertificateText,
      actorId,
      now,
    });
  }

  private async requireJob(dataScope: DataScope, jobId: string): Promise<JobOperation> {
    const job = await this.operationsRepository.getJobById(dataScope, jobId);

    if (!job) {
      throw new OperationsValidationError("Job was not found.", "JOB_NOT_FOUND");
    }

    return job;
  }

  private requireStatus(job: JobOperation, allowed: JobStatus[], message: string): void {
    if (!allowed.includes(job.status)) {
      throw new OperationsValidationError(message, "INVALID_JOB_STATUS");
    }
  }

  private assertCompletionProof(job: JobOperation): void {
    const hasCompletedPhoto = job.photos.some((photo) => photo.type === "COMPLETED_WORK");
    const submittedChecklist = job.checklists.find((checklist) => checklist.status === "SUBMITTED");
    const checklistComplete = Boolean(submittedChecklist && submittedChecklist.items.length > 0 && submittedChecklist.items.every((item) => item.checked));

    if (!hasCompletedPhoto) {
      throw new OperationsValidationError("At least one completed-work photo is required before closing the job.", "COMPLETED_PHOTO_REQUIRED");
    }

    if (!checklistComplete) {
      throw new OperationsValidationError("A fully submitted checklist is required before closing the job.", "CHECKLIST_REQUIRED");
    }
  }
}

function parseDate(value: string, message: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new OperationsValidationError(message, "INVALID_DATE");
  }

  return date;
}

function rsToPaise(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new OperationsValidationError("Amount must be a whole number in Rs.", "INVALID_AMOUNT");
  }

  return value * 100;
}

function makeVendorCode(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `VID-${date}-${suffix}`;
}

function buildCompletionCertificate(audience: "CUSTOMER" | "VENDOR", job: JobOperation, completionSummary: string, vendorBonusPaise: number, vendorDeductionPaise: number, now: Date): string {
  const proofLine = `${job.photos.length} photo proof record${job.photos.length === 1 ? "" : "s"} saved; ${job.checklists.length} checklist record${job.checklists.length === 1 ? "" : "s"} saved.`;
  const financialLines =
    audience === "VENDOR"
      ? [
          `Vendor offer price: ${job.vendorOfferPricePaise ? `Rs ${Math.round(job.vendorOfferPricePaise / 100)}` : "Not recorded"}`,
          `Vendor bonus: Rs ${Math.round(vendorBonusPaise / 100)}`,
          `Vendor deduction: Rs ${Math.round(vendorDeductionPaise / 100)}`,
        ]
      : [];

  return [
    `CI4U ${audience} WORK COMPLETION CERTIFICATE`,
    "",
    `Job ID: ${job.id}`,
    `Customer: ${job.customerName}`,
    `Site contact: ${job.siteContactNumber}`,
    `Address: ${job.address}`,
    `Scope of work: ${job.scopeOfWork}`,
    `Scheduled at: ${job.scheduledAt ? job.scheduledAt.toISOString() : "Not scheduled"}`,
    `Work started at: ${job.startedAt ? job.startedAt.toISOString() : "Not recorded"}`,
    `Work completed at: ${now.toISOString()}`,
    `Assigned vendor: ${job.assignedVendorName ?? "Not recorded"}`,
    `Proof: ${proofLine}`,
    ...financialLines,
    "",
    "Completion summary:",
    completionSummary,
    "",
    "PDF storage key is generated by the backend. Production deployment should write the rendered PDF into protected object storage.",
  ].join("\n");
}

function buildProofStorageKey(dataScope: DataScope, jobId: string, fileName: string, now: Date): string {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${dataScope}/job-photos/${jobId}/${now.getTime()}-${safeFileName}`;
}

export class OperationsValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
