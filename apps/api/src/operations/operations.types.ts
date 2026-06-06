import type { DataScope } from "../auth/auth.types";
import type { LeadDetail, WonDetailsSnapshot } from "../leads/lead.types";

export type VendorKycStatus =
  | "KYC_NOT_STARTED"
  | "KYC_SUBMITTED"
  | "VERIFICATION_PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED"
  | "BLOCKED";

export type VendorTeamType = "INDIVIDUAL" | "TEAM";

export type JobStatus =
  | "WAITING_VENDOR_ASSIGNMENT"
  | "VENDOR_OFFER_SENT"
  | "VENDOR_ASSIGNED"
  | "WORK_STARTED"
  | "WORK_PAUSED"
  | "WORK_COMPLETED"
  | "CLOSED";

export type VendorOfferStatus = "OFFER_SENT" | "ACCEPTED" | "NEGOTIATED" | "REJECTED" | "CANCELLED";

export type JobEventType =
  | "JOB_CREATED"
  | "VENDOR_OFFER_SENT"
  | "WORK_STARTED"
  | "WORK_PAUSED"
  | "WORK_RESUMED"
  | "JOB_PHOTO_ADDED"
  | "JOB_CHECKLIST_SAVED"
  | "WORK_COMPLETED"
  | "CERTIFICATE_CREATED"
  | "JOB_CLOSED";

export type JobPhotoType = "BEFORE_WORK" | "ISSUE_PHOTO" | "COMPLETED_WORK" | "CUSTOMER_CONFIRMATION" | "OTHER";

export type JobChecklistType = "INSTALLATION" | "REPAIR_SERVICE";

export type JobChecklistStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export type WorkCertificateAudience = "CUSTOMER" | "VENDOR";

export type VendorTeamMemberInput = {
  name: string;
  phone?: string;
  aadhaarDocumentName: string;
};

export type CreateVendorInput = {
  vendorName: string;
  phone: string;
  workingAddress: string;
  address: string;
  pincode: string;
  dateOfBirth: string;
  experienceYears: number;
  aadhaarDocumentName: string;
  selfieDocumentName: string;
  signatureReference: string;
  teamType: VendorTeamType;
  teamSize?: number;
  skills?: string[];
  teamMembers?: VendorTeamMemberInput[];
};

export type VendorSummary = {
  id: string;
  dataScope: DataScope;
  vendorCode: string;
  vendorName: string;
  phone: string;
  workingAddress: string;
  address: string;
  pincode: string;
  dateOfBirth: Date;
  experienceYears: number;
  aadhaarDocumentName: string;
  selfieDocumentName: string;
  signatureReference: string;
  teamType: VendorTeamType;
  teamSize: number;
  skills: string[];
  kycStatus: VendorKycStatus;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  teamMembers: Array<{
    id: string;
    name: string;
    phone: string | null;
    aadhaarDocumentName: string;
  }>;
};

export type CreateVendorRecordInput = Omit<VendorSummary, "id" | "createdAt" | "updatedAt" | "teamMembers"> & {
  teamMembers: VendorTeamMemberInput[];
  now: Date;
};

export type VendorOfferSummary = {
  id: string;
  jobId: string;
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  offerPricePaise: number;
  status: VendorOfferStatus;
  messageBody: string;
  sentAt: Date;
  respondedAt: Date | null;
};

export type JobEventSummary = {
  id: string;
  type: JobEventType;
  oldStatus: JobStatus | null;
  newStatus: JobStatus | null;
  summary: string;
  createdAt: Date;
};

export type JobPhotoSummary = {
  id: string;
  jobId: string;
  vendorId: string | null;
  type: JobPhotoType;
  fileName: string;
  storageKey: string;
  notes: string | null;
  uploadedById: string | null;
  uploadedAt: Date;
};

export type ChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
};

export type JobChecklistSummary = {
  id: string;
  jobId: string;
  vendorId: string | null;
  type: JobChecklistType;
  status: JobChecklistStatus;
  items: ChecklistItem[];
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkCertificateSummary = {
  id: string;
  jobId: string;
  customerId: string;
  vendorId: string | null;
  audience: WorkCertificateAudience;
  title: string;
  pdfFileName: string;
  storageKey: string;
  bodyText: string;
  issuedAt: Date;
};

export type JobOperation = {
  id: string;
  dataScope: DataScope;
  leadId: string;
  customerId: string;
  customerName: string;
  phoneNormalized: string;
  jobType: string;
  status: JobStatus;
  siteContactNumber: string;
  address: string;
  scopeOfWork: string;
  scheduledAt: Date | null;
  vendorOfferPricePaise: number | null;
  assignedVendorId: string | null;
  assignedVendorName: string | null;
  startedAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  completionSummary: string | null;
  vendorBonusPaise: number;
  vendorDeductionPaise: number;
  completionCertificateText: string | null;
  createdAt: Date;
  updatedAt: Date;
  offers: VendorOfferSummary[];
  events: JobEventSummary[];
  photos: JobPhotoSummary[];
  checklists: JobChecklistSummary[];
  certificates: WorkCertificateSummary[];
};

export type CreateJobFromWonRecordInput = {
  dataScope: DataScope;
  lead: LeadDetail;
  wonDetails: WonDetailsSnapshot;
  now: Date;
  actorId: string | null;
};

export type AssignVendorOffersInput = {
  dataScope: DataScope;
  jobId: string;
  vendorIds: string[];
  offerPricePaise: number;
  actorId: string | null;
  now: Date;
};

export type TransitionJobInput = {
  dataScope: DataScope;
  jobId: string;
  nextStatus: JobStatus;
  eventType: JobEventType;
  summary: string;
  now: Date;
  actorId: string | null;
  completionSummary?: string;
  vendorBonusPaise?: number;
  vendorDeductionPaise?: number;
  completionCertificateText?: string;
};

export type AddJobPhotoRecordInput = {
  dataScope: DataScope;
  jobId: string;
  type: JobPhotoType;
  fileName: string;
  storageKey: string;
  notes: string | null;
  uploadedById: string | null;
  now: Date;
};

export type SaveJobChecklistRecordInput = {
  dataScope: DataScope;
  jobId: string;
  type: JobChecklistType;
  status: JobChecklistStatus;
  items: ChecklistItem[];
  submittedById: string | null;
  now: Date;
};

export type CreateWorkCertificatesRecordInput = {
  dataScope: DataScope;
  job: JobOperation;
  customerBodyText: string;
  vendorBodyText: string;
  actorId: string | null;
  now: Date;
};

export type WonLeadOperationDetail = {
  lead: LeadDetail;
  wonDetails: WonDetailsSnapshot;
  job: JobOperation | null;
  vendors: VendorSummary[];
};
