"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FileSpreadsheet,
  Info as InfoIcon,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Menu,
  Pause,
  Plus,
  Send,
  UserPlus,
  RefreshCw,
  Search,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiGet,
  apiPost,
  apiDelete,
  type AccessOptions,
  type AssignableUser,
  type ChecklistItem,
  type CreateManagedUserInput,
  type CreateVendorInput,
  type CreateLeadResponse,
  type DevRole,
  type DevSession,
  type ImportCommitResult,
  type ImportPreviewResult,
  type ImportRowInput,
  type JobChecklistType,
  type JobOperation,
  type JobPhotoType,
  type LeadDetail,
  type LeadQueue,
  type LeadSaveAck,
  type ManagedUser,
  type NotificationSummary,
  type PermissionCode,
  type QueueCounts,
  type RawLeadListItem,
  type SaveCallOutcomeInput,
  type SessionUser,
  type TransferLeadInput,
  type UserMetrics,
  type VendorSummary,
  type VendorTeamMemberInput,
  type WonLeadOperationDetail,
} from "../lib/ci4u-api";
import { getSupabaseBrowserClient, isProductionAuthEnabled } from "../lib/supabase-browser";

const sessionStorageKey = "ci4u.devSession.v1";
const pendingLeadSavesStorageKey = "ci4u.pendingLeadSaves.v1";

const devUsers: Array<{ name: string; role: DevRole; label: string }> = [
  { name: "Rahul Verma", role: "FOUNDER", label: "Founder / full dev access" },
  { name: "Rachana Decos", role: "SALES_MANAGER", label: "Sales manager testing" },
  { name: "Sandeep Decos", role: "SALES_EXECUTIVE", label: "Sales executive testing" },
  { name: "Operations Dev", role: "OPERATIONS_MANAGER", label: "Operations workflow testing" },
  { name: "Vendor Desk", role: "VENDOR_MANAGER", label: "Vendor KYC and work assignment testing" },
];

type ActiveView = "dashboard" | "raw-leads" | "lead-detail" | "vendors" | "users";

const emptyQueueCounts: QueueCounts = {
  RAW: 0,
  WARM: 0,
  HOT_INSTALLATION: 0,
  HOT_REPAIR_SERVICE: 0,
  UNANSWERED: 0,
  GHOSTING: 0,
  WON: 0,
  LOST: 0,
  ARCHIVE: 0,
};

type FailedBackgroundSave = {
  lead: LeadDetail;
  payload: SaveCallOutcomeInput;
  queue: LeadQueue;
  message: string;
};

type QueueLoadOptions = {
  preferCache?: boolean;
  refreshCounts?: boolean;
};

function readPendingBackgroundSaves(): FailedBackgroundSave[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const saved = window.localStorage.getItem(pendingLeadSavesStorageKey);
    return saved ? (JSON.parse(saved) as FailedBackgroundSave[]) : [];
  } catch {
    return [];
  }
}

function writePendingBackgroundSaves(saves: FailedBackgroundSave[]) {
  if (typeof window === "undefined") {
    return;
  }

  if (!saves.length) {
    window.localStorage.removeItem(pendingLeadSavesStorageKey);
    return;
  }

  window.localStorage.setItem(pendingLeadSavesStorageKey, JSON.stringify(saves));
}

function rememberBackgroundSave(save: FailedBackgroundSave) {
  const existing = readPendingBackgroundSaves().filter((item) => item.lead.id !== save.lead.id);
  writePendingBackgroundSaves([...existing, save]);
}

function forgetBackgroundSave(leadId: string) {
  writePendingBackgroundSaves(readPendingBackgroundSaves().filter((item) => item.lead.id !== leadId));
}

function canManageUsers(session: DevSession): boolean {
  return hasPermission(session, "ADD_USERS") || hasPermission(session, "DELETE_USERS") || hasPermission(session, "SUPERVISOR");
}

function hasPermission(session: DevSession | SessionUser, permission: PermissionCode): boolean {
  if (session.role === "FOUNDER" || session.role === "SUPER_ADMIN") {
    return true;
  }

  return Boolean(session.permissions?.includes(permission));
}

const allPermissionCodes: PermissionCode[] = ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS", "SUPERVISOR", "ADD_USERS", "DELETE_USERS"];

function defaultPostTitleForRole(role: DevRole): string {
  if (role === "FOUNDER") {
    return "BDM";
  }

  if (role === "SUPER_ADMIN") {
    return "Co-Founder / CTO";
  }

  return formatEnum(role);
}

function defaultTagsForRole(role: DevRole): string[] {
  if (role === "FOUNDER") {
    return ["BDM"];
  }

  if (role === "SUPER_ADMIN") {
    return ["CO_FOUNDER", "CTO"];
  }

  return [];
}

function defaultStageForRole(role: DevRole): number {
  if (role === "SUPER_ADMIN") {
    return 100;
  }

  if (role === "FOUNDER") {
    return 90;
  }

  if (role === "ADMIN" || role === "MANAGEMENT") {
    return 80;
  }

  if (role.endsWith("_HEAD")) {
    return 70;
  }

  if (role.includes("MANAGER")) {
    return 60;
  }

  if (role === "VIEWER") {
    return 10;
  }

  return 30;
}

function defaultPermissionsForRole(role: DevRole): PermissionCode[] {
  if (role === "FOUNDER" || role === "SUPER_ADMIN") {
    return allPermissionCodes;
  }

  if (role === "ADMIN" || role === "MANAGEMENT") {
    return ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS", "SUPERVISOR", "ADD_USERS"];
  }

  if (role.endsWith("_HEAD") || role.includes("MANAGER")) {
    return ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS", "SUPERVISOR"];
  }

  if (role === "VIEWER") {
    return [];
  }

  return role === "ACCOUNTS_EXECUTIVE" ? ["WORK_ON_LEADS"] : ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS"];
}

function withSessionAccessDefaults(session: DevSession): DevSession {
  return {
    ...session,
    postTitle: session.postTitle ?? defaultPostTitleForRole(session.role),
    roleTags: session.roleTags ?? defaultTagsForRole(session.role),
    permissions: session.permissions ?? defaultPermissionsForRole(session.role),
    authorityStage: session.authorityStage ?? defaultStageForRole(session.role),
  };
}

export function Ci4uBrainsApp() {
  const [session, setSession] = useState<DevSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [activeQueue, setActiveQueue] = useState<LeadQueue>("RAW");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rawLeads, setRawLeads] = useState<RawLeadListItem[]>([]);
  const [queueCounts, setQueueCounts] = useState<QueueCounts>(emptyQueueCounts);
  const [selectedLead, setSelectedLead] = useState<LeadDetail | null>(null);
  const [queueLoading, setQueueLoading] = useState<LeadQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workMessage, setWorkMessage] = useState<string | null>(null);
  const [failedSave, setFailedSave] = useState<FailedBackgroundSave | null>(null);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const leadDetailCache = useRef<Map<string, LeadDetail>>(new Map());
  const queueCache = useRef<Map<LeadQueue, RawLeadListItem[]>>(new Map());
  const queueRequestId = useRef(0);

  const loadCounts = useCallback(async (activeSession = session) => {
    if (!activeSession) {
      return;
    }

    try {
      setQueueCounts(await apiGet<QueueCounts>("/leads/counts", activeSession));
    } catch {
      setQueueCounts(emptyQueueCounts);
    }
  }, [session]);

  const loadNotifications = useCallback(async (activeSession = session) => {
    if (!activeSession || activeSession.authMode !== "supabase") {
      setNotifications([]);
      return;
    }

    try {
      setNotifications(await apiGet<NotificationSummary[]>("/auth/notifications", activeSession));
    } catch {
      setNotifications([]);
    }
  }, [session]);

  const refreshPendingSaveCount = useCallback(() => {
    setPendingSaveCount(readPendingBackgroundSaves().length);
  }, []);

  const prefetchLeadDetails = useCallback(async (leads: RawLeadListItem[], activeSession: DevSession, limit = 4) => {
    const candidates = leads.filter((leadItem) => !leadDetailCache.current.has(leadItem.id)).slice(0, limit);

    await Promise.allSettled(
      candidates.map(async (leadItem) => {
        const detail = await apiGet<LeadDetail>(`/leads/${leadItem.id}`, activeSession);
        leadDetailCache.current.set(leadItem.id, detail);
      }),
    );
  }, []);

  const loadQueue = useCallback(async (queue: LeadQueue, activeSession = session, options: QueueLoadOptions = {}) => {
    if (!activeSession) {
      return;
    }

    const requestId = queueRequestId.current + 1;
    queueRequestId.current = requestId;
    const cachedRows = queueCache.current.get(queue);

    setActiveQueue(queue);
    setQueueLoading(queue);
    setError(null);

    if (options.preferCache && cachedRows) {
      setRawLeads(cachedRows);
      void prefetchLeadDetails(cachedRows, activeSession);
    }

    try {
      const leads = await apiGet<RawLeadListItem[]>(`/leads/queue/${queue}`, activeSession);

      if (queueRequestId.current !== requestId) {
        return;
      }

      queueCache.current.set(queue, leads);
      setRawLeads(leads);
      void prefetchLeadDetails(leads, activeSession);

      if (options.refreshCounts !== false) {
        void loadCounts(activeSession);
      }
    } catch (loadError) {
      if (queueRequestId.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "Could not load leads.");
      }
    } finally {
      if (queueRequestId.current === requestId) {
        setQueueLoading(null);
      }
    }
  }, [loadCounts, prefetchLeadDetails, session]);

  const restoreSession = useCallback(async () => {
    const saved = window.localStorage.getItem(sessionStorageKey);

    if (!isProductionAuthEnabled()) {
      setSession(saved ? withSessionAccessDefaults(JSON.parse(saved) as DevSession) : null);
      setSessionReady(true);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      window.localStorage.removeItem(sessionStorageKey);
      setSession(null);
      setSessionReady(true);
      return;
    }

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      window.localStorage.removeItem(sessionStorageKey);
      setSession(null);
      setSessionReady(true);
      return;
    }

    const syncedSession = await syncProductionSession(accessToken);
    setSession(syncedSession);
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(syncedSession));
    setSessionReady(true);
    void loadQueue("RAW", syncedSession, { preferCache: true });
    void loadNotifications(syncedSession);
  }, [loadNotifications, loadQueue]);

  useEffect(() => {
    if (sessionReady) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void restoreSession();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [restoreSession, sessionReady]);

  useEffect(() => {
    function warnIfSaveIsPending(event: BeforeUnloadEvent) {
      if (!readPendingBackgroundSaves().length) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnIfSaveIsPending);
    return () => window.removeEventListener("beforeunload", warnIfSaveIsPending);
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    const pending = readPendingBackgroundSaves();
    const pendingCountTimer = window.setTimeout(() => setPendingSaveCount(pending.length), 0);
    const pendingTimer = pending.length
      ? window.setTimeout(() => {
          setFailedSave(pending[0] ?? null);
          setWorkMessage(`${pending.length} background save${pending.length === 1 ? "" : "s"} need confirmation. Retry them before closing the CRM.`);
        }, 0)
      : null;

    const timer = window.setTimeout(() => {
      void loadQueue("RAW", session, { preferCache: true });
      void loadNotifications(session);
    }, 0);

    return () => {
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
      }

      window.clearTimeout(pendingCountTimer);
      window.clearTimeout(timer);
    };
  }, [loadNotifications, loadQueue, session]);

  function prefetchAdjacentLeads(currentLeadId: string, queueSnapshot = rawLeads, activeSession = session) {
    if (!activeSession) {
      return;
    }

    const currentIndex = queueSnapshot.findIndex((leadItem) => leadItem.id === currentLeadId);
    const nearby = currentIndex >= 0 ? queueSnapshot.slice(currentIndex + 1, currentIndex + 4) : queueSnapshot.slice(0, 3);
    void prefetchLeadDetails(nearby, activeSession, 3);
  }

  function getNextLeadItem(queueSnapshot: RawLeadListItem[], currentLeadId: string): RawLeadListItem | null {
    const currentIndex = queueSnapshot.findIndex((leadItem) => leadItem.id === currentLeadId);

    if (currentIndex >= 0) {
      return queueSnapshot[currentIndex + 1] ?? queueSnapshot.find((leadItem) => leadItem.id !== currentLeadId) ?? null;
    }

    return queueSnapshot.find((leadItem) => leadItem.id !== currentLeadId) ?? null;
  }

  async function openLead(leadId: string) {
    if (!session) {
      return;
    }

    const cached = leadDetailCache.current.get(leadId);

    if (cached) {
      setSelectedLead(cached);
      setActiveView("lead-detail");
      prefetchAdjacentLeads(leadId);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const detail = await apiGet<LeadDetail>(`/leads/${leadId}`, session);
      leadDetailCache.current.set(leadId, detail);
      setSelectedLead(detail);
      setActiveView("lead-detail");
      prefetchAdjacentLeads(leadId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not open lead.");
    } finally {
      setLoading(false);
    }
  }

  function login(user: (typeof devUsers)[number]) {
    const nextSession: DevSession = withSessionAccessDefaults({
      userId: `dev-${user.role.toLowerCase()}`,
      name: user.name,
      role: user.role,
      dataScope: "development",
      authMode: "dev",
    });
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    void loadQueue("RAW", nextSession, { preferCache: true });
  }

  async function loginWithSupabase(email: string, password: string) {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      throw new Error("Production login is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    }

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError || !data.session?.access_token) {
      throw new Error(loginError?.message ?? "Could not sign in.");
    }

    const nextSession = await syncProductionSession(data.session.access_token);
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    void loadQueue("RAW", nextSession, { preferCache: true });
    void loadNotifications(nextSession);
  }

  async function syncProductionSession(accessToken: string): Promise<DevSession> {
    const temporarySession: DevSession = {
      userId: "auth-sync",
      name: "Authenticated User",
      role: "VIEWER",
      dataScope: "production",
      accessToken,
      authMode: "supabase",
    };
    const user = await apiGet<SessionUser>("/auth/me", temporarySession);

    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      postTitle: user.postTitle,
      roleTags: user.roleTags,
      permissions: user.permissions,
      authorityStage: user.authorityStage,
      dataScope: user.dataScope,
      email: user.email,
      accessToken,
      authMode: "supabase",
    };
  }

  async function logout() {
    if (session?.authMode === "supabase") {
      await getSupabaseBrowserClient()?.auth.signOut();
    }

    window.localStorage.removeItem(sessionStorageKey);
    setSession(null);
    setSessionReady(true);
    setRawLeads([]);
    setQueueCounts(emptyQueueCounts);
    setNotifications([]);
    setNotificationPanelOpen(false);
    setPasswordPanelOpen(false);
    setSelectedLead(null);
    setQueueLoading(null);
    setFailedSave(null);
    setPendingSaveCount(0);
    leadDetailCache.current.clear();
    queueCache.current.clear();
    setActiveView("dashboard");
  }

  function openQueue(queue: LeadQueue) {
    setActiveView("raw-leads");
    void loadQueue(queue, session, { preferCache: true });
  }

  async function markNotificationRead(notificationId: string) {
    if (!session) {
      return;
    }

    setNotifications((current) => current.map((item) => (item.id === notificationId ? { ...item, read: true } : item)));

    try {
      await apiPost<NotificationSummary>(`/auth/notifications/${notificationId}/read`, session, {});
    } catch {
      void loadNotifications(session);
    }
  }

  async function changeProductionPassword(newPassword: string) {
    if (session?.authMode !== "supabase") {
      throw new Error("Password changes are only available for production Supabase users.");
    }

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      throw new Error("Supabase Auth is not configured in this browser.");
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });

    if (passwordError) {
      throw new Error(passwordError.message);
    }
  }

  function handleLeadUpdateRequested(lead: LeadDetail, payload: SaveCallOutcomeInput) {
    if (!session) {
      return;
    }

    const queueBeforeSave = activeQueue;
    const queueSnapshot = [...rawLeads];
    const nextLead = getNextLeadItem(queueSnapshot, lead.id);
    setError(null);
    setFailedSave(null);
    setWorkMessage(`Saving ${lead.customerName}. Local handoff is done; waiting for server confirmation.`);
    rememberBackgroundSave({
      lead,
      payload,
      queue: queueBeforeSave,
      message: "This save is queued locally and waiting for server confirmation.",
    });
    refreshPendingSaveCount();
    removeLeadFromQueueCache(queueBeforeSave, lead.id);
    setRawLeads((current) => current.filter((leadItem) => leadItem.id !== lead.id));
    setQueueCounts((current) => ({
      ...current,
      [queueBeforeSave]: Math.max(0, (current[queueBeforeSave] ?? 0) - 1),
    }));

    if (nextLead) {
      const cached = leadDetailCache.current.get(nextLead.id);

      if (cached) {
        setSelectedLead(cached);
        setActiveView("lead-detail");
        prefetchAdjacentLeads(nextLead.id, queueSnapshot, session);
      } else {
        setLoading(true);
        setSelectedLead(null);
        setActiveView("lead-detail");
        void apiGet<LeadDetail>(`/leads/${nextLead.id}`, session)
          .then((detail) => {
            leadDetailCache.current.set(nextLead.id, detail);
            setSelectedLead(detail);
            prefetchAdjacentLeads(nextLead.id, queueSnapshot, session);
          })
          .catch((loadError) => {
            setSelectedLead(null);
            setActiveView("raw-leads");
            setError(loadError instanceof Error ? loadError.message : "Could not open the next lead.");
          })
          .finally(() => setLoading(false));
      }
    } else {
      setSelectedLead(null);
      setActiveView("raw-leads");
    }

    void saveLeadInBackground(lead, payload, queueBeforeSave);
  }

  async function saveLeadInBackground(lead: LeadDetail, payload: SaveCallOutcomeInput, queue: LeadQueue) {
    if (!session) {
      return;
    }

    try {
      const ack = await apiPost<LeadSaveAck>(`/leads/${lead.id}/call-outcome/ack`, session, payload);
      leadDetailCache.current.delete(ack.id);
      upsertLeadInQueueCache(queueForLeadListItem(ack), ack);
      forgetBackgroundSave(lead.id);
      refreshPendingSaveCount();
      const nextPending = readPendingBackgroundSaves()[0] ?? null;
      setFailedSave(nextPending);
      setWorkMessage(`${lead.customerName} saved as ${formatEnum(ack.currentStage)}. Server confirmed.`);
      void loadCounts(session);
      window.setTimeout(() => setWorkMessage(null), 2500);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Background save failed.";
      const failed = { lead, payload, queue, message };
      rememberBackgroundSave(failed);
      refreshPendingSaveCount();
      setFailedSave(failed);
      setError(`Background save failed for ${lead.customerName}: ${message}`);
      upsertLeadInQueueCache(queue, leadDetailToListItem(lead));
      setRawLeads((current) => (current.some((leadItem) => leadItem.id === lead.id) ? current : [leadDetailToListItem(lead), ...current]));
      void loadCounts(session);
    }
  }

  function removeLeadFromQueueCache(queue: LeadQueue, leadId: string) {
    const cached = queueCache.current.get(queue);

    if (!cached) {
      return;
    }

    queueCache.current.set(queue, cached.filter((leadItem) => leadItem.id !== leadId));
  }

  function upsertLeadInQueueCache(queue: LeadQueue, leadItem: RawLeadListItem) {
    const cached = queueCache.current.get(queue);

    if (!cached) {
      return;
    }

    queueCache.current.set(queue, [leadItem, ...cached.filter((item) => item.id !== leadItem.id)]);
  }

  function retryFailedSave() {
    if (!failedSave) {
      return;
    }

    setError(null);
    setWorkMessage(`Retrying background save for ${failedSave.lead.customerName}...`);
    const retry = failedSave;
    setFailedSave(null);
    void saveLeadInBackground(retry.lead, retry.payload, retry.queue);
  }

  function reopenFailedSaveLead() {
    if (!failedSave) {
      return;
    }

    setActiveQueue(failedSave.queue);
    setSelectedLead(failedSave.lead);
    setActiveView("lead-detail");
  }

  if (!sessionReady) {
    return <DevLoading />;
  }

  if (!session) {
    return <AccessLogin onDevLogin={login} onProductionLogin={loginWithSupabase} />;
  }

  return (
    <main className="min-h-screen bg-[#031023] text-white">
      <div className="flex min-h-screen">
        <aside className={`${sidebarOpen ? "fixed inset-y-0 left-0 z-40 block lg:static" : "hidden"} w-[318px] shrink-0 overflow-y-auto border-r border-white/10 bg-[#020b19] px-4 py-5`}>
          <BrandBlock />
          <DevScopeCard session={session} onLogout={logout} onOpenPasswordPanel={() => setPasswordPanelOpen(true)} />
          <nav className="mt-4 space-y-2">
            <NavButton active={activeView === "dashboard"} icon={LayoutDashboard} label="Dashboard" onClick={() => setActiveView("dashboard")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "RAW"} icon={UsersRound} label="Raw Leads" count={queueCounts.RAW} onClick={() => openQueue("RAW")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "WARM"} icon={CalendarClock} label="Warm Leads" count={queueCounts.WARM} onClick={() => openQueue("WARM")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "HOT_INSTALLATION"} icon={CalendarClock} label="Hot Installation" count={queueCounts.HOT_INSTALLATION} onClick={() => openQueue("HOT_INSTALLATION")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "HOT_REPAIR_SERVICE"} icon={CalendarClock} label="Repair / Service" count={queueCounts.HOT_REPAIR_SERVICE} onClick={() => openQueue("HOT_REPAIR_SERVICE")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "UNANSWERED"} icon={AlertTriangle} label="Unanswered" count={queueCounts.UNANSWERED} onClick={() => openQueue("UNANSWERED")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "GHOSTING"} icon={AlertTriangle} label="Ghosting Leads" count={queueCounts.GHOSTING} onClick={() => openQueue("GHOSTING")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "WON"} icon={CheckCircle2} label="Won Leads" count={queueCounts.WON} onClick={() => openQueue("WON")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "LOST"} icon={AlertTriangle} label="Lost Leads" count={queueCounts.LOST} onClick={() => openQueue("LOST")} />
            <NavButton active={activeView === "raw-leads" && activeQueue === "ARCHIVE"} icon={ArchiveRestore} label="Trash / Archive" count={queueCounts.ARCHIVE} onClick={() => openQueue("ARCHIVE")} />
            <NavButton active={activeView === "vendors"} icon={BriefcaseBusiness} label="Vendors" onClick={() => setActiveView("vendors")} />
            {canManageUsers(session) ? <NavButton active={activeView === "users"} icon={UserPlus} label="User Management" onClick={() => setActiveView("users")} /> : null}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_36%),#031023]">
          <TopBar
            session={session}
            rawCount={queueCounts.RAW}
            notifications={notifications}
            notificationPanelOpen={notificationPanelOpen}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((value) => !value)}
            onToggleNotifications={() => setNotificationPanelOpen((value) => !value)}
            onMarkNotificationRead={(notificationId) => void markNotificationRead(notificationId)}
            onOpenPasswordPanel={() => setPasswordPanelOpen(true)}
            onLogout={() => void logout()}
          />
          <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            {error ? <Notice tone="danger" title="Action blocked" message={error} /> : null}
            {passwordPanelOpen && session.authMode === "supabase" ? (
              <PasswordChangePanel onClose={() => setPasswordPanelOpen(false)} onChangePassword={changeProductionPassword} />
            ) : null}
            {failedSave ? <SaveFailureBanner failure={failedSave} onRetry={retryFailedSave} onReopen={reopenFailedSaveLead} /> : null}
            {!failedSave && pendingSaveCount > 0 ? <SavePendingBanner count={pendingSaveCount} /> : null}
            {workMessage ? <Notice tone="success" title="Workflow progress" message={workMessage} /> : null}
            {loading && activeView !== "raw-leads" ? <LoadingBar /> : null}
            {activeView === "dashboard" ? (
              <DashboardHome counts={queueCounts} onOpenQueue={openQueue} />
            ) : null}
            {activeView === "raw-leads" ? (
              <RawLeadsWorkspace
                session={session}
                activeQueue={activeQueue}
                rawLeads={rawLeads}
                queueLoading={queueLoading === activeQueue}
                onRefresh={() => loadQueue(activeQueue, session, { preferCache: true })}
                onLeadCreated={() => loadQueue("RAW", session, { preferCache: true })}
                onOpenLead={openLead}
              />
            ) : null}
            {activeView === "vendors" ? <VendorsWorkspace session={session} /> : null}
            {activeView === "users" ? <UserManagementWorkspace session={session} onUsersChanged={() => void loadNotifications(session)} /> : null}
            {activeView === "lead-detail" && selectedLead ? (
              <LeadDetailWorkspaceV2
                key={selectedLead.id}
                session={session}
                lead={selectedLead}
                onSaveRequested={handleLeadUpdateRequested}
                onLeadTransferred={(updatedLead) => {
                  leadDetailCache.current.set(updatedLead.id, updatedLead);
                  setSelectedLead(updatedLead);
                  void loadQueue(activeQueue, session, { preferCache: false, refreshCounts: true });
                  void loadNotifications(session);
                }}
                onBack={() => setActiveView("raw-leads")}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function DevLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#031023] px-4 text-white">
      <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-200">
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing CI4U Brains
      </div>
    </main>
  );
}

