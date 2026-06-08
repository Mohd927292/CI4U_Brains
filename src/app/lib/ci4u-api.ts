export type DevRole =
  | "FOUNDER"
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MANAGEMENT"
  | "SALES_HEAD"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "OPERATIONS_HEAD"
  | "OPERATIONS_MANAGER"
  | "OPERATIONS_EXECUTIVE"
  | "VENDOR_MANAGER"
  | "ACCOUNTS_EXECUTIVE"
  | "SUPPORT_STAFF"
  | "VIEWER";

export type PermissionCode = "ADD_RAW_LEADS" | "WORK_ON_LEADS" | "TRANSFER_LEADS" | "SUPERVISOR" | "ADD_USERS" | "DELETE_USERS";

export type DevSession = {
  userId: string;
  name: string;
  role: DevRole;
  postTitle?: string | null;
  roleTags?: string[];
  permissions?: PermissionCode[];
  authorityStage?: number;
  dataScope: "development" | "production";
  email?: string | null;
  accessToken?: string;
  authMode?: "dev" | "supabase";
};

export type SessionUser = {
  id: string;
  authSubject: string | null;
  name: string;
  email: string | null;
  role: DevRole;
  postTitle: string | null;
  roleTags: string[];
  permissions: PermissionCode[];
  authorityStage: number;
  dataScope: "development" | "production";
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
};

export type ManagedUser = SessionUser & {
  createdAt: string;
  updatedAt: string;
  authProvisioning: "SUPABASE_CREATED" | "SUPABASE_INVITED" | "LOCAL_ONLY" | "SYNCED_LOGIN";
};

export type CreateManagedUserInput = {
  name: string;
  email: string;
  role: DevRole;
  postTitle?: string;
  roleTags?: string[];
  permissions?: PermissionCode[];
  authorityStage?: number;
  temporaryPassword?: string;
};

export type UpdateManagedUserInput = Partial<Omit<CreateManagedUserInput, "email">>;

export type AccessOptions = {
  roles: Array<{
    value: DevRole;
    label: string;
    defaultPostTitle: string;
    defaultRoleTags: string[];
    defaultAuthorityStage: number;
    defaultPermissions: PermissionCode[];
  }>;
  permissions: Array<{ value: PermissionCode; label: string }>;
};

export type AssignableUser = {
  id: string;
  name: string;
  email: string | null;
  role: DevRole;
  postTitle: string | null;
  roleTags: string[];
  authorityStage: number;
};

export type UserMetrics = {
  userId: string;
  userName: string;
  role: DevRole;
  postTitle: string | null;
  authorityStage: number;
  leadsAdded: number;
  leadsInteracted: number;
  warmLeads: number;
  hotLeads: number;
  wonLeads: number;
  leadsAssistedHot: number;
  leadsAssistedWon: number;
  summary: StaffPerformanceSummary;
  quickRanges: {
    today: StaffPerformanceQuickRange;
    week: StaffPerformanceQuickRange;
    month: StaffPerformanceQuickRange;
  };
  dailyBreakdown: StaffDailyPerformance[];
  range: {
    from: string;
    to: string;
  };
};

export type StaffPerformanceSummary = {
  leadsAdded: number;
  leadsHandled: number;
  assists: number;
  leadsAssistedHot: number;
  leadsAssistedWon: number;
  wonLeads: number;
  hotLeadsCaptured: number;
  completeWonLeads: number;
  followUpsCompleted: number;
  followUpsMissedOrDelayed: number;
  stageMovements: number;
  quotationsHandled: number;
  siteVisitsCoordinated: number;
  warmLeadHandling: number;
  installationLeadHandling: number;
  repairServiceLeadHandling: number;
  capturedProjects: number;
  whatsappDrafts: number;
  vendorsCreated: number;
  jobsCreated: number;
  jobsAssigned: number;
  workStarted: number;
  workCompleted: number;
  activeActions: number;
  conversionRate: number;
};

export type StaffPerformanceQuickRange = Pick<StaffPerformanceSummary, "leadsHandled" | "assists" | "wonLeads" | "followUpsCompleted">;

export type StaffDailyPerformance = {
  date: string;
  leadsHandled: number;
  assists: number;
  wonLeads: number;
  followUpsCompleted: number;
  quotationsHandled: number;
  siteVisitsCoordinated: number;
};

