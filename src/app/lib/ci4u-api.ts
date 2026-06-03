export type DevRole =
  | "FOUNDER"
  | "ADMIN"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "OPERATIONS_MANAGER"
  | "VENDOR_MANAGER"
  | "VIEWER";

export type DevSession = {
  userId: string;
  name: string;
  role: DevRole;
  dataScope: "development";
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

export type LeadQueue = "RAW" | "WARM" | "HOT_INSTALLATION" | "HOT_REPAIR_SERVICE" | "UNANSWERED" | "WON" | "LOST" | "ARCHIVE";

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

const apiBaseUrl = (process.env.NEXT_PUBLIC_CI4U_API_BASE_URL ?? "http://127.0.0.1:4000/v1").replace(/\/$/, "");

export async function apiGet<T>(path: string, session: DevSession): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: getDevHeaders(session),
    cache: "no-store",
  });

  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, session: DevSession, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...getDevHeaders(session),
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

function getDevHeaders(session: DevSession): Record<string, string> {
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