function AccessLogin({
  onDevLogin,
  onProductionLogin,
}: {
  onDevLogin: (user: (typeof devUsers)[number]) => void;
  onProductionLogin: (email: string, password: string) => Promise<void>;
}) {
  const productionMode = isProductionAuthEnabled();
  const [email, setEmail] = useState("syedci4u@gmail.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function submitProductionLogin() {
    setBusy(true);
    setError(null);
    setResetMessage(null);

    try {
      await onProductionLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setError("Production login is not configured. Set Supabase browser environment variables first.");
      return;
    }

    setBusy(true);
    setError(null);
    setResetMessage(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });

      if (resetError) {
        throw resetError;
      }

      setResetMessage("Password reset email sent. Open the email, complete Supabase verification, then return here.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  if (productionMode) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#031023] px-4 text-white">
        <section className="w-full max-w-xl rounded-md border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <div className="mb-6 flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-md border border-cyan-300/40 bg-cyan-300/10">
              <LockKeyhole className="h-6 w-6 text-cyan-200" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">CI4U Brains Login</h1>
              <p className="mt-1 text-sm text-slate-300">Production access uses Supabase Auth and CI4U role permissions.</p>
            </div>
          </div>
          {error ? <Notice tone="danger" title="Login blocked" message={error} /> : null}
          {resetMessage ? <Notice tone="success" title="Reset email sent" message={resetMessage} /> : null}
          <div className="grid gap-4">
            <Field label="Email">
              <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field label="Password">
              <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitProductionLogin();
                }
              }} />
            </Field>
            <button className="primary-button w-full" type="button" disabled={busy || !email.trim() || !password} onClick={() => void submitProductionLogin()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Login
            </button>
            <button className="secondary-button w-full" type="button" disabled={busy || !email.trim()} onClick={() => void sendPasswordReset()}>
              Send password reset email
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#031023] px-4 text-white">
      <section className="w-full max-w-4xl rounded-md border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
        <div className="mb-6 flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-md border border-cyan-300/40 bg-cyan-300/10">
            <LockKeyhole className="h-6 w-6 text-cyan-200" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">CI4U Brains Dev Login</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              This is a development-only access layer. It sends `x-ci4u-data-scope=development` to the API so test leads cannot be confused with production data.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {devUsers.map((user) => (
            <button
              key={user.role}
              className="rounded-md border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
              onClick={() => onDevLogin(user)}
            >
              <div className="font-semibold">{user.name}</div>
              <div className="mt-1 text-sm text-cyan-200">{user.role.replaceAll("_", " ")}</div>
              <div className="mt-3 text-sm text-slate-300">{user.label}</div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function PasswordChangePanel({
  onClose,
  onChangePassword,
}: {
  onClose: () => void;
  onChangePassword: (newPassword: string) => Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; title: string; message: string } | null>(null);
  const canSubmit = newPassword.length >= 8 && newPassword === confirmPassword;

  async function submitPasswordChange() {
    if (!canSubmit) {
      setMessage({
        tone: "danger",
        title: "Password blocked",
        message: "Use at least 8 characters and make sure both password fields match.",
      });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      await onChangePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setMessage({
        tone: "success",
        title: "Password changed",
        message: "Your Supabase Auth password has been updated. Use the new password next time you log in.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        title: "Password not changed",
        message: error instanceof Error ? error.message : "Could not update password.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-cyan-300/25 bg-[#071a33] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Change Production Password</h2>
          <p className="mt-1 text-sm text-slate-300">This updates your Supabase Auth password only. CI4U does not store staff passwords.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          <X className="h-4 w-4" />
          Close
        </button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="New Password">
          <input className="field" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </Field>
        <Field label="Confirm New Password">
          <input
            className="field"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submitPasswordChange();
              }
            }}
          />
        </Field>
      </div>
      {message ? <Notice tone={message.tone} title={message.title} message={message.message} /> : null}
      <button className="primary-button mt-4" type="button" disabled={busy || !canSubmit} onClick={() => void submitPasswordChange()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
        Update Password
      </button>
    </section>
  );
}

function BrandBlock() {
  return (
    <div className="flex items-center gap-3 px-2 pb-5">
      <div className="grid h-12 w-12 place-items-center rounded-md border border-sky-300/50 bg-sky-300/10 text-lg font-black text-sky-100">
        C4
      </div>
      <div>
        <div className="text-3xl font-bold">CI4U</div>
        <div className="text-sm font-semibold text-slate-300">Brains Control OS</div>
      </div>
    </div>
  );
}

function DevScopeCard({
  session,
  onLogout,
  onOpenPasswordPanel,
}: {
  session: DevSession;
  onLogout: () => void;
  onOpenPasswordPanel: () => void;
}) {
  return (
    <section className="rounded-md border border-cyan-300/20 bg-cyan-300/10 p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-950">
          <UserRound className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{session.name}</div>
          <div className="text-xs font-semibold uppercase text-cyan-200">{session.role.replaceAll("_", " ")}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {session.postTitle ? <span className="rounded border border-cyan-300/20 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">{session.postTitle}</span> : null}
            {(session.roleTags ?? []).map((tag) => (
              <span key={tag} className="rounded border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-200">
                {tag.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-md border border-cyan-300/20 bg-black/20 px-3 py-2 text-xs text-cyan-100">
        {session.authMode === "supabase" ? "PRODUCTION ACCESS" : "DEV DATA ONLY"}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
        {session.authMode === "supabase" ? (
          <button className="text-cyan-100 hover:text-white" type="button" onClick={onOpenPasswordPanel}>
            Change password
          </button>
        ) : null}
        <button className="text-slate-200 hover:text-white" type="button" onClick={onLogout}>
          {session.authMode === "supabase" ? "Logout" : "Switch dev user"}
        </button>
      </div>
    </section>
  );
}

function NavButton({
  active,
  disabled,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      className={`grid w-full grid-cols-[24px_1fr_auto] items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-semibold ${
        active ? "bg-blue-600 text-white" : disabled ? "text-slate-500" : "text-slate-200 hover:bg-white/5"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
      {typeof count === "number" ? <span className="rounded-md bg-white/10 px-2 py-1 text-xs">{count}</span> : null}
    </button>
  );
}

function TopBar({
  session,
  rawCount,
  notifications,
  notificationPanelOpen,
  sidebarOpen,
  onToggleSidebar,
  onToggleNotifications,
  onMarkNotificationRead,
  onOpenPasswordPanel,
  onLogout,
}: {
  session: DevSession;
  rawCount: number;
  notifications: NotificationSummary[];
  notificationPanelOpen: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onToggleNotifications: () => void;
  onMarkNotificationRead: (notificationId: string) => void;
  onOpenPasswordPanel: () => void;
  onLogout: () => void;
}) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#031023]/92 backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-[1540px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <button className="grid h-11 w-11 place-items-center rounded-md border border-white/10 bg-white/5" onClick={onToggleSidebar} title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Operations Command</h1>
            <span className="rounded-md border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-xs font-semibold uppercase text-cyan-200">
              {session.authMode === "supabase" ? "Production workspace" : "Development workspace"}
            </span>
          </div>
          <p className="text-sm text-slate-300">
            {session.authMode === "supabase" ? `${session.name} is working on production data.` : `${session.name} is testing with isolated dev data.`} Raw leads: {rawCount}
          </p>
        </div>
        <div className="ml-auto hidden min-w-[240px] max-w-md flex-1 items-center gap-3 rounded-md border border-white/10 bg-white/5 px-4 py-3 md:flex">
          <Search className="h-5 w-5 shrink-0 text-slate-300" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
            placeholder="Search leads, customers, vendors..."
            type="search"
          />
        </div>
        <div className="relative">
          <button className="relative grid h-11 w-11 place-items-center rounded-md border border-white/10 bg-white/5" type="button" onClick={onToggleNotifications}>
            <Bell className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold">
              {unreadCount}
            </span>
          </button>
          {notificationPanelOpen ? (
            <div className="absolute right-0 top-14 z-30 w-[360px] rounded-md border border-white/10 bg-[#071a33] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="font-semibold">Notifications</div>
                <span className="text-xs text-cyan-200">{unreadCount} unread</span>
              </div>
              <div className="smooth-scroll max-h-96 space-y-2 overflow-auto">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      notification.read ? "border-white/10 bg-white/[0.03] text-slate-300" : "border-cyan-300/25 bg-cyan-300/10 text-white"
                    }`}
                    type="button"
                    onClick={() => onMarkNotificationRead(notification.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{notification.title}</span>
                      <span className="text-[11px] uppercase text-cyan-200">{notification.priority}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{notification.message}</p>
                    <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(notification.createdAt)}</div>
                  </button>
                ))}
                {!notifications.length ? <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-sm text-slate-400">No notifications yet.</div> : null}
              </div>
            </div>
          ) : null}
        </div>
        {session.authMode === "supabase" ? (
          <button className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 sm:block" type="button" onClick={onOpenPasswordPanel}>
            Change password
          </button>
        ) : null}
        <button className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}

function DashboardHome({ counts, onOpenQueue }: { counts: QueueCounts; onOpenQueue: (queue: LeadQueue) => void }) {
  return (
    <>
      <section className="rounded-md border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Today&apos;s Command Queue</h2>
            <p className="mt-1 text-sm text-slate-300">Start from Raw Leads. This is where every customer journey begins.</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold" onClick={() => onOpenQueue("RAW")}>
            <UsersRound className="h-4 w-4" />
            Open Raw Leads
          </button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-8">
          <Metric label="Raw Leads" value={counts.RAW} helper="Fresh unworked leads" />
          <Metric label="Warm" value={counts.WARM} helper="Nurture follow-ups" />
          <Metric label="Installation" value={counts.HOT_INSTALLATION} helper="Hot installation" />
          <Metric label="Repair/Service" value={counts.HOT_REPAIR_SERVICE} helper="Hot service" />
          <Metric label="Unanswered" value={counts.UNANSWERED} helper="NR follow-up ladder" />
          <Metric label="Won" value={counts.WON} helper="Captured for now" />
          <Metric label="Lost" value={counts.LOST} helper="Lost, still searchable" />
          <Metric label="Archive" value={counts.ARCHIVE} helper="NI, WN, NR final" />
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-5">
      <div className="text-sm text-slate-300">{label}</div>
      <div className="mt-2 text-4xl font-semibold">{value}</div>
      <div className="mt-2 text-sm text-cyan-200">{helper}</div>
    </div>
  );
}

function RawLeadsWorkspace({
  session,
  activeQueue,
  rawLeads,
  queueLoading,
  onRefresh,
  onLeadCreated,
  onOpenLead,
}: {
  session: DevSession;
  activeQueue: LeadQueue;
  rawLeads: RawLeadListItem[];
  queueLoading: boolean;
  onRefresh: () => void;
  onLeadCreated: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualResult, setManualResult] = useState<CreateLeadResponse | null>(null);
  const [importRows, setImportRows] = useState<ImportRowInput[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createManualLead() {
    setBusy(true);
    setWorkStatus("Saving manual raw lead and checking phone duplicates...");
    setManualResult(null);

    try {
      const result = await apiPost<CreateLeadResponse>("/leads/manual", session, {
        businessName: manualName,
        phone: manualPhone,
        source: "MANUAL",
      });
      setManualResult(result);

      if (result.outcome === "created") {
        setManualName("");
        setManualPhone("");
        onLeadCreated();
      }
    } catch (error) {
      setManualResult({
        outcome: "duplicate",
        duplicate: {
          phoneNormalized: "-",
          customerId: "-",
          customerName: "Could not save",
          currentLeadId: null,
          currentStage: error instanceof Error ? error.message : "Validation failed",
          isActive: false,
          isArchived: false,
          assignedToName: null,
          nextFollowUpAt: null,
          lastActivitySummary: null,
          totalJobs: 0,
        },
        suggestedActions: [],
      });
    } finally {
      setBusy(false);
      setWorkStatus(null);
    }
  }

  async function handleFile(file: File | null) {
    setImportPreview(null);
    setImportRows([]);

    if (!file) {
      return;
    }

    setBusy(true);
    setWorkStatus(`Reading ${file.name}...`);
    setFileMessage("Reading file. Do not reload this page.");

    try {
      const parsedRows = file.name.toLowerCase().endsWith(".xlsx") ? await parseXlsx(file) : await parseCsv(file);
      const mapped = mapRowsToLeadInputs(parsedRows);
      setImportRows(mapped);
      setFileMessage(`${file.name}: ${mapped.length} rows detected after header and blank-row cleanup. Next step: Preview Import.`);
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setBusy(false);
      setWorkStatus(null);
    }
  }

  async function previewImport() {
    setBusy(true);
    setWorkStatus("Checking every phone number against active, won, lost, and archived records...");

    try {
      setImportPreview(await apiPost<ImportPreviewResult>("/leads/import/preview", session, { rows: importRows }));
      setFileMessage("Preview ready. Only New rows can be committed; duplicates stay blocked.");
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : "Import preview failed.");
    } finally {
      setBusy(false);
      setWorkStatus(null);
    }
  }

  async function commitImport() {
    setBusy(true);
    setWorkStatus("Committing valid rows as Raw Leads. Please do not reload.");

    try {
      const result = await apiPost<ImportCommitResult>("/leads/import/commit", session, { rows: importRows, source: "FILE_IMPORT" });
      setImportPreview(null);
      setImportRows([]);
      setFileMessage(`Import committed: ${result.summary.createdRows} created, ${result.summary.skippedRows} skipped from ${result.summary.requestedRows} checked rows.`);
      onLeadCreated();
    } catch (error) {
      setFileMessage(error instanceof Error ? error.message : "Import commit failed.");
    } finally {
      setBusy(false);
      setWorkStatus(null);
    }
  }

  return (
    <section className={`grid gap-5 ${activeQueue === "RAW" ? "xl:grid-cols-[420px_1fr]" : ""}`}>
      {activeQueue === "RAW" ? (
        <div className="space-y-5">
          <Panel title="Manual Raw Lead">
            <div className="space-y-3">
              <Field label="Customer / Business Name">
                <input className="field" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="ABC Enterprises" />
              </Field>
              <Field label="Phone Number">
                <input className="field" value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} placeholder="98765 43210" />
              </Field>
              <button className="primary-button w-full" disabled={busy} onClick={createManualLead}>
                <Plus className="h-4 w-4" />
                Create Raw Lead
              </button>
            </div>
            {manualResult ? <ManualResult result={manualResult} /> : null}
          </Panel>

          <Panel title="CSV / XLSX Import">
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-md border border-dashed border-cyan-300/30 bg-cyan-300/5 px-4 py-6 text-center text-sm text-cyan-100">
                <Upload className="h-5 w-5" />
                <span>Choose CSV or XLSX file</span>
                <input className="hidden" accept=".csv,.xlsx" type="file" onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} />
              </label>
              {workStatus ? <InlineProgress message={workStatus} /> : null}
              {fileMessage ? <p className="text-sm text-slate-300">{fileMessage}</p> : null}
              <button className="secondary-button w-full" disabled={!importRows.length || busy} onClick={previewImport}>
                <FileSpreadsheet className="h-4 w-4" />
                Preview Import
              </button>
              <button className="primary-button w-full" disabled={!importPreview?.summary.newRows || busy} onClick={commitImport}>
                <CheckCircle2 className="h-4 w-4" />
                Commit Valid Rows
              </button>
            </div>
          </Panel>
        </div>
      ) : null}

      <div className="space-y-5">
        {importPreview ? <ImportPreview preview={importPreview} /> : null}
        <Panel
          title={queueTitle(activeQueue)}
          action={
            <div className="flex flex-wrap items-center gap-3">
              {queueLoading ? <span className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Syncing</span> : null}
              <button className="secondary-button" disabled={queueLoading} onClick={onRefresh}>
                <RefreshCw className={`h-4 w-4 ${queueLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          }
        >
          <div className="smooth-scroll max-h-[min(72vh,760px)] overflow-auto rounded-md border border-white/10">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#08162c] text-xs uppercase text-slate-400 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Last History</th>
                  <th className="px-4 py-3">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {queueLoading && !rawLeads.length ? <QueueSkeletonRows /> : null}
                {rawLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold">{lead.customerName}</td>
                    <td className="px-4 py-3 text-cyan-100">{lead.phoneNormalized}</td>
                    <td className="px-4 py-3">{lead.source}</td>
                    <td className="px-4 py-3">{formatEnum(lead.currentStage)}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-300">{lead.lastActivitySummary ?? "-"}</td>
                    <td className="px-4 py-3">
                      <button className="inline-flex items-center gap-1 text-sm font-semibold text-blue-300" onClick={() => onOpenLead(lead.id)}>
                        Open <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!rawLeads.length && !queueLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                      {activeQueue === "RAW" ? "No raw leads yet. Add manually or import your CSV/XLSX file." : `No records in ${queueTitle(activeQueue)} yet.`}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  );
}

function ManualResult({ result }: { result: CreateLeadResponse }) {
  if (result.outcome === "created") {
    return <Notice tone="success" title="Raw lead created" message="The customer is now in Raw Leads and ready for the first call." />;
  }

  return (
    <Notice
      tone="warning"
      title="Existing phone found"
      message={`${result.duplicate.customerName} already exists at stage ${formatEnum(result.duplicate.currentStage)}. Do not create duplicate records.`}
    />
  );
}

function QueueSkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <tr key={index}>
          {Array.from({ length: 6 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-3">
              <div className="h-4 w-full max-w-[180px] animate-pulse rounded bg-white/10" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SaveFailureBanner({
  failure,
  onRetry,
  onReopen,
}: {
  failure: FailedBackgroundSave;
  onRetry: () => void;
  onReopen: () => void;
}) {
  return (
    <section className="rounded-md border border-red-300/30 bg-red-500/10 p-4 text-red-50">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-semibold">Background save failed for {failure.lead.customerName}</div>
          <p className="mt-1 text-sm opacity-90">{failure.message}</p>
          <p className="mt-1 text-sm opacity-80">The lead was returned to the working queue. Retry or reopen it before continuing that customer.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className="secondary-button" type="button" onClick={onRetry}>Retry Save</button>
          <button className="secondary-button" type="button" onClick={onReopen}>Reopen Lead</button>
        </div>
      </div>
    </section>
  );
}

function SavePendingBanner({ count }: { count: number }) {
  return (
    <section className="rounded-md border border-cyan-300/25 bg-cyan-400/10 p-4 text-cyan-50 shadow-[0_16px_48px_rgba(8,145,178,0.12)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">Server confirmation pending</div>
            <p className="mt-1 text-sm text-cyan-100/90">
              {count} lead save{count === 1 ? "" : "s"} are protected locally and waiting for the backend ACK. Do not close this CRM until the confirmation message appears.
            </p>
            <p className="mt-1 text-xs text-cyan-100/70">The browser will warn before closing while a save is pending.</p>
          </div>
        </div>
        <div className="rounded-md border border-cyan-200/20 bg-[#031023]/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
          Durable Save
        </div>
      </div>
    </section>
  );
}

function ImportPreview({ preview }: { preview: ImportPreviewResult }) {
  return (
    <Panel title="Import Preview">
      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="New" value={preview.summary.newRows} helper="Safe to import" />
        <Metric label="Duplicates" value={preview.summary.duplicateRows} helper="Blocked" />
        <Metric label="Invalid Phone" value={preview.summary.invalidPhoneRows} helper="Fix required" />
        <Metric label="Missing Name" value={preview.summary.missingNameRows} helper="Fix required" />
        <Metric label="File Dupes" value={preview.summary.duplicateInFileRows} helper="Skipped" />
      </div>
      <div className="mt-4 max-h-80 overflow-auto rounded-md border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 bg-[#08162c] text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {preview.rows.map((row) => (
              <tr key={row.rowNumber}>
                <td className="px-3 py-2">{row.rowNumber}</td>
                <td className="px-3 py-2">{row.businessName ?? "-"}</td>
                <td className="px-3 py-2">{row.normalizedPhone ?? row.rawPhone ?? "-"}</td>
                <td className="px-3 py-2">{formatEnum(row.status)}</td>
                <td className="px-3 py-2 text-slate-300">{row.reason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const staffRoleOptions: Array<{ value: DevRole; label: string }> = [
  { value: "FOUNDER", label: "Founder" },
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGEMENT", label: "Management" },
  { value: "SALES_HEAD", label: "Sales Head" },
  { value: "SALES_MANAGER", label: "Sales Manager" },
  { value: "SALES_EXECUTIVE", label: "Sales Executive" },
  { value: "OPERATIONS_HEAD", label: "Operations Head" },
  { value: "OPERATIONS_MANAGER", label: "Operations Manager" },
  { value: "OPERATIONS_EXECUTIVE", label: "Operations Executive" },
  { value: "VENDOR_MANAGER", label: "Vendor Manager" },
  { value: "ACCOUNTS_EXECUTIVE", label: "Accounts Executive" },
  { value: "SUPPORT_STAFF", label: "Support Staff" },
  { value: "VIEWER", label: "Viewer" },
];

function UserManagementWorkspace({ session, onUsersChanged }: { session: DevSession; onUsersChanged: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [accessOptions, setAccessOptions] = useState<AccessOptions | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DevRole>("SALES_EXECUTIVE");
  const [postTitle, setPostTitle] = useState(defaultPostTitleForRole("SALES_EXECUTIVE"));
  const [roleTagsText, setRoleTagsText] = useState(defaultTagsForRole("SALES_EXECUTIVE").join(", "));
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionCode[]>(defaultPermissionsForRole("SALES_EXECUTIVE"));
  const [authorityStage, setAuthorityStage] = useState(String(defaultStageForRole("SALES_EXECUTIVE")));
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [loadingMetricsUserId, setLoadingMetricsUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; message: string } | null>(null);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setMessage(null);

    try {
      const [loadedUsers, loadedOptions] = await Promise.all([apiGet<ManagedUser[]>("/auth/users", session), apiGet<AccessOptions>("/auth/access-options", session)]);
      setUsers(loadedUsers);
      setAccessOptions(loadedOptions);
    } catch (error) {
      setMessage({ tone: "danger", title: "Users blocked", message: error instanceof Error ? error.message : "Could not load users." });
    } finally {
      setLoadingUsers(false);
    }
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const roleOptions =
    accessOptions?.roles ??
    staffRoleOptions.map((option) => ({
      value: option.value,
      label: option.label,
      defaultPostTitle: defaultPostTitleForRole(option.value),
      defaultRoleTags: defaultTagsForRole(option.value),
      defaultAuthorityStage: defaultStageForRole(option.value),
      defaultPermissions: defaultPermissionsForRole(option.value),
    }));
  const permissionOptions = accessOptions?.permissions ?? allPermissionCodes.map((value) => ({ value, label: formatEnum(value) }));
  const canDeactivateUsers = hasPermission(session, "DELETE_USERS");
  const canViewMetrics = hasPermission(session, "SUPERVISOR");
  const sessionAuthorityStage = session.authorityStage ?? defaultStageForRole(session.role);

  function changeRole(nextRole: DevRole) {
    setRole(nextRole);
    const option = roleOptions.find((entry) => entry.value === nextRole);
    setPostTitle(option?.defaultPostTitle ?? defaultPostTitleForRole(nextRole));
    setRoleTagsText((option?.defaultRoleTags ?? defaultTagsForRole(nextRole)).join(", "));
    setSelectedPermissions(option?.defaultPermissions ?? defaultPermissionsForRole(nextRole));
    setAuthorityStage(String(option?.defaultAuthorityStage ?? defaultStageForRole(nextRole)));
  }

  function togglePermission(permission: PermissionCode) {
    setSelectedPermissions((current) =>
      current.includes(permission) ? current.filter((entry) => entry !== permission) : [...current, permission],
    );
  }

  async function addUser() {
    setSavingUser(true);
    setMessage(null);

    const payload: CreateManagedUserInput = {
      name,
      email,
      role,
      postTitle,
      roleTags: roleTagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      permissions: selectedPermissions,
      authorityStage: Number(authorityStage || defaultStageForRole(role)),
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };

    try {
      const saved = await apiPost<ManagedUser>("/auth/users", session, payload);
      setUsers((current) => [saved, ...current.filter((user) => user.id !== saved.id)]);
      setName("");
      setEmail("");
      setTemporaryPassword("");
      changeRole("SALES_EXECUTIVE");
      onUsersChanged();
      setMessage({
        tone: saved.authProvisioning === "LOCAL_ONLY" ? "warning" : "success",
        title: "User access saved",
        message:
          saved.authProvisioning === "LOCAL_ONLY"
            ? "User was saved in CI4U only. Invite email was not sent because CI4U_SUPABASE_SERVICE_ROLE_KEY is missing on the API server."
            : saved.authProvisioning === "SUPABASE_INVITED"
              ? `Invite email sent to ${saved.email}.`
              : `${saved.email} can use CI4U as ${formatEnum(saved.role)}.`,
      });
    } catch (error) {
      setMessage({ tone: "danger", title: "User not saved", message: error instanceof Error ? error.message : "Could not save user." });
    } finally {
      setSavingUser(false);
    }
  }

  async function deactivateUser(user: ManagedUser) {
    setDeletingUserId(user.id);
    setMessage(null);

    try {
      const updated = await apiDelete<ManagedUser>(`/auth/users/${user.id}`, session);
      setUsers((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setMessage({ tone: "success", title: "User deactivated", message: `${user.name} can no longer access CI4U.` });
      onUsersChanged();
    } catch (error) {
      setMessage({ tone: "danger", title: "User not deactivated", message: error instanceof Error ? error.message : "Could not deactivate user." });
    } finally {
      setDeletingUserId(null);
    }
  }

  async function openMetrics(user: ManagedUser) {
    setLoadingMetricsUserId(user.id);
    setMessage(null);

    try {
      setMetrics(await apiGet<UserMetrics>(`/auth/users/${user.id}/metrics`, session));
    } catch (error) {
      setMessage({ tone: "danger", title: "Metrics blocked", message: error instanceof Error ? error.message : "Could not load staff metrics." });
    } finally {
      setLoadingMetricsUserId(null);
    }
  }

  return (
    <Panel
      title="User Management"
      action={
        <button className="secondary-button" type="button" disabled={loadingUsers} onClick={() => void loadUsers()}>
          <RefreshCw className={`h-4 w-4 ${loadingUsers ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      <Notice
        tone="warning"
        title="Production access control"
        message="Only create real staff accounts here. CI4U database permissions and authority stage control what the API will allow; Supabase metadata is not the source of truth."
      />
      {message ? <Notice tone={message.tone} title={message.title} message={message.message} /> : null}
      {metrics ? (
        <section className="mb-4 rounded-md border border-cyan-300/20 bg-cyan-400/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{metrics.userName} work metrics</h3>
              <p className="mt-1 text-sm text-cyan-100">
                {metrics.postTitle ?? formatEnum(metrics.role)} · Stage {metrics.authorityStage}
              </p>
            </div>
            <button className="icon-button" type="button" onClick={() => setMetrics(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Leads added", metrics.leadsAdded],
              ["Interacted", metrics.leadsInteracted],
              ["Warm", metrics.warmLeads],
              ["Hot", metrics.hotLeads],
              ["Won", metrics.wonLeads],
              ["Assisted hot", metrics.leadsAssistedHot],
              ["Assisted won", metrics.leadsAssistedWon],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-white/10 bg-black/20 p-3">
                <div className="text-xs uppercase text-slate-400">{label}</div>
                <div className="mt-1 text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-4 flex items-start gap-3">
          <UserPlus className="mt-0.5 h-5 w-5 text-cyan-200" />
          <div>
            <h3 className="font-semibold">Add Staff ID</h3>
            <p className="mt-1 text-sm text-slate-300">Leave password empty to send a Supabase invite email when the API service-role key is configured.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Staff Name">
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Email ID">
            <input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Post / Role">
            <select className="field" value={role} onChange={(event) => changeRole(event.target.value as DevRole)}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Post Title">
            <input className="field" value={postTitle} onChange={(event) => setPostTitle(event.target.value)} placeholder="BDM, Sales Executive, CTO..." />
          </Field>
          <Field label="Role Tags">
            <input className="field" value={roleTagsText} onChange={(event) => setRoleTagsText(event.target.value)} placeholder="BDM, CTO" />
          </Field>
          <Field label="Authority Stage">
            <input className="field" type="number" min={1} max={100} value={authorityStage} onChange={(event) => setAuthorityStage(event.target.value)} />
          </Field>
          <Field label="Temporary Password">
            <input className="field" type="password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="Min 8 chars, optional" />
          </Field>
        </div>
        <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
          <div className="text-xs font-semibold uppercase text-slate-400">Permission checklist</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {permissionOptions.map((permission) => (
              <label key={permission.value} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(permission.value)}
                  onChange={() => togglePermission(permission.value)}
                />
                <span>{permission.label}</span>
              </label>
            ))}
          </div>
        </div>
        <button className="primary-button mt-4" type="button" disabled={savingUser || !name.trim() || !email.trim()} onClick={() => void addUser()}>
          {savingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Add User
        </button>
      </section>

      <section className="mt-5 rounded-md border border-white/10 bg-white/[0.03] p-4">
        <h3 className="font-semibold">Staff Accounts</h3>
        <div className="smooth-scroll mt-4 overflow-auto rounded-md border border-white/10">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/[0.03] text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provisioning</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((user) => {
                const canActOnStage = user.authorityStage <= sessionAuthorityStage;
                const canInspectUser = canViewMetrics && (user.id === session.userId || canActOnStage);
                const canDeactivateUser = canDeactivateUsers && user.id !== session.userId && canActOnStage && user.status !== "DEACTIVATED";

                return (
                  <tr key={user.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{user.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {user.postTitle ? <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">{user.postTitle}</span> : null}
                        {user.roleTags.map((tag) => (
                          <span key={tag} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-200">
                            {tag.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{user.email ?? "-"}</td>
                    <td className="px-4 py-3 text-cyan-200">{formatEnum(user.role)}</td>
                    <td className="px-4 py-3">{user.authorityStage}</td>
                    <td className="max-w-[280px] px-4 py-3 text-xs text-slate-300">{user.permissions.map(formatEnum).join(", ") || "-"}</td>
                    <td className="px-4 py-3">{formatEnum(user.status)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatEnum(user.authProvisioning)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canInspectUser ? (
                          <button className="secondary-button py-1 text-xs" type="button" disabled={loadingMetricsUserId === user.id} onClick={() => void openMetrics(user)}>
                            {loadingMetricsUserId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <InfoIcon className="h-3.5 w-3.5" />}
                            Metrics
                          </button>
                        ) : null}
                        {canDeactivateUser ? (
                          <button className="secondary-button py-1 text-xs text-red-100" type="button" disabled={deletingUserId === user.id} onClick={() => void deactivateUser(user)}>
                            {deletingUserId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Deactivate
                          </button>
                        ) : null}
                        {!canInspectUser && !canDeactivateUser ? <span className="text-xs text-slate-500">Above your authority</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!users.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                    No staff users found yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </Panel>
  );
}

function VendorsWorkspace({ session }: { session: DevSession }) {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [form, setForm] = useState<CreateVendorInput>(() => emptyVendorForm());
  const [skillText, setSkillText] = useState("");
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; message: string } | null>(null);

  const loadVendors = useCallback(async () => {
    setLoadingVendors(true);

    try {
      setVendors(await apiGet<VendorSummary[]>("/operations/vendors", session));
    } catch (error) {
      setMessage({ tone: "danger", title: "Vendor list blocked", message: error instanceof Error ? error.message : "Could not load vendors." });
    } finally {
      setLoadingVendors(false);
    }
  }, [session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadVendors();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadVendors]);

  function updateForm(patch: Partial<CreateVendorInput>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function changeTeamType(teamType: "INDIVIDUAL" | "TEAM") {
    setForm((current) =>
      teamType === "TEAM"
        ? {
            ...current,
            teamType,
            teamSize: Math.max(2, current.teamSize ?? 2),
            teamMembers: resizeTeamMembers(current.teamMembers ?? [], Math.max(2, current.teamSize ?? 2)),
          }
        : { ...current, teamType, teamSize: 1, teamMembers: [] },
    );
  }

  function changeTeamSize(value: string) {
    const teamSize = Math.max(2, Number(value || 2));
    setForm((current) => ({
      ...current,
      teamSize,
      teamMembers: resizeTeamMembers(current.teamMembers ?? [], teamSize),
    }));
  }

  function updateTeamMember(index: number, patch: Partial<VendorTeamMemberInput>) {
    setForm((current) => {
      const members = resizeTeamMembers(current.teamMembers ?? [], current.teamSize ?? 2).map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member,
      );
      return { ...current, teamMembers: members };
    });
  }

  async function submitVendor() {
    setSavingVendor(true);
    setMessage(null);

    try {
      const created = await apiPost<VendorSummary>("/operations/vendors", session, {
        ...form,
        skills: skillText
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        teamSize: form.teamType === "TEAM" ? form.teamSize : 1,
        teamMembers: form.teamType === "TEAM" ? form.teamMembers : [],
      });
      setVendors((current) => [created, ...current.filter((vendor) => vendor.id !== created.id)]);
      setForm(emptyVendorForm());
      setSkillText("");
      setMessage({ tone: "success", title: "Vendor added", message: `${created.vendorName} was added with Vendor ID ${created.vendorCode}. KYC is pending verification.` });
    } catch (error) {
      setMessage({ tone: "danger", title: "Vendor save blocked", message: error instanceof Error ? error.message : "Could not save vendor." });
    } finally {
      setSavingVendor(false);
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[460px_1fr]">
      <Panel title="Manual Vendor Add">
        <Notice
          tone="warning"
          title="KYC storage warning"
          message="Local MVP stores document names and signature preview only. Production must upload Aadhaar/selfie/signature to protected object storage with signed access and audit logs."
        />

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field label="Vendor Name">
            <input className="field" value={form.vendorName} onChange={(event) => updateForm({ vendorName: event.target.value })} placeholder="Technician / partner name" />
          </Field>
          <Field label="Phone Number">
            <input className="field" value={form.phone} onChange={(event) => updateForm({ phone: event.target.value })} placeholder="98765 43210" />
          </Field>
          <Field label="Date of Birth">
            <input className="field" type="date" value={form.dateOfBirth} onChange={(event) => updateForm({ dateOfBirth: event.target.value })} />
          </Field>
          <Field label="Experience Years">
            <input className="field" type="number" min="0" value={form.experienceYears} onChange={(event) => updateForm({ experienceYears: Number(event.target.value || 0) })} />
          </Field>
          <Field label="Pincode">
            <input className="field" value={form.pincode} onChange={(event) => updateForm({ pincode: event.target.value.replace(/\D/g, "").slice(0, 6) })} />
          </Field>
          <Field label="Skills">
            <input className="field" value={skillText} onChange={(event) => setSkillText(event.target.value)} placeholder="CCTV, DVR, Networking" />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Working Address">
            <textarea className="field min-h-24" value={form.workingAddress} onChange={(event) => updateForm({ workingAddress: event.target.value })} />
          </Field>
          <Field label="Full Address">
            <textarea className="field min-h-24" value={form.address} onChange={(event) => updateForm({ address: event.target.value })} />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FileNamePicker label="Aadhaar Card" value={form.aadhaarDocumentName} onChange={(value) => updateForm({ aadhaarDocumentName: value })} />
          <FileNamePicker label="Selfie" value={form.selfieDocumentName} onChange={(value) => updateForm({ selfieDocumentName: value })} />
        </div>

        <div className="mt-4">
          <Field label="Signature Pad">
            <SignaturePad value={form.signatureReference} onChange={(signatureReference) => updateForm({ signatureReference })} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Vendor Type">
            <select className="field" value={form.teamType} onChange={(event) => changeTeamType(event.target.value as "INDIVIDUAL" | "TEAM")}>
              <option value="INDIVIDUAL">Individual</option>
              <option value="TEAM">Team</option>
            </select>
          </Field>
          {form.teamType === "TEAM" ? (
            <Field label="Team Size">
              <input className="field" type="number" min="2" value={form.teamSize ?? 2} onChange={(event) => changeTeamSize(event.target.value)} />
            </Field>
          ) : null}
        </div>

        {form.teamType === "TEAM" ? (
          <div className="mt-4 space-y-3">
            {(form.teamMembers ?? []).map((member, index) => (
              <div key={index} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-3 text-sm font-semibold text-cyan-100">Team Member {index + 1}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input className="field" value={member.name} onChange={(event) => updateTeamMember(index, { name: event.target.value })} placeholder="Member name" />
                  <input className="field" value={member.phone ?? ""} onChange={(event) => updateTeamMember(index, { phone: event.target.value })} placeholder="Phone optional" />
                  <div className="md:col-span-2">
                    <FileNamePicker label="Member Aadhaar" value={member.aadhaarDocumentName} onChange={(value) => updateTeamMember(index, { aadhaarDocumentName: value })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <button className="primary-button mt-5 w-full" type="button" disabled={savingVendor} onClick={() => void submitVendor()}>
          {savingVendor ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Add Vendor
        </button>

        {message ? <Notice tone={message.tone} title={message.title} message={message.message} /> : null}
      </Panel>

      <Panel
        title="Vendor List"
        action={
          <button className="secondary-button" type="button" disabled={loadingVendors} onClick={() => void loadVendors()}>
            <RefreshCw className={`h-4 w-4 ${loadingVendors ? "animate-spin" : ""}`} />
            Refresh
          </button>
        }
      >
        <div className="smooth-scroll max-h-[min(78vh,820px)] overflow-auto rounded-md border border-white/10">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#08162c] text-xs uppercase text-slate-400 shadow-[0_1px_0_rgba(255,255,255,0.08)]">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Pincode</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3">Skills</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loadingVendors && !vendors.length ? <VendorSkeletonRows /> : null}
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{vendor.vendorName}</div>
                    <div className="mt-1 text-xs text-cyan-200">{vendor.vendorCode}</div>
                  </td>
                  <td className="px-4 py-3">{vendor.phone}</td>
                  <td className="px-4 py-3">{vendor.pincode}</td>
                  <td className="px-4 py-3">{formatEnum(vendor.teamType)} {vendor.teamType === "TEAM" ? `(${vendor.teamSize})` : ""}</td>
                  <td className="px-4 py-3">{formatEnum(vendor.kycStatus)}</td>
                  <td className="px-4 py-3 text-slate-300">{vendor.skills.length ? vendor.skills.join(", ") : "-"}</td>
                </tr>
              ))}
              {!vendors.length && !loadingVendors ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                    No vendors added yet. Add at least one vendor before assigning won work.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function FileNamePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-200">{label}</span>
      <span className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-200 transition hover:border-cyan-300/30">
        <span className="min-w-0 truncate">{value || "Choose file"}</span>
        <Upload className="h-4 w-4 shrink-0 text-cyan-200" />
      </span>
      <input className="hidden" type="file" onChange={(event) => onChange(event.target.files?.[0]?.name ?? "")} />
    </label>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (event.currentTarget.width / rect.width),
      y: (event.clientY - rect.top) * (event.currentTarget.height / rect.height),
    };
  }

  function beginDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const position = pointerPosition(event);
    context.strokeStyle = "#e0f2fe";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(position.x, position.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) {
      return;
    }

    const context = canvasRef.current?.getContext("2d");

    if (!context) {
      return;
    }

    const position = pointerPosition(event);
    context.lineTo(position.x, position.y);
    context.stroke();
  }

  function endDraw() {
    drawing.current = false;
    const canvas = canvasRef.current;

    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <canvas
        ref={canvasRef}
        className="h-32 w-full touch-none rounded-md border border-cyan-300/20 bg-[#031023]"
        height={128}
        width={420}
        onPointerDown={beginDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{value ? "Signature captured" : "Draw vendor signature above"}</span>
        <button className="secondary-button" type="button" onClick={clearSignature}>
          Clear
        </button>
      </div>
    </div>
  );
}

function VendorSkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index}>
          {Array.from({ length: 6 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-3">
              <div className="h-4 w-full max-w-[160px] animate-pulse rounded bg-white/10" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function emptyVendorForm(): CreateVendorInput {
  return {
    vendorName: "",
    phone: "",
    workingAddress: "",
    address: "",
    pincode: "",
    dateOfBirth: "",
    experienceYears: 0,
    aadhaarDocumentName: "",
    selfieDocumentName: "",
    signatureReference: "",
    teamType: "INDIVIDUAL",
    teamSize: 1,
    skills: [],
    teamMembers: [],
  };
}

function resizeTeamMembers(existing: VendorTeamMemberInput[], teamSize: number): VendorTeamMemberInput[] {
  return Array.from({ length: teamSize }).map((_, index) => existing[index] ?? { name: "", phone: "", aadhaarDocumentName: "" });
}

type UiQuotationItem = {
  id: string;
  itemName: string;
  unitPriceRs: string;
  quantity: string;
};

type UiQuotationPackage = {
  id: string;
  packageName: string;
  multiplier: number;
  items: UiQuotationItem[];
};

function LeadDetailWorkspaceV2({
  session,
  lead,
  onSaveRequested,
  onLeadTransferred,
  onBack,
}: {
  session: DevSession;
  lead: LeadDetail;
  onSaveRequested: (lead: LeadDetail, payload: SaveCallOutcomeInput) => void;
  onLeadTransferred: (lead: LeadDetail) => void;
  onBack: () => void;
}) {
  const warmDefault = defaultLocalDateTime(30);
  const [callOutcome, setCallOutcome] = useState("");
  const [conversationSummary, setConversationSummary] = useState("");
  const [intent, setIntent] = useState<SaveCallOutcomeInput["leadIntent"] | "">(lead.currentIntent === "INSTALLATION" || lead.currentIntent === "REPAIR_SERVICE" ? (lead.currentIntent as SaveCallOutcomeInput["leadIntent"]) : "");
  const [intentChangeSummary, setIntentChangeSummary] = useState("");
  const [lostSummary, setLostSummary] = useState("");
  const [followUpReason, setFollowUpReason] = useState<SaveCallOutcomeInput["followUpReason"] | "">(lead.followUpReason === "SITE_VISIT" || lead.followUpReason === "QUOTATION" || lead.followUpReason === "WON" ? (lead.followUpReason as SaveCallOutcomeInput["followUpReason"]) : "NURTURE");
  const [followUpDate, setFollowUpDate] = useState(warmDefault.date);
  const [followUpTime, setFollowUpTime] = useState(warmDefault.time);
  const [siteVisitStatus, setSiteVisitStatus] = useState<SaveCallOutcomeInput["siteVisitStatus"] | "">(lead.siteVisitStatus === "SCHEDULED" || lead.siteVisitStatus === "NOT_SCHEDULED" ? lead.siteVisitStatus : "");
  const [siteVisitDate, setSiteVisitDate] = useState(lead.siteVisitScheduledAt ? toDateInput(lead.siteVisitScheduledAt) : "");
  const [siteVisitTime, setSiteVisitTime] = useState(lead.siteVisitScheduledAt ? toTimeInput(lead.siteVisitScheduledAt) : "");
  const [siteVisitOutcomeStatus, setSiteVisitOutcomeStatus] = useState<"COMPLETED" | "NOT_COMPLETED" | "">("");
  const [siteVisitOutcomeSummary, setSiteVisitOutcomeSummary] = useState("");
  const [siteVisitNotCompletedReason, setSiteVisitNotCompletedReason] = useState("");
  const [quotationTitle, setQuotationTitle] = useState(lead.latestQuotation?.title ?? "");
  const [quotationPackages, setQuotationPackages] = useState<UiQuotationPackage[]>(() => quotationFromLead(lead));
  const [wonOpen, setWonOpen] = useState(false);
  const [wonUseCustomerPhone, setWonUseCustomerPhone] = useState(true);
  const [wonSiteContact, setWonSiteContact] = useState(lead.phoneNormalized);
  const [wonAddress, setWonAddress] = useState(lead.wonDetails?.address ?? "");
  const [wonScope, setWonScope] = useState(lead.wonDetails?.scopeOfWork ?? "");
  const [wonScheduleStatus, setWonScheduleStatus] = useState<"SCHEDULED" | "NOT_SCHEDULED">(lead.wonDetails?.scheduleStatus ?? "NOT_SCHEDULED");
  const [wonScheduleDate, setWonScheduleDate] = useState(lead.wonDetails?.scheduledAt ? toDateInput(lead.wonDetails.scheduledAt) : "");
  const [wonScheduleTime, setWonScheduleTime] = useState(lead.wonDetails?.scheduledAt ? toTimeInput(lead.wonDetails.scheduledAt) : "");
  const [wonQuotedPrice, setWonQuotedPrice] = useState(lead.wonDetails ? String(paiseToRs(lead.wonDetails.quotedPricePaise)) : "");
  const [wonAcceptedPrice, setWonAcceptedPrice] = useState(lead.wonDetails ? String(paiseToRs(lead.wonDetails.acceptedPricePaise)) : "");
  const [wonAdvancePayment, setWonAdvancePayment] = useState(lead.wonDetails ? String(paiseToRs(lead.wonDetails.advancePaymentPaise)) : "0");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [inspectedEvent, setInspectedEvent] = useState<LeadDetail["timeline"][number] | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "danger"; title: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferFollowUpDate, setTransferFollowUpDate] = useState(defaultLocalDateTime(0).date);
  const [transferFollowUpTime, setTransferFollowUpTime] = useState(defaultLocalDateTime(0).time);
  const [loadingAssignableUsers, setLoadingAssignableUsers] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);

  const isFollowUp = lead.currentStage !== "RAW_UNTOUCHED" || lead.spokenCount > 0;
  const outcomeOptions = normalizeOutcomeOptions(isFollowUp ? lead.followUpOutcomeOptions : lead.firstCallOutcomeOptions, lead);
  const spokeSelected = callOutcome === "SPOKE";
  const warmSelected = callOutcome === "WARM";
  const notInterestedSelected = callOutcome === "NOT_INTERESTED";
  const notReceivingSelected = callOutcome === "NOT_RECEIVING";
  const hotIntent = intent === "INSTALLATION" || intent === "REPAIR_SERVICE";
  const intentChanged = spokeSelected && intent && intent !== "LOST" && lead.currentIntent !== "UNKNOWN" && intent !== lead.currentIntent;
  const existingScheduledSiteVisit = isFollowUp && lead.followUpReason === "SITE_VISIT" && lead.siteVisitStatus === "SCHEDULED";
  const needsSiteVisitOutcome = spokeSelected && existingScheduledSiteVisit;
  const needsSiteVisitSchedule = spokeSelected && hotIntent && followUpReason === "SITE_VISIT";
  const nextNotReceivingLabel = getNextNotReceivingLabel(lead);
  const isWonLead = lead.currentStage === "CAPTURED_WON";
  const canTransferLead = hasPermission(session, "TRANSFER_LEADS");

  useEffect(() => {
    if (!canTransferLead) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setLoadingAssignableUsers(true);
      apiGet<AssignableUser[]>("/auth/assignable-users", session)
        .then((users) => {
          setAssignableUsers(users.filter((user) => user.id !== session.userId));
        })
        .catch((error) => {
          setNotice({ tone: "danger", title: "Transfer users blocked", message: error instanceof Error ? error.message : "Could not load staff list." });
        })
        .finally(() => setLoadingAssignableUsers(false));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [canTransferLead, session]);

  function handleOutcomeChange(value: string) {
    setCallOutcome(value);

    if (value === "WARM") {
      setIntent("");
      setFollowUpReason("NURTURE");
      const nextMonth = defaultLocalDateTime(30);
      setFollowUpDate(nextMonth.date);
      setFollowUpTime(nextMonth.time);
    }
  }

  function handleIntentChange(value: string) {
    const nextIntent = value as SaveCallOutcomeInput["leadIntent"];
    setIntent(nextIntent);

    if (nextIntent === "INSTALLATION" || nextIntent === "REPAIR_SERVICE") {
      setFollowUpReason((current) => current || "NURTURE");
    }
  }

  function handleGenerateMessage() {
    setWhatsappMessage(generateWhatsAppDraft({ lead, intent: warmSelected ? "WARM" : intent, followUpReason: warmSelected ? "NURTURE" : followUpReason, conversationSummary, siteVisitStatus }));
  }

  function validateBeforeBackgroundSave(): string | null {
    if (notInterestedSelected && !conversationSummary.trim()) {
      return "Conversation summary is required for Not Interested.";
    }

    if (spokeSelected && !intent) {
      return "Lead intent is required when Spoke is selected.";
    }

    if (spokeSelected && !conversationSummary.trim()) {
      return "Conversation summary is required when Spoke is selected.";
    }

    if (spokeSelected && intent === "LOST" && !lostSummary.trim()) {
      return "Lost summary is required before moving a lead to Lost Leads.";
    }

    if (needsSiteVisitOutcome && !siteVisitOutcomeStatus) {
      return "Site visit status is required for a scheduled site visit follow-up.";
    }

    if (siteVisitOutcomeStatus === "COMPLETED" && !siteVisitOutcomeSummary.trim()) {
      return "Site visit outcome summary is required.";
    }

    if (siteVisitOutcomeStatus === "NOT_COMPLETED" && !siteVisitNotCompletedReason.trim()) {
      return "Reason is required when the site visit was not completed.";
    }

    if (spokeSelected && hotIntent && !followUpReason) {
      return "Follow-up reason is required for Installation and Repair/Service.";
    }

    if (spokeSelected && followUpReason === "SITE_VISIT" && !siteVisitStatus) {
      return "Site visit scheduled/not scheduled is required.";
    }

    if (spokeSelected && followUpReason === "WON" && (!wonAddress.trim() || !wonScope.trim() || !wonQuotedPrice || !wonAcceptedPrice)) {
      return "Won customer details must be uploaded before saving a Won lead.";
    }

    if (spokeSelected && followUpReason === "WON" && wonScheduleStatus === "SCHEDULED" && (!wonScheduleDate || !wonScheduleTime)) {
      return "Won schedule date and time are required when work is scheduled.";
    }

    return null;
  }

  function saveCallUpdate() {
    setBusy(true);
    setNotice(null);

    try {
      const validationError = validateBeforeBackgroundSave();

      if (validationError) {
        setNotice({ tone: "danger", title: "Save blocked", message: validationError });
        return;
      }

      const payload: SaveCallOutcomeInput = {
        callOutcome: callOutcome as SaveCallOutcomeInput["callOutcome"],
        conversationSummary,
        uploadedFileName: uploadedFileName || undefined,
        whatsappMessageBody: whatsappMessage.trim() || undefined,
      };

      if (warmSelected) {
        payload.followUpAt = localDateTimeToIso(followUpDate, followUpTime);
      }

      if (spokeSelected) {
        payload.leadIntent = intent || undefined;
        payload.intentChangeSummary = intentChangeSummary || undefined;

        if (needsSiteVisitOutcome) {
          payload.siteVisitOutcome = {
            status: siteVisitOutcomeStatus as "COMPLETED" | "NOT_COMPLETED",
            outcomeSummary: siteVisitOutcomeSummary || undefined,
            notCompletedReason: siteVisitNotCompletedReason || undefined,
          };
        }

        if (intent === "LOST") {
          payload.lostSummary = lostSummary || undefined;
        } else {
          payload.followUpReason = intent === "WARM" ? "NURTURE" : followUpReason || undefined;
        }

        if (payload.followUpReason === "SITE_VISIT") {
          payload.siteVisitStatus = siteVisitStatus || undefined;
          payload.siteVisitScheduledAt = siteVisitStatus === "SCHEDULED" ? localDateTimeToIso(siteVisitDate, siteVisitTime) : undefined;
          payload.followUpAt = siteVisitStatus === "NOT_SCHEDULED" ? localDateTimeToIso(followUpDate, followUpTime) : undefined;
        } else if (payload.followUpReason && payload.followUpReason !== "WON") {
          payload.followUpAt = localDateTimeToIso(followUpDate, followUpTime);
        }

        if (payload.followUpReason === "QUOTATION") {
          payload.quotation = {
            title: quotationTitle || `${lead.customerName} Quotation`,
            packages: quotationPackages.map((pkg) => ({
              packageName: pkg.packageName,
              multiplier: pkg.multiplier,
              items: pkg.items.map((item) => ({
                itemName: item.itemName,
                unitPriceRs: Number(item.unitPriceRs || 0),
                quantity: Number(item.quantity || 1),
              })),
            })),
          };
        }

        if (payload.followUpReason === "WON") {
          payload.wonDetails = {
            siteContactNumber: wonUseCustomerPhone ? lead.phoneNormalized : wonSiteContact,
            useCustomerPhoneAsSiteContact: wonUseCustomerPhone,
            address: wonAddress,
            scopeOfWork: wonScope,
            scheduleStatus: wonScheduleStatus,
            scheduledAt: wonScheduleStatus === "SCHEDULED" ? localDateTimeToIso(wonScheduleDate, wonScheduleTime) : undefined,
            quotedPriceRs: Number(wonQuotedPrice || 0),
            acceptedPriceRs: Number(wonAcceptedPrice || 0),
            advancePaymentRs: Number(wonAdvancePayment || 0),
          };
        }
      }

      onSaveRequested(lead, payload);
    } catch (error) {
      setNotice({ tone: "danger", title: "Save blocked", message: error instanceof Error ? error.message : "Could not save this call update." });
    } finally {
      setBusy(false);
    }
  }

  async function transferLead() {
    if (!transferToUserId) {
      setNotice({ tone: "danger", title: "Transfer blocked", message: "Select the staff member who should receive this lead." });
      return;
    }

    if (!transferReason.trim()) {
      setNotice({ tone: "danger", title: "Transfer blocked", message: "Write why this lead is being transferred." });
      return;
    }

    setTransferBusy(true);
    setNotice(null);

    try {
      const payload: TransferLeadInput = {
        toUserId: transferToUserId,
        reason: transferReason,
        followUpAt: localDateTimeToIso(transferFollowUpDate, transferFollowUpTime),
      };
      const updated = await apiPost<LeadDetail>(`/leads/${lead.id}/transfer`, session, payload);
      onLeadTransferred(updated);
      const receiver = assignableUsers.find((user) => user.id === transferToUserId);
      setTransferReason("");
      setNotice({
        tone: "success",
        title: "Lead transferred",
        message: `${lead.customerName} was assigned to ${receiver?.name ?? "selected staff"} and added to their follow-up queue.`,
      });
    } catch (error) {
      setNotice({ tone: "danger", title: "Transfer failed", message: error instanceof Error ? error.message : "Could not transfer this lead." });
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <button className="secondary-button" onClick={onBack}>
        Back to {queueTitle(currentQueueForLead(lead))}
      </button>

      <Panel title={`${lead.customerName} - ${lead.phoneNormalized}`}>
        <div className="grid gap-4 md:grid-cols-4">
          <Info label="Lead Stage" value={formatEnum(lead.currentStage)} />
          <Info label="Lead Intent" value={formatEnum(lead.currentIntent)} />
          <Info label="Follow-up Reason" value={lead.followUpReason ? formatEnum(lead.followUpReason) : "-"} />
          <Info label="Next Follow-up" value={lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : "-"} />
        </div>
      </Panel>

      {canTransferLead ? (
        <Panel
          title="Transfer Lead"
          action={
            loadingAssignableUsers ? (
              <span className="inline-flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading staff
              </span>
            ) : null
          }
        >
          <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_0.9fr_0.9fr_auto]">
            <Field label="Send To">
              <select className="field" value={transferToUserId} onChange={(event) => setTransferToUserId(event.target.value)}>
                <option value="">Select staff</option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} - {user.postTitle ?? formatEnum(user.role)} - Stage {user.authorityStage}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Transfer Reason">
              <input className="field" value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Needs senior follow-up, pricing approval..." />
            </Field>
            <Field label="Follow-up Date">
              <input className="field" type="date" value={transferFollowUpDate} onChange={(event) => setTransferFollowUpDate(event.target.value)} />
            </Field>
            <Field label="Follow-up Time">
              <input className="field" type="time" value={transferFollowUpTime} onChange={(event) => setTransferFollowUpTime(event.target.value)} />
            </Field>
            <div className="flex items-end">
              <button className="primary-button w-full" type="button" disabled={transferBusy || !transferToUserId || !transferReason.trim()} onClick={() => void transferLead()}>
                {transferBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Transfer
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">The backend will reassign the lead, create the receiver follow-up, notify them, and write a transfer event in customer history.</p>
        </Panel>
      ) : null}

      {wonOpen ? (
        <WonDetailsPanel
          lead={lead}
          useCustomerPhone={wonUseCustomerPhone}
          siteContact={wonSiteContact}
          address={wonAddress}
          scope={wonScope}
          scheduleStatus={wonScheduleStatus}
          scheduleDate={wonScheduleDate}
          scheduleTime={wonScheduleTime}
          quotedPrice={wonQuotedPrice}
          acceptedPrice={wonAcceptedPrice}
          advancePayment={wonAdvancePayment}
          onUseCustomerPhoneChange={setWonUseCustomerPhone}
          onSiteContactChange={setWonSiteContact}
          onAddressChange={setWonAddress}
          onScopeChange={setWonScope}
          onScheduleStatusChange={setWonScheduleStatus}
          onScheduleDateChange={setWonScheduleDate}
          onScheduleTimeChange={setWonScheduleTime}
          onQuotedPriceChange={setWonQuotedPrice}
          onAcceptedPriceChange={setWonAcceptedPrice}
          onAdvancePaymentChange={setWonAdvancePayment}
          onClose={() => setWonOpen(false)}
        />
      ) : null}

      {inspectedEvent ? (
        <TimelineDetailTab event={inspectedEvent} onClose={() => setInspectedEvent(null)} />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {isWonLead ? (
          <WonLeadOperationsPanel session={session} lead={lead} />
        ) : (
        <Panel title={isFollowUp ? `${formatEnum(lead.currentIntent)} follow-up #${lead.spokenCount + 1}` : "Raw Lead First Call"}>
          {existingScheduledSiteVisit ? <Notice tone="warning" title="Scheduled site visit follow-up" message="When the customer is spoken to, first record whether the site visit was completed." /> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Call Outcome">
              <select className="field" value={callOutcome} onChange={(event) => handleOutcomeChange(event.target.value)}>
                <option value="">Select outcome</option>
                {outcomeOptions.map((option) => (
                  <option key={option} value={option}>{formatEnum(option)}</option>
                ))}
              </select>
            </Field>
          </div>

          {(spokeSelected || warmSelected || notInterestedSelected) ? (
            <div className="mt-5">
              <Field label={warmSelected ? "Conversation Summary (optional)" : "Conversation Summary"}>
                <textarea className="field min-h-28" value={conversationSummary} onChange={(event) => setConversationSummary(event.target.value)} placeholder="Write customer requirement, discussion, objection, location, and next action." />
              </Field>
            </div>
          ) : null}

          {warmSelected ? (
            <div className="mt-4 space-y-4">
              <Notice tone="success" title="Warm nurture lead" message="This keeps the lead active, sets reason to Nurture, and defaults the next follow-up to one month later. Summary is optional for this shortcut." />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nurture Follow-up Date">
                  <input className="field" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                </Field>
                <Field label="Follow-up Time">
                  <input className="field" type="time" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)} />
                </Field>
              </div>
            </div>
          ) : null}

          {needsSiteVisitOutcome ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Site Visit Status">
                <select className="field" value={siteVisitOutcomeStatus} onChange={(event) => setSiteVisitOutcomeStatus(event.target.value as "COMPLETED" | "NOT_COMPLETED" | "")}>
                  <option value="">Select status</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="NOT_COMPLETED">Not Completed</option>
                </select>
              </Field>
              {siteVisitOutcomeStatus === "COMPLETED" ? (
                <Field label="Site Visit Outcome">
                  <textarea className="field min-h-24" value={siteVisitOutcomeSummary} onChange={(event) => setSiteVisitOutcomeSummary(event.target.value)} />
                </Field>
              ) : null}
              {siteVisitOutcomeStatus === "NOT_COMPLETED" ? (
                <Field label="Reason Not Completed">
                  <textarea className="field min-h-24" value={siteVisitNotCompletedReason} onChange={(event) => setSiteVisitNotCompletedReason(event.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}

          {spokeSelected ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label={intent === "WARM" ? "Nurture Follow-up Date" : followUpReason === "QUOTATION" ? "Quotation Follow-up Date" : "Follow-up Date"}>
                <input className="field" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
              </Field>
              <Field label="Follow-up Time">
                <input className="field" type="time" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)} />
              </Field>
              <Field label="Lead Intent">
                <select className="field" value={intent} onChange={(event) => handleIntentChange(event.target.value)}>
                  <option value="">Select intent</option>
                  <option value="INSTALLATION">Installation</option>
                  <option value="REPAIR_SERVICE">Repair / Service</option>
                  {isFollowUp ? <option value="LOST">Lost</option> : null}
                </select>
              </Field>
            </div>
          ) : null}

          {intentChanged ? (
            <div className="mt-4">
              <Notice tone="warning" title="Intent change warning" message={`This will change the lead intent from ${formatEnum(lead.currentIntent)} to ${formatEnum(intent)}.`} />
              <Field label="Intent Change Summary">
                <textarea className="field min-h-20" value={intentChangeSummary} onChange={(event) => setIntentChangeSummary(event.target.value)} />
              </Field>
            </div>
          ) : null}

          {spokeSelected && intent === "LOST" ? (
            <div className="mt-4">
              <Notice tone="danger" title="Marking lead as lost" message="This moves the lead into Lost Leads. It remains searchable and is not hard deleted." />
              <Field label="Lost Summary">
                <textarea className="field min-h-24" value={lostSummary} onChange={(event) => setLostSummary(event.target.value)} />
              </Field>
            </div>
          ) : null}

          {spokeSelected && hotIntent ? (
            <div className="mt-4 space-y-4">
              <Field label="Follow-up Reason">
                <select className="field" value={followUpReason} onChange={(event) => setFollowUpReason(event.target.value as SaveCallOutcomeInput["followUpReason"])}>
                  <option value="">Select reason</option>
                  <option value="NURTURE">Nurture</option>
                  <option value="QUOTATION">Quotation</option>
                  <option value="SITE_VISIT">Site Visit</option>
                  <option value="WON">Won</option>
                </select>
              </Field>

              {followUpReason === "QUOTATION" ? (
                <QuotationBuilder title={quotationTitle} packages={quotationPackages} suggestions={lead.quotationSuggestions} onTitleChange={setQuotationTitle} onPackagesChange={setQuotationPackages} />
              ) : null}

              {needsSiteVisitSchedule ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Site Visit Schedule">
                    <select className="field" value={siteVisitStatus} onChange={(event) => setSiteVisitStatus(event.target.value as SaveCallOutcomeInput["siteVisitStatus"])}>
                      <option value="">Select status</option>
                      <option value="SCHEDULED">Scheduled</option>
                      <option value="NOT_SCHEDULED">Not Scheduled</option>
                    </select>
                  </Field>
                  {siteVisitStatus === "SCHEDULED" ? (
                    <>
                      <Field label={lead.siteVisitScheduledAt ? "Rescheduled Site Visit Date" : "Site Visit Scheduled Date"}>
                        <input className="field" type="date" value={siteVisitDate} onChange={(event) => setSiteVisitDate(event.target.value)} />
                      </Field>
                      <Field label="Site Visit Time">
                        <input className="field" type="time" value={siteVisitTime} onChange={(event) => setSiteVisitTime(event.target.value)} />
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : null}

              {followUpReason === "WON" ? (
                <div>
                  <Notice tone="success" title="Won confirmation" message="Confirm only if the customer is actually won. Job/vendor workflow is intentionally delayed." />
                  <button className="secondary-button mt-3" type="button" onClick={() => setWonOpen(true)}>Upload Won Customer Details</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {notReceivingSelected ? (
            <Notice tone="warning" title="Unanswered lead follow-up" message={`Backend will schedule the next unanswered follow-up after ${nextNotReceivingLabel}.`} />
          ) : null}

          {callOutcome === "WRONG_NUMBER" ? <Notice tone="warning" title="Wrong number" message="This moves the record into Wrong Number archive and keeps history searchable." /> : null}

          {(spokeSelected || warmSelected) ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-3">
                <button className="secondary-button" type="button" onClick={handleGenerateMessage}>Generate WhatsApp Draft</button>
                <label className="secondary-button cursor-pointer">
                  Upload Preview
                  <input className="hidden" type="file" onChange={(event) => setUploadedFileName(event.target.files?.[0]?.name ?? "")} />
                </label>
              </div>
              {uploadedFileName ? <p className="text-sm text-slate-300">Selected upload: {uploadedFileName}</p> : null}
              <Field label="WhatsApp Message Preview">
                <textarea className="field min-h-28" value={whatsappMessage} onChange={(event) => setWhatsappMessage(event.target.value)} placeholder="Generate or type the message staff will send manually." />
              </Field>
              <button className="secondary-button" type="button" disabled={!whatsappMessage.trim()} onClick={() => window.open(whatsappRedirectUrl(lead.phoneNormalized, whatsappMessage), "_blank", "noopener,noreferrer")}>Open WhatsApp With Message</button>
            </div>
          ) : null}

          {notice ? <Notice tone={notice.tone} title={notice.title} message={notice.message} /> : null}

          <button className="primary-button mt-5" disabled={!callOutcome || busy} onClick={() => void saveCallUpdate()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save Lead Update
          </button>
        </Panel>
        )}

        <Panel title="History Timeline">
          <div className="space-y-3">
            {lead.latestQuotation ? <Info label="Latest Quotation" value={`${lead.latestQuotation.title} - Rs ${paiseToRs(lead.latestQuotation.totalPricePaise)}`} /> : null}
            {lead.wonDetails ? <Info label="Won Accepted Price" value={`Rs ${paiseToRs(lead.wonDetails.acceptedPricePaise)}`} /> : null}
            {lead.timeline.map((event) => (
              <TimelineEventCard key={event.id} event={event} onInspect={() => setInspectedEvent(event)} />
            ))}
          </div>
        </Panel>
      </section>
    </section>
  );
}

function QuotationBuilder({
  title,
  packages,
  suggestions,
  onTitleChange,
  onPackagesChange,
}: {
  title: string;
  packages: UiQuotationPackage[];
  suggestions: LeadDetail["quotationSuggestions"];
  onTitleChange: (title: string) => void;
  onPackagesChange: (packages: UiQuotationPackage[]) => void;
}) {
  const itemListId = "quotation-item-suggestions";
  const packageListId = "quotation-package-suggestions";

  function updatePackage(packageId: string, patch: Partial<UiQuotationPackage>) {
    onPackagesChange(packages.map((pkg) => (pkg.id === packageId ? { ...pkg, ...patch } : pkg)));
  }

  function updateItem(packageId: string, itemId: string, patch: Partial<UiQuotationItem>) {
    onPackagesChange(packages.map((pkg) => (pkg.id === packageId ? { ...pkg, items: pkg.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) } : pkg)));
  }

  function applyPackageSuggestion(packageId: string, packageName: string) {
    const suggestion = suggestions.packages.find((pkg) => pkg.packageName.toLowerCase() === packageName.trim().toLowerCase());
    const nextItems = suggestion
      ? suggestion.items.map((item) => ({
          id: makeUiId(),
          itemName: item.itemName,
          unitPriceRs: String(paiseToRs(item.unitPricePaise)),
          quantity: String(item.quantity),
        }))
      : undefined;
    updatePackage(packageId, nextItems ? { packageName, items: nextItems } : { packageName });
  }

  function applyItemSuggestion(packageId: string, itemId: string, itemName: string) {
    const suggestion = suggestions.items.find((item) => item.itemName.toLowerCase() === itemName.trim().toLowerCase());
    updateItem(packageId, itemId, suggestion ? { itemName, unitPriceRs: String(paiseToRs(suggestion.lastPricePaise)) } : { itemName });
  }

  function addPackage(name = "New Package") {
    onPackagesChange([...packages, makeQuotationPackage(name)]);
  }

  return (
    <section className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-4">
      <datalist id={itemListId}>
        {suggestions.items.map((item) => <option key={item.itemName} value={item.itemName} />)}
      </datalist>
      <datalist id={packageListId}>
        {suggestions.packages.map((pkg) => <option key={pkg.packageName} value={pkg.packageName} />)}
      </datalist>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field label="Quotation Header">
          <input className="field" list={packageListId} value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Shop 4 camera quotation" />
        </Field>
        <Info label="Grand Total" value={`Rs ${packages.reduce((total, pkg) => total + packageTotalRs(pkg), 0)}`} />
      </div>

      <div className="mt-4 space-y-4">
        {packages.map((pkg) => (
          <div key={pkg.id} className="rounded-md border border-white/10 bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_110px_auto_auto]">
              <Field label="Package Name">
                <input className="field" list={packageListId} value={pkg.packageName} onChange={(event) => applyPackageSuggestion(pkg.id, event.target.value)} />
              </Field>
              <Field label="Multiplier">
                <input className="field" type="number" min="1" value={pkg.multiplier} onChange={(event) => updatePackage(pkg.id, { multiplier: Math.max(1, Number(event.target.value || 1)) })} />
              </Field>
              <button className="secondary-button self-end" type="button" onClick={() => updatePackage(pkg.id, { multiplier: pkg.multiplier + 1 })}>
                <Plus className="h-4 w-4" />
                Package +
              </button>
              <Info label="Total" value={`Rs ${packageTotalRs(pkg)}`} />
            </div>

            <div className="mt-4 space-y-3">
              {pkg.items.map((item) => (
                <div key={item.id} className="grid gap-3 md:grid-cols-[1fr_140px_110px_120px]">
                  <input className="field" list={itemListId} value={item.itemName} onChange={(event) => applyItemSuggestion(pkg.id, item.id, event.target.value)} placeholder="Item name" />
                  <input className="field" type="number" min="0" value={item.unitPriceRs} onChange={(event) => updateItem(pkg.id, item.id, { unitPriceRs: event.target.value.replace(/\D/g, "") })} placeholder="Rs" />
                  <input className="field" type="number" min="1" value={item.quantity} onChange={(event) => updateItem(pkg.id, item.id, { quantity: event.target.value.replace(/\D/g, "") || "1" })} />
                  <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold">Rs {lineTotalRs(pkg, item)}</div>
                </div>
              ))}
              <button className="secondary-button" type="button" onClick={() => updatePackage(pkg.id, { items: [...pkg.items, makeQuotationItem()] })}>
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="secondary-button mt-4" type="button" onClick={() => addPackage(window.prompt("Package name") || "New Package")}>
        <Plus className="h-4 w-4" />
        New +
      </button>
    </section>
  );
}

function WonDetailsPanel({
  lead,
  useCustomerPhone,
  siteContact,
  address,
  scope,
  scheduleStatus,
  scheduleDate,
  scheduleTime,
  quotedPrice,
  acceptedPrice,
  advancePayment,
  onUseCustomerPhoneChange,
  onSiteContactChange,
  onAddressChange,
  onScopeChange,
  onScheduleStatusChange,
  onScheduleDateChange,
  onScheduleTimeChange,
  onQuotedPriceChange,
  onAcceptedPriceChange,
  onAdvancePaymentChange,
  onClose,
}: {
  lead: LeadDetail;
  useCustomerPhone: boolean;
  siteContact: string;
  address: string;
  scope: string;
  scheduleStatus: "SCHEDULED" | "NOT_SCHEDULED";
  scheduleDate: string;
  scheduleTime: string;
  quotedPrice: string;
  acceptedPrice: string;
  advancePayment: string;
  onUseCustomerPhoneChange: (value: boolean) => void;
  onSiteContactChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onScopeChange: (value: string) => void;
  onScheduleStatusChange: (value: "SCHEDULED" | "NOT_SCHEDULED") => void;
  onScheduleDateChange: (value: string) => void;
  onScheduleTimeChange: (value: string) => void;
  onQuotedPriceChange: (value: string) => void;
  onAcceptedPriceChange: (value: string) => void;
  onAdvancePaymentChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="sticky top-20 z-20 rounded-md border border-emerald-300/30 bg-[#06271f] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Upload Won Customer Details</h2>
          <p className="mt-1 text-sm text-emerald-100/80">This top panel is mandatory before the lead can move to Won Leads. Vendor/job workflow starts in the next backend phase.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          <X className="h-4 w-4" />
          Done
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-semibold">
          <input type="checkbox" checked={useCustomerPhone} onChange={(event) => onUseCustomerPhoneChange(event.target.checked)} />
          Use customer number
        </label>
        <Field label="Site Contact Number">
          <input className="field" value={useCustomerPhone ? lead.phoneNormalized : siteContact} disabled={useCustomerPhone} onChange={(event) => onSiteContactChange(event.target.value)} />
        </Field>
        <Field label="Schedule">
          <select className="field" value={scheduleStatus} onChange={(event) => onScheduleStatusChange(event.target.value as "SCHEDULED" | "NOT_SCHEDULED")}>
            <option value="SCHEDULED">{lead.currentIntent === "REPAIR_SERVICE" ? "Repair/Service Request Scheduled" : "Installation Scheduled"}</option>
            <option value="NOT_SCHEDULED">Not Scheduled</option>
          </select>
        </Field>
        {scheduleStatus === "SCHEDULED" ? (
          <>
            <Field label="Schedule Date">
              <input className="field" type="date" value={scheduleDate} onChange={(event) => onScheduleDateChange(event.target.value)} />
            </Field>
            <Field label="Schedule Time">
              <input className="field" type="time" value={scheduleTime} onChange={(event) => onScheduleTimeChange(event.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Quoted Price">
          <input className="field" type="number" min="0" value={quotedPrice} onChange={(event) => onQuotedPriceChange(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Accepted Price">
          <input className="field" type="number" min="0" value={acceptedPrice} onChange={(event) => onAcceptedPriceChange(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Advance Payment">
          <input className="field" type="number" min="0" value={advancePayment} onChange={(event) => onAdvancePaymentChange(event.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Location / Written Address">
          <textarea className="field min-h-24" value={address} onChange={(event) => onAddressChange(event.target.value)} />
        </Field>
        <Field label="Scope Of Work">
          <textarea className="field min-h-24" value={scope} onChange={(event) => onScopeChange(event.target.value)} />
        </Field>
      </div>
    </section>
  );
}

function WonLeadOperationsPanel({ session, lead }: { session: DevSession; lead: LeadDetail }) {
  const [detail, setDetail] = useState<WonLeadOperationDetail | null>(null);
  const [job, setJob] = useState<JobOperation | null>(null);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [offerPriceRs, setOfferPriceRs] = useState("");
  const [completionSummary, setCompletionSummary] = useState("");
  const [vendorBonusRs, setVendorBonusRs] = useState("0");
  const [vendorDeductionRs, setVendorDeductionRs] = useState("0");
  const [photoType, setPhotoType] = useState<JobPhotoType>("COMPLETED_WORK");
  const [photoFileName, setPhotoFileName] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  const [checklistType, setChecklistType] = useState<JobChecklistType>(lead.currentIntent === "REPAIR_SERVICE" ? "REPAIR_SERVICE" : "INSTALLATION");
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() => defaultJobChecklistItems(lead.currentIntent === "REPAIR_SERVICE" ? "REPAIR_SERVICE" : "INSTALLATION"));
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; message: string } | null>(null);

  const syncChecklistFromJob = useCallback((nextJob: JobOperation | null) => {
    if (!nextJob) {
      return;
    }

    const nextType = resolveChecklistType(nextJob);
    const existingChecklist = nextJob.checklists.find((checklist) => checklist.type === nextType) ?? nextJob.checklists[0] ?? null;
    const effectiveType = existingChecklist?.type ?? nextType;
    setChecklistType(effectiveType);
    setChecklistItems(existingChecklist?.items.length ? existingChecklist.items : defaultJobChecklistItems(effectiveType));
  }, []);

  const loadOperation = useCallback(async () => {
    setLoadingOperations(true);
    setMessage(null);

    try {
      const next = await apiGet<WonLeadOperationDetail>(`/operations/won/${lead.id}`, session);
      setDetail(next);
      setJob(next.job);
      setVendors(next.vendors);
      syncChecklistFromJob(next.job);
      setOfferPriceRs(next.job?.vendorOfferPricePaise ? String(paiseToRs(next.job.vendorOfferPricePaise)) : "");
    } catch (error) {
      setMessage({ tone: "danger", title: "Operations blocked", message: error instanceof Error ? error.message : "Could not load won operations." });
    } finally {
      setLoadingOperations(false);
    }
  }, [lead.id, session, syncChecklistFromJob]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOperation();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadOperation]);

  async function runJobAction(label: string, action: () => Promise<JobOperation>, afterSuccess?: (updated: JobOperation) => void) {
    setActionBusy(label);
    setMessage(null);

    try {
      const updated = await action();
      setJob(updated);
      setDetail((current) => (current ? { ...current, job: updated } : current));
      syncChecklistFromJob(updated);
      afterSuccess?.(updated);
      setMessage({ tone: "success", title: "Operations updated", message: `${label} completed.` });
    } catch (error) {
      setMessage({ tone: "danger", title: `${label} blocked`, message: error instanceof Error ? error.message : "Operation failed." });
    } finally {
      setActionBusy(null);
    }
  }

  function toggleVendor(vendorId: string) {
    setSelectedVendorIds((current) => (current.includes(vendorId) ? current.filter((id) => id !== vendorId) : [...current, vendorId]));
  }

  function updateChecklistItem(itemId: string, checked: boolean) {
    setChecklistItems((items) => items.map((item) => (item.id === itemId ? { ...item, checked } : item)));
  }

  const wonDetails = detail?.wonDetails ?? lead.wonDetails;
  const canSaveProof = Boolean(job && ["VENDOR_OFFER_SENT", "VENDOR_ASSIGNED", "WORK_STARTED", "WORK_PAUSED"].includes(job.status));
  const hasCompletedWorkPhoto = Boolean(job?.photos.some((photo) => photo.type === "COMPLETED_WORK"));
  const submittedChecklist = job?.checklists.find((checklist) => checklist.status === "SUBMITTED" && checklist.items.every((item) => item.checked));
  const checklistReady = checklistItems.length > 0 && checklistItems.every((item) => item.checked);
  const proofReady = hasCompletedWorkPhoto && Boolean(submittedChecklist);
  const certificateRecords = job?.certificates ?? [];

  return (
    <Panel
      title="Won Lead Execution"
      action={
        <button className="secondary-button" type="button" disabled={loadingOperations} onClick={() => void loadOperation()}>
          <RefreshCw className={`h-4 w-4 ${loadingOperations ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      <Notice
        tone="success"
        title="Won workflow mode"
        message="Won leads do not show the raw call dialog. Operations staff now works from job status, vendor offer, work start/pause/close, and certificate history."
      />

      {loadingOperations && !detail ? <InlineProgress message="Loading won execution details..." /> : null}
      {message ? <Notice tone={message.tone} title={message.title} message={message.message} /> : null}

      {wonDetails ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Info label="Site Contact" value={wonDetails.siteContactNumber} />
          <Info label="Schedule" value={wonDetails.scheduledAt ? formatDateTime(wonDetails.scheduledAt) : formatEnum(wonDetails.scheduleStatus)} />
          <Info label="Quoted Price" value={`Rs ${paiseToRs(wonDetails.quotedPricePaise)}`} />
          <Info label="Accepted Price" value={`Rs ${paiseToRs(wonDetails.acceptedPricePaise)}`} />
          <Info label="Advance Payment" value={`Rs ${paiseToRs(wonDetails.advancePaymentPaise)}`} />
          <Info label="Scope" value={wonDetails.scopeOfWork} />
          <div className="md:col-span-2">
            <Info label="Location / Written Address" value={wonDetails.address} />
          </div>
        </div>
      ) : (
        <Notice tone="danger" title="Won details missing" message="This lead is marked won but does not have won details. Fix won details before operations starts." />
      )}

      <div className="mt-5 rounded-md border border-cyan-300/20 bg-cyan-300/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-semibold text-cyan-100">Operations Job</div>
            <p className="mt-1 text-sm text-slate-300">Create the job once, then assign vendors and execute work from the same record.</p>
          </div>
          {!job ? (
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(actionBusy) || !wonDetails}
              onClick={() => void runJobAction("Create job", () => apiPost<JobOperation>(`/operations/won/${lead.id}/job`, session, {}))}
            >
              {actionBusy === "Create job" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BriefcaseBusiness className="h-4 w-4" />}
              Create Operations Job
            </button>
          ) : (
            <StatusBadge label={formatEnum(job.status)} />
          )}
        </div>

        {job ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Info label="Job ID" value={job.id.slice(0, 8)} />
            <Info label="Status" value={formatEnum(job.status)} />
            <Info label="Assigned Vendor" value={job.assignedVendorName ?? "-"} />
            <Info label="Started" value={job.startedAt ? formatDateTime(job.startedAt) : "-"} />
          </div>
        ) : null}
      </div>

      {job ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Assign Work</h3>
                <p className="mt-1 text-sm text-slate-300">Vendor message includes only customer/job details and vendor offer price. It never includes customer accepted price or company margin.</p>
              </div>
              <Send className="h-5 w-5 text-cyan-200" />
            </div>

            <Field label="Vendor Offer Price">
              <input className="field" type="number" min="0" value={offerPriceRs} onChange={(event) => setOfferPriceRs(event.target.value.replace(/\D/g, ""))} placeholder="Amount in Rs" />
            </Field>

            <div className="mt-4 max-h-72 overflow-auto rounded-md border border-white/10">
              {vendors.map((vendor) => (
                <label key={vendor.id} className="flex cursor-pointer items-start gap-3 border-b border-white/10 px-3 py-3 last:border-b-0 hover:bg-white/[0.03]">
                  <input className="mt-1" type="checkbox" checked={selectedVendorIds.includes(vendor.id)} onChange={() => toggleVendor(vendor.id)} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{vendor.vendorName}</span>
                    <span className="mt-1 block text-xs text-cyan-200">{vendor.phone} | {vendor.pincode} | {formatEnum(vendor.kycStatus)}</span>
                    <span className="mt-1 block text-xs text-slate-400">{vendor.skills.length ? vendor.skills.join(", ") : "No skills tagged"}</span>
                  </span>
                </label>
              ))}
              {!vendors.length ? <div className="px-3 py-6 text-center text-sm text-slate-400">No vendors added yet. Add vendors from the Vendors section first.</div> : null}
            </div>

            <button
              className="primary-button mt-4 w-full"
              type="button"
              disabled={Boolean(actionBusy) || !selectedVendorIds.length || !offerPriceRs}
              onClick={() =>
                void runJobAction("Assign vendors", () =>
                  apiPost<JobOperation>(`/operations/jobs/${job.id}/assign`, session, {
                    vendorIds: selectedVendorIds,
                    offerPriceRs: Number(offerPriceRs || 0),
                  }),
                )
              }
            >
              {actionBusy === "Assign vendors" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Generate Vendor Offer
            </button>
          </section>

          <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-start gap-3">
              <ClipboardCheck className="mt-0.5 h-5 w-5 text-cyan-200" />
              <div>
                <h3 className="font-semibold">Work Execution</h3>
                <p className="mt-1 text-sm text-slate-300">Fast status buttons with backend timestamps and event history.</p>
              </div>
            </div>
            <div className="grid gap-3">
              <button
                className="primary-button w-full"
                type="button"
                disabled={Boolean(actionBusy) || !["VENDOR_OFFER_SENT", "VENDOR_ASSIGNED", "WORK_PAUSED"].includes(job.status)}
                onClick={() => void runJobAction(job.status === "WORK_PAUSED" ? "Resume work" : "Work started", () => apiPost<JobOperation>(`/operations/jobs/${job.id}/start`, session, {}))}
              >
                {actionBusy === "Work started" || actionBusy === "Resume work" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {job.status === "WORK_PAUSED" ? "Resume Work" : "Work Started"}
              </button>
              <button
                className="secondary-button w-full"
                type="button"
                disabled={Boolean(actionBusy) || job.status !== "WORK_STARTED"}
                onClick={() => void runJobAction("Pause work", () => apiPost<JobOperation>(`/operations/jobs/${job.id}/pause`, session, {}))}
              >
                {actionBusy === "Pause work" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Pause Work
              </button>
            </div>

            <div className="mt-4 rounded-md border border-white/10 bg-black/15 p-3">
              <div className="flex items-start gap-3">
                <Upload className="mt-0.5 h-5 w-5 text-cyan-200" />
                <div>
                  <div className="font-semibold">Proof Required</div>
                  <p className="mt-1 text-sm text-slate-300">Close work only after completed-work photo proof and a submitted checklist are saved.</p>
                </div>
              </div>

              <div className="mt-3 grid gap-3">
                <Field label="Photo Proof Type">
                  <select className="field" value={photoType} onChange={(event) => setPhotoType(event.target.value as JobPhotoType)}>
                    <option value="BEFORE_WORK">Before Work</option>
                    <option value="ISSUE_PHOTO">Issue Photo</option>
                    <option value="COMPLETED_WORK">Completed Work</option>
                    <option value="CUSTOMER_CONFIRMATION">Customer Confirmation</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>
                <label className="secondary-button w-full cursor-pointer justify-center">
                  <Upload className="h-4 w-4" />
                  {photoFileName || "Choose Proof File"}
                  <input className="hidden" type="file" accept="image/*,video/*,.pdf" onChange={(event) => setPhotoFileName(event.target.files?.[0]?.name ?? "")} />
                </label>
                <Field label="Proof Notes">
                  <textarea className="field min-h-20" value={photoNotes} onChange={(event) => setPhotoNotes(event.target.value)} placeholder="Short note about this proof." />
                </Field>
                <button
                  className="secondary-button w-full"
                  type="button"
                  disabled={Boolean(actionBusy) || !canSaveProof || !photoFileName}
                  onClick={() =>
                    void runJobAction(
                      "Save photo proof",
                      () =>
                        apiPost<JobOperation>(`/operations/jobs/${job.id}/photos`, session, {
                          type: photoType,
                          fileName: photoFileName,
                          notes: photoNotes,
                        }),
                      () => {
                        setPhotoFileName("");
                        setPhotoNotes("");
                      },
                    )
                  }
                >
                  {actionBusy === "Save photo proof" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Save Photo Proof
                </button>
              </div>

              {job.photos.length ? (
                <div className="mt-3 space-y-2">
                  {job.photos.slice(0, 4).map((photo) => (
                    <div key={photo.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                      <div className="font-semibold text-slate-100">{formatEnum(photo.type)} - {photo.fileName}</div>
                      <div className="mt-1 text-slate-400">{formatDateTime(photo.uploadedAt)}{photo.notes ? ` | ${photo.notes}` : ""}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <Field label="Checklist Type">
                  <select
                    className="field"
                    value={checklistType}
                    onChange={(event) => {
                      const nextType = event.target.value as JobChecklistType;
                      const existingChecklist = job.checklists.find((checklist) => checklist.type === nextType);
                      setChecklistType(nextType);
                      setChecklistItems(existingChecklist?.items.length ? existingChecklist.items : defaultJobChecklistItems(nextType));
                    }}
                  >
                    <option value="INSTALLATION">Installation Checklist</option>
                    <option value="REPAIR_SERVICE">Repair / Service Checklist</option>
                  </select>
                </Field>
                <div className="mt-3 space-y-2">
                  {checklistItems.map((item) => (
                    <label key={item.id} className="flex items-start gap-3 rounded-md border border-white/10 bg-black/15 px-3 py-2 text-sm">
                      <input className="mt-1" type="checkbox" checked={item.checked} onChange={(event) => updateChecklistItem(item.id, event.target.checked)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <button
                    className="secondary-button w-full"
                    type="button"
                    disabled={Boolean(actionBusy) || !canSaveProof}
                    onClick={() =>
                      void runJobAction("Save checklist", () =>
                        apiPost<JobOperation>(`/operations/jobs/${job.id}/checklist`, session, {
                          type: checklistType,
                          items: checklistItems,
                          submit: false,
                        }),
                      )
                    }
                  >
                    {actionBusy === "Save checklist" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                    Save Draft
                  </button>
                  <button
                    className="primary-button w-full"
                    type="button"
                    disabled={Boolean(actionBusy) || !canSaveProof || !checklistReady}
                    onClick={() =>
                      void runJobAction("Submit checklist", () =>
                        apiPost<JobOperation>(`/operations/jobs/${job.id}/checklist`, session, {
                          type: checklistType,
                          items: checklistItems,
                          submit: true,
                        }),
                      )
                    }
                  >
                    {actionBusy === "Submit checklist" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Submit Checklist
                  </button>
                </div>
                {submittedChecklist ? (
                  <p className="mt-3 text-xs font-semibold text-emerald-200">Checklist submitted at {submittedChecklist.submittedAt ? formatDateTime(submittedChecklist.submittedAt) : "saved time"}.</p>
                ) : (
                  <p className="mt-3 text-xs text-amber-200">Checklist is not submitted yet. Every item must be checked before closing.</p>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {!proofReady ? (
                <Notice
                  tone="warning"
                  title="Completion locked"
                  message="Save at least one Completed Work photo and submit the checklist before closing this won lead."
                />
              ) : null}
              <Field label="Completion Summary">
                <textarea className="field min-h-24" value={completionSummary} onChange={(event) => setCompletionSummary(event.target.value)} placeholder="What was completed, timing, customer confirmation, pending issue if any." />
              </Field>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <Field label="Vendor Bonus">
                  <input className="field" type="number" min="0" value={vendorBonusRs} onChange={(event) => setVendorBonusRs(event.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field label="Vendor Deduction">
                  <input className="field" type="number" min="0" value={vendorDeductionRs} onChange={(event) => setVendorDeductionRs(event.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>
              <button
                className="primary-button w-full"
                type="button"
                disabled={Boolean(actionBusy) || !["WORK_STARTED", "WORK_PAUSED"].includes(job.status) || !proofReady}
                onClick={() =>
                  void runJobAction("Complete work", () =>
                    apiPost<JobOperation>(`/operations/jobs/${job.id}/complete`, session, {
                      completionSummary,
                      vendorBonusRs: Number(vendorBonusRs || 0),
                      vendorDeductionRs: Number(vendorDeductionRs || 0),
                    }),
                  )
                }
              >
                {actionBusy === "Complete work" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                Complete & Save Certificate
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {job?.offers.length ? (
        <section className="mt-5 rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h3 className="font-semibold">Generated Vendor WhatsApp Offers</h3>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {job.offers.map((offer) => (
              <div key={offer.id} className="rounded-md border border-white/10 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{offer.vendorName}</div>
                    <div className="mt-1 text-xs text-cyan-200">Offer: Rs {paiseToRs(offer.offerPricePaise)}</div>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => window.open(whatsappRedirectUrl(offer.vendorPhone, offer.messageBody), "_blank", "noopener,noreferrer")}>
                    <Send className="h-4 w-4" />
                    WhatsApp
                  </button>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-md border border-white/10 bg-[#031023] p-3 text-xs leading-5 text-slate-200">{offer.messageBody}</pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {certificateRecords.length || job?.completionCertificateText ? (
        <section className="mt-5 rounded-md border border-emerald-300/20 bg-emerald-300/5 p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold text-emerald-100">
            <FileCheck2 className="h-5 w-5" />
            Saved Completion Certificates
          </div>
          {certificateRecords.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {certificateRecords.map((certificate) => (
                <div key={certificate.id} className="rounded-md border border-white/10 bg-[#031023] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{certificate.title}</div>
                      <div className="mt-1 text-xs text-emerald-200">{formatEnum(certificate.audience)} | {formatDateTime(certificate.issuedAt)}</div>
                    </div>
                    <span className="rounded-md border border-emerald-300/20 px-2 py-1 text-xs text-emerald-100">PDF ready</span>
                  </div>
                  <pre className="smooth-scroll mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-200">{certificate.bodyText}</pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="smooth-scroll max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#031023] p-4 text-sm leading-6 text-slate-200">{job?.completionCertificateText ?? ""}</pre>
          )}
        </section>
      ) : null}

      {job?.events.length ? (
        <section className="mt-5 rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h3 className="font-semibold">Operations History</h3>
          <div className="mt-3 space-y-2">
            {job.events.map((event) => (
              <div key={event.id} className="grid gap-2 rounded-md border border-white/10 bg-black/15 px-3 py-2 text-sm md:grid-cols-[170px_1fr]">
                <div className="text-cyan-200">{formatDateTime(event.createdAt)}</div>
                <div>
                  <span className="font-semibold">{formatEnum(event.type)}</span>
                  <span className="text-slate-300"> - {event.summary}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Panel>
  );
}

function resolveChecklistType(job: JobOperation): JobChecklistType {
  return job.jobType.toLowerCase().includes("repair") || job.jobType.toLowerCase().includes("service") ? "REPAIR_SERVICE" : "INSTALLATION";
}

function defaultJobChecklistItems(type: JobChecklistType): ChecklistItem[] {
  const labels =
    type === "REPAIR_SERVICE"
      ? [
          "Issue identified and explained",
          "Repair/service work completed",
          "Camera/system tested",
          "Customer informed about result",
          "Completed work photos uploaded",
          "Remaining issue mentioned if any",
        ]
      : [
          "Cameras installed",
          "DVR/NVR connected",
          "Power and display checked",
          "Recording checked",
          "Mobile view configured",
          "Completed work photos uploaded",
          "Customer shown basic usage",
          "Site cleaned",
        ];

  return labels.map((label, index) => ({
    id: `${type.toLowerCase()}-${index + 1}`,
    label,
    checked: false,
  }));
}

function StatusBadge({ label }: { label: string }) {
  return <span className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">{label}</span>;
}

function TimelineEventCard({ event, onInspect }: { event: LeadDetail["timeline"][number]; onInspect: () => void }) {
  const sections = timelineSections(event);

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-cyan-200">{formatEnum(event.type)}</div>
          <div className="mt-1 text-xs text-slate-400">{formatDateTime(event.createdAt)}</div>
        </div>
        <button
          className="grid h-8 w-8 place-items-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
          type="button"
          onClick={onInspect}
          title="View follow-up details"
        >
          <InfoIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {sections.slice(0, 4).map((section) => (
          <div key={`${event.id}-${section.label}`} className="rounded-md border border-white/10 bg-black/15 px-3 py-2">
            <div className="text-[11px] uppercase text-slate-500">{section.label}</div>
            <div className="mt-1 text-sm text-slate-100">{section.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineDetailTab({ event, onClose }: { event: LeadDetail["timeline"][number]; onClose: () => void }) {
  const sections = timelineSections(event);

  return (
    <section className="sticky top-20 z-20 rounded-md border border-cyan-300/30 bg-[#071a33] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase text-cyan-200">{formatEnum(event.type)}</div>
          <h2 className="mt-1 text-xl font-semibold">Follow-up Details</h2>
          <p className="mt-1 text-sm text-slate-300">{formatDateTime(event.createdAt)}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          <X className="h-4 w-4" />
          Close
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <Info key={section.label} label={section.label} value={section.value} />
        ))}
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-300">
        {event.summary || "No extra detail was saved for this event."}
      </div>
    </section>
  );
}

function timelineSections(event: LeadDetail["timeline"][number]): Array<{ label: string; value: string }> {
  const summary = event.summary || "";
  const sections: Array<{ label: string; value: string }> = [];

  if (summary.startsWith("Spoke.")) {
    sections.push({ label: "Call Outcome", value: "Spoke" });
  } else if (summary.startsWith("Warm lead marked.")) {
    sections.push({ label: "Call Outcome", value: "Warm / nurture" });
  } else if (summary.startsWith("Not interested.")) {
    sections.push({ label: "Call Outcome", value: "Not Interested" });
  } else if (summary.startsWith("Wrong number.")) {
    sections.push({ label: "Call Outcome", value: "Wrong Number" });
  } else if (summary.startsWith("Not receiving")) {
    sections.push({ label: "Call Outcome", value: "Not Receiving" });
  }

  const intent = summary.match(/Intent: ([A-Z_]+)/);
  if (intent) {
    sections.push({ label: "Lead Intent", value: formatEnum(intent[1]) });
  }

  const reason = summary.match(/Reason: ([A-Z_]+)/);
  if (reason) {
    sections.push({ label: "Follow-up Reason", value: formatEnum(reason[1]) });
  }

  const conversation = summary.match(/Summary: ([\s\S]*?)(?=\. (?:Site visit|Stage changed|Intent changed|Quotation saved|Won details|WhatsApp draft|Upload noted|Lost reason|Next nurture)|$)/);
  if (conversation?.[1]) {
    sections.push({ label: "Call Summary", value: conversation[1].trim() });
  }

  const stageChange = summary.match(/Stage changed from ([A-Z_]+) to ([A-Z_]+)/);
  if (stageChange) {
    sections.push({ label: "Stage Change", value: `${formatEnum(stageChange[1])} -> ${formatEnum(stageChange[2])}` });
  }

  const intentChange = summary.match(/Intent changed from ([A-Z_]+) to ([A-Z_]+)/);
  if (intentChange) {
    sections.push({ label: "Intent Change", value: `${formatEnum(intentChange[1])} -> ${formatEnum(intentChange[2])}` });
  }

  const siteVisitCompleted = summary.match(/Site visit completed\. Outcome: ([\s\S]*?)(?=\. (?:Stage changed|Intent changed|Quotation saved|Won details|WhatsApp draft|Upload noted)|$)/);
  if (siteVisitCompleted?.[1]) {
    sections.push({ label: "Site Visit Outcome", value: siteVisitCompleted[1].trim() });
  }

  const siteVisitMissed = summary.match(/Site visit not completed\. Reason: ([\s\S]*?)(?=\. (?:Stage changed|Intent changed|Quotation saved|Won details|WhatsApp draft|Upload noted)|$)/);
  if (siteVisitMissed?.[1]) {
    sections.push({ label: "Visit Not Completed", value: siteVisitMissed[1].trim() });
  }

  const lostReason = summary.match(/Lost reason: ([\s\S]*?)(?=\. Site visit|$)/);
  if (lostReason?.[1]) {
    sections.push({ label: "Lost Reason", value: lostReason[1].trim() });
  }

  const quotation = summary.match(/Quotation saved with total Rs ([0-9]+)/);
  if (quotation) {
    sections.push({ label: "Quotation Total", value: `Rs ${quotation[1]}` });
  }

  const won = summary.match(/Won details saved with accepted price Rs ([0-9]+)/);
  if (won) {
    sections.push({ label: "Won Accepted Price", value: `Rs ${won[1]}` });
  }

  const nurture = summary.match(/Next nurture follow-up at ([^.]+)/);
  if (nurture) {
    sections.push({ label: "Next Nurture Follow-up", value: formatDateTime(nurture[1]) });
  }

  if (summary.includes("WhatsApp draft saved")) {
    sections.push({ label: "WhatsApp", value: "Draft saved for manual sending" });
  }

  const upload = summary.match(/Upload noted: ([^.]+)/);
  if (upload) {
    sections.push({ label: "Upload", value: upload[1] });
  }

  if (!sections.length) {
    sections.push({ label: "History", value: summary || "No details saved." });
  }

  return sections;
}

function localDateTimeToIso(date: string, time: string): string | undefined {
  if (!date || !time) {
    return undefined;
  }

  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function defaultLocalDateTime(daysFromNow: number): { date: string; time: string } {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(10, 0, 0, 0);
  return {
    date: toDateInput(date.toISOString()),
    time: toTimeInput(date.toISOString()),
  };
}

function toDateInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function toTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toTimeString().slice(0, 5);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function paiseToRs(value: number): number {
  return Math.round(value / 100);
}

function makeUiId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeQuotationItem(): UiQuotationItem {
  return {
    id: makeUiId(),
    itemName: "",
    unitPriceRs: "",
    quantity: "1",
  };
}

function makeQuotationPackage(packageName = "Package"): UiQuotationPackage {
  return {
    id: makeUiId(),
    packageName,
    multiplier: 1,
    items: [makeQuotationItem()],
  };
}

function quotationFromLead(lead: LeadDetail): UiQuotationPackage[] {
  if (!lead.latestQuotation) {
    return [makeQuotationPackage("Package 1")];
  }

  return lead.latestQuotation.packages.map((pkg) => ({
    id: makeUiId(),
    packageName: pkg.packageName,
    multiplier: pkg.multiplier,
    items: pkg.items.map((item) => ({
      id: makeUiId(),
      itemName: item.itemName,
      unitPriceRs: String(paiseToRs(item.unitPricePaise)),
      quantity: String(item.quantity),
    })),
  }));
}

function lineTotalRs(pkg: UiQuotationPackage, item: UiQuotationItem): number {
  return Number(item.unitPriceRs || 0) * Number(item.quantity || 1) * pkg.multiplier;
}

function packageTotalRs(pkg: UiQuotationPackage): number {
  return pkg.items.reduce((total, item) => total + lineTotalRs(pkg, item), 0);
}

function generateWhatsAppDraft({
  lead,
  intent,
  followUpReason,
  conversationSummary,
  siteVisitStatus,
}: {
  lead: LeadDetail;
  intent: SaveCallOutcomeInput["leadIntent"] | "";
  followUpReason: SaveCallOutcomeInput["followUpReason"] | "";
  conversationSummary: string;
  siteVisitStatus: SaveCallOutcomeInput["siteVisitStatus"] | "";
}): string {
  const need = intent ? formatEnum(intent).toLowerCase() : "CCTV requirement";
  const reason = followUpReason ? formatEnum(followUpReason).toLowerCase() : "follow-up";
  const visitLine = followUpReason === "SITE_VISIT" && siteVisitStatus === "SCHEDULED" ? "We have noted the site visit schedule and will coordinate accordingly." : "";
  const summaryLine = conversationSummary.trim() ? `As discussed: ${conversationSummary.trim()}` : "As discussed on call, we will proceed with the next step.";

  return `Hello ${lead.customerName}, this is CI4U. ${summaryLine}\n\nNext step: ${reason} for your ${need}. ${visitLine}\n\nThank you,\nCI4U Team`;
}

function whatsappRedirectUrl(phoneNormalized: string, message: string): string {
  const phone = phoneNormalized.replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function queueTitle(queue: LeadQueue): string {
  const titles: Record<LeadQueue, string> = {
    RAW: "Raw Leads",
    WARM: "Warm Leads",
    HOT_INSTALLATION: "Hot Installation Leads",
    HOT_REPAIR_SERVICE: "Repair / Service Leads",
    UNANSWERED: "Unanswered Leads",
    GHOSTING: "Ghosting Leads",
    WON: "Won Leads",
    LOST: "Lost Leads",
    ARCHIVE: "Trash / Archive",
  };

  return titles[queue];
}

function normalizeOutcomeOptions(options: string[], lead: LeadDetail): string[] {
  if (lead.currentStage === "CAPTURED_WON") {
    return [];
  }

  const next = options.includes("WARM")
    ? [...options]
    : options.flatMap((option) => (option === "SPOKE" ? ["SPOKE", "WARM"] : [option]));

  return Array.from(new Set(next));
}

function leadDetailToListItem(lead: LeadDetail): RawLeadListItem {
  return {
    id: lead.id,
    customerId: lead.customerId,
    customerName: lead.customerName,
    phoneNormalized: lead.phoneNormalized,
    source: lead.source,
    currentStage: lead.currentStage,
    currentIntent: lead.currentIntent,
    priority: lead.priority,
    nextFollowUpAt: lead.nextFollowUpAt,
    followUpReason: lead.followUpReason,
    notReceivingCount: lead.notReceivingCount,
    assignedToName: lead.assignedToName,
    lastActivitySummary: lead.lastActivitySummary,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function currentQueueForLead(lead: LeadDetail): LeadQueue {
  if (lead.isArchived) {
    return "ARCHIVE";
  }

  return queueForLeadListItem(lead);
}

function queueForLeadListItem(lead: Pick<RawLeadListItem, "currentStage">): LeadQueue {
  if (lead.currentStage === "WARM") {
    return "WARM";
  }

  if (lead.currentStage === "HOT_INSTALLATION") {
    return "HOT_INSTALLATION";
  }

  if (lead.currentStage === "HOT_REPAIR_SERVICE") {
    return "HOT_REPAIR_SERVICE";
  }

  if (lead.currentStage === "NOT_RECEIVING") {
    return "UNANSWERED";
  }

  if (lead.currentStage === "GHOSTING") {
    return "GHOSTING";
  }

  if (lead.currentStage === "CAPTURED_WON") {
    return "WON";
  }

  if (lead.currentStage === "LOST") {
    return "LOST";
  }

  return "RAW";
}

function getNextNotReceivingLabel(lead: Pick<LeadDetail, "notReceivingCount" | "currentIntent" | "currentStage">): string {
  if (lead.currentIntent === "INSTALLATION" || lead.currentIntent === "REPAIR_SERVICE" || lead.currentStage === "CAPTURED_WON") {
    return lead.notReceivingCount === 0 ? "3 hours" : "24 hours";
  }

  const labels = ["3 hours", "24 hours", "72 hours", "1 week", "1 month", "3 months"];
  return labels[lead.notReceivingCount] ?? "final archive";
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.035] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-200">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function Notice({ tone, title, message }: { tone: "success" | "warning" | "danger"; title: string; message: string }) {
  const classes = {
    success: "border-emerald-300/30 bg-emerald-400/10 text-emerald-50",
    warning: "border-orange-300/30 bg-orange-400/10 text-orange-50",
    danger: "border-red-300/30 bg-red-400/10 text-red-50",
  };

  return (
    <div className={`mt-4 rounded-md border p-4 ${classes[tone]}`}>
      <div className="flex items-start gap-3">
        {tone === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
        <div>
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-sm opacity-90">{message}</div>
        </div>
      </div>
    </div>
  );
}

function LoadingBar() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-300/20 bg-blue-400/10 px-4 py-3 text-sm text-blue-100">
      <Loader2 className="h-4 w-4 animate-spin" />
      Working...
    </div>
  );
}

function InlineProgress({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-blue-300/20 bg-blue-400/10 p-3 text-sm text-blue-100">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {message}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-300" />
      </div>
    </div>
  );
}

async function parseXlsx(file: File): Promise<Array<Array<unknown>>> {
  return readSheet(file);
}

async function parseCsv(file: File): Promise<Array<Array<string>>> {
  const text = await file.text();
  const rows: Array<Array<string>> = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  rows.push(row);
  return rows;
}

function mapRowsToLeadInputs(rows: Array<Array<unknown>>): ImportRowInput[] {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const [, ...dataRows] = nonEmptyRows;

  return dataRows
    .map((row, index) => ({
      rowNumber: index + 2,
      businessName: String(row[0] ?? "").trim() || null,
      phone: String(row[1] ?? "").trim() || null,
    }))
    .filter((row) => row.businessName || row.phone);
}

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