export type LeaderboardEntry = {
  userId: string;
  userName: string;
  role: DevRole;
  postTitle: string | null;
  authorityStage: number;
  value: number;
  helper: string;
};

export type StaffLeaderboards = {
  range: {
    from: string;
    to: string;
  };
  categories: Array<{
    key: string;
    label: string;
    entries: LeaderboardEntry[];
  }>;
};

export type TransferLeadInput = {
  toUserId: string;
  reason: string;
  followUpAt?: string;
};

export type NotificationSummary = {
  id: string;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
  relatedId: string | null;
  read: boolean;
  createdAt: string;
};

export type RawLeadListItem = {
  id: string;
  customerId: string;
  customerName: string;
  phoneNormalized: string;
  source: string;
  currentStage: string;
  currentIntent: string;
  priority: string;
  nextFollowUpAt: string | null;
  followUpReason: string | null;
  notReceivingCount: number;
  assignedToName: string | null;
  lastActivitySummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadSaveAck = RawLeadListItem & {
  savedAt: string;
  serverConfirmed: true;
};

export type LeadDetail = RawLeadListItem & {
  leadCycleNumber: number;
  siteVisitStatus: string | null;
  siteVisitScheduledAt: string | null;
  spokenCount: number;
  isArchived: boolean;
  archiveCategory: string | null;
  latestQuotation: QuotationSnapshot | null;
  wonDetails: WonDetailsSnapshot | null;
  quotationSuggestions: QuotationSuggestion;
  timeline: Array<{
    id: string;
    type: string;
    summary: string;
    createdAt: string;
  }>;
  firstCallOutcomeOptions: string[];
  followUpOutcomeOptions: string[];
};

export type LeadQueue = "RAW" | "WARM" | "HOT_INSTALLATION" | "HOT_REPAIR_SERVICE" | "UNANSWERED" | "GHOSTING" | "WON" | "LOST" | "ARCHIVE";

export type QueueCounts = Record<LeadQueue, number>;

export type QuotationSnapshot = {
  id: string;
  title: string;
  totalPricePaise: number;
  createdAt: string;
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

export type WonDetailsSnapshot = {
  siteContactNumber: string;
  useCustomerPhoneAsSiteContact: boolean;
  address: string;
  scopeOfWork: string;
  scheduleStatus: "SCHEDULED" | "NOT_SCHEDULED";
  scheduledAt: string | null;
  quotedPricePaise: number;
  acceptedPricePaise: number;
  advancePaymentPaise: number;
  createdAt: string;
};

export type SaveCallOutcomeInput = {
  callOutcome: "SPOKE" | "WARM" | "NOT_INTERESTED" | "WRONG_NUMBER" | "NOT_RECEIVING";
  conversationSummary?: string;
  leadIntent?: "WARM" | "INSTALLATION" | "REPAIR_SERVICE" | "LOST";
  followUpReason?: "NURTURE" | "SITE_VISIT" | "QUOTATION" | "WON";
  followUpAt?: string;
  siteVisitStatus?: "SCHEDULED" | "NOT_SCHEDULED";
  siteVisitScheduledAt?: string;
  intentChangeSummary?: string;
  lostSummary?: string;
  siteVisitOutcome?: {
    status: "COMPLETED" | "NOT_COMPLETED";
    outcomeSummary?: string;
    notCompletedReason?: string;
  };
  quotation?: {
    title: string;
    packages: Array<{
      packageName: string;
      multiplier: number;
      items: Array<{
        itemName: string;
        unitPriceRs: number;
        quantity?: number;
      }>;
    }>;
  };
  wonDetails?: {
    siteContactNumber: string;
    useCustomerPhoneAsSiteContact?: boolean;
    address: string;
    scopeOfWork: string;
    scheduleStatus: "SCHEDULED" | "NOT_SCHEDULED";
    scheduledAt?: string;
    quotedPriceRs: number;
    acceptedPriceRs: number;
    advancePaymentRs: number;
  };
  whatsappMessageBody?: string;
  uploadedFileName?: string;
};

export type CreateLeadResponse =
  | {
      outcome: "created";
      customer: {
        id: string;
        businessName: string;
        primaryPhoneNormalized: string;
        createdAt: string;
      };
      lead: RawLeadListItem;
    }
  | {
      outcome: "duplicate";
      duplicate: {
        phoneNormalized: string;
        customerId: string;
        customerName: string;
        currentLeadId: string | null;
        currentStage: string;
        isActive: boolean;
        isArchived: boolean;
        assignedToName: string | null;
        nextFollowUpAt: string | null;
        lastActivitySummary: string | null;
        totalJobs: number;
      };
      suggestedActions: string[];
    };

export type ImportRowInput = {
  rowNumber: number;
  businessName: string | null;
  phone: string | null;
};

export type ImportPreviewRow = {
  rowNumber: number;
  businessName: string | null;
  rawPhone: string | null;
  normalizedPhone: string | null;
  status: string;
  reason: string | null;
  duplicate: CreateLeadResponse extends { outcome: "duplicate"; duplicate: infer Duplicate } ? Duplicate | null : null;
};

export type ImportPreviewResult = {
  summary: {
    totalRows: number;
    newRows: number;
    duplicateRows: number;
    invalidPhoneRows: number;
    missingNameRows: number;
    duplicateInFileRows: number;
  };
  rows: ImportPreviewRow[];
};

export type ImportCommitResult = {
  summary: {
    requestedRows: number;
    createdRows: number;
    skippedRows: number;
  };
};

export type VendorTeamType = "INDIVIDUAL" | "TEAM";

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
  dataScope: "development" | "production";
  vendorCode: string;
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
  teamSize: number;
  skills: string[];
  kycStatus: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  teamMembers: Array<{
    id: string;
    name: string;
    phone: string | null;
    aadhaarDocumentName: string;
  }>;
};

export type VendorOfferSummary = {
  id: string;
  jobId: string;
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  offerPricePaise: number;
  status: string;
  messageBody: string;
  sentAt: string;
  respondedAt: string | null;
};

export type JobEventSummary = {
  id: string;
  type: string;
  oldStatus: string | null;
  newStatus: string | null;
  summary: string;
  createdAt: string;
};

export type JobPhotoType = "BEFORE_WORK" | "ISSUE_PHOTO" | "COMPLETED_WORK" | "CUSTOMER_CONFIRMATION" | "OTHER";
export type JobChecklistType = "INSTALLATION" | "REPAIR_SERVICE";
export type JobChecklistStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type WorkCertificateAudience = "CUSTOMER" | "VENDOR";

export type JobPhotoSummary = {
  id: string;
  jobId: string;
  vendorId: string | null;
  type: JobPhotoType;
  fileName: string;
  storageKey: string;
  notes: string | null;
  uploadedById: string | null;
  uploadedAt: string;
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
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  issuedAt: string;
};

export type JobOperation = {
  id: string;
  dataScope: "development" | "production";
  leadId: string;
  customerId: string;
  customerName: string;
  phoneNormalized: string;
  jobType: string;
  status: string;
  siteContactNumber: string;
  address: string;
  scopeOfWork: string;
  scheduledAt: string | null;
  vendorOfferPricePaise: number | null;
  assignedVendorId: string | null;
  assignedVendorName: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  completionSummary: string | null;
  vendorBonusPaise: number;
  vendorDeductionPaise: number;
  completionCertificateText: string | null;
  createdAt: string;
  updatedAt: string;
  offers: VendorOfferSummary[];
  events: JobEventSummary[];
  photos: JobPhotoSummary[];
  checklists: JobChecklistSummary[];
  certificates: WorkCertificateSummary[];
};

export type WonLeadOperationDetail = {
  lead: LeadDetail;
  wonDetails: WonDetailsSnapshot;
  job: JobOperation | null;
  vendors: VendorSummary[];
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_CI4U_API_BASE_URL ?? "http://127.0.0.1:4000/v1").replace(/\/$/, "");

export async function apiGet<T>(path: string, session: DevSession): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: getAuthHeaders(session),
    cache: "no-store",
  });

  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, session: DevSession, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...getAuthHeaders(session),
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, session: DevSession, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...getAuthHeaders(session),
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string, session: DevSession): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: getAuthHeaders(session),
  });

  return parseResponse<T>(response);
}

function getAuthHeaders(session: DevSession): Record<string, string> {
  if (session.accessToken) {
    return {
      authorization: `Bearer ${session.accessToken}`,
    };
  }

  return {
    "x-ci4u-data-scope": session.dataScope,
    "x-ci4u-dev-user-id": session.userId,
    "x-ci4u-dev-user-name": session.name,
    "x-ci4u-dev-role": session.role,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | { message?: string; code?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && payload.message
        ? payload.message
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}
