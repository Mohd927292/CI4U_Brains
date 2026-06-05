"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Info as InfoIcon,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Menu,
  Plus,
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
  type CreateLeadResponse,
  type DevRole,
  type DevSession,
  type ImportCommitResult,
  type ImportPreviewResult,
  type ImportRowInput,
  type LeadDetail,
  type LeadQueue,
  type LeadSaveAck,
  type QueueCounts,
  type RawLeadListItem,
  type SaveCallOutcomeInput,
} from "../lib/ci4u-api";

const sessionStorageKey = "ci4u.devSession.v1";
const pendingLeadSavesStorageKey = "ci4u.pendingLeadSaves.v1";

const devUsers: Array<{ name: string; role: DevRole; label: string }> = [
  { name: "Rahul Verma", role: "FOUNDER", label: "Founder / full dev access" },
  { name: "Rachana Decos", role: "SALES_MANAGER", label: "Sales manager testing" },
  { name: "Sandeep Decos", role: "SALES_EXECUTIVE", label: "Sales executive testing" },
  { name: "Operations Dev", role: "OPERATIONS_MANAGER", label: "Operations workflow testing" },
];

type ActiveView = "dashboard" | "raw-leads" | "lead-detail";

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(sessionStorageKey);
      setSession(saved ? (JSON.parse(saved) as DevSession) : null);
      setSessionReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

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
    }, 0);

    return () => {
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
      }

      window.clearTimeout(pendingCountTimer);
      window.clearTimeout(timer);
    };
  }, [loadQueue, session]);

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
    const nextSession: DevSession = {
      userId: `dev-${user.role.toLowerCase()}`,
      name: user.name,
      role: user.role,
      dataScope: "development",
    };
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    void loadQueue("RAW", nextSession, { preferCache: true });
  }

  function logout() {
    window.localStorage.removeItem(sessionStorageKey);
    setSession(null);
    setSessionReady(true);
    setRawLeads([]);
    setQueueCounts(emptyQueueCounts);
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
    return <DevLogin onLogin={login} />;
  }

  return (
    <main className="min-h-screen bg-[#031023] text-white">
      <div className="flex min-h-screen">
        <aside className={`${sidebarOpen ? "lg:block" : "lg:hidden"} hidden w-[318px] shrink-0 border-r border-white/10 bg-[#020b19] px-4 py-5`}>
          <BrandBlock />
          <DevScopeCard session={session} onLogout={logout} />
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
          </nav>
        </aside>

        <section className="min-w-0 flex-1 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_36%),#031023]">
          <TopBar session={session} rawCount={queueCounts.RAW} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((value) => !value)} onLogout={logout} />
          <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
            {error ? <Notice tone="danger" title="Action blocked" message={error} /> : null}
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
            {activeView === "lead-detail" && selectedLead ? (
              <LeadDetailWorkspaceV2 key={selectedLead.id} lead={selectedLead} onSaveRequested={handleLeadUpdateRequested} onBack={() => setActiveView("raw-leads")} />
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

function DevLogin({ onLogin }: { onLogin: (user: (typeof devUsers)[number]) => void }) {
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
              onClick={() => onLogin(user)}
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

function DevScopeCard({ session, onLogout }: { session: DevSession; onLogout: () => void }) {
  return (
    <section className="rounded-md border border-cyan-300/20 bg-cyan-300/10 p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-950">
          <UserRound className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{session.name}</div>
          <div className="text-xs font-semibold uppercase text-cyan-200">{session.role.replaceAll("_", " ")}</div>
        </div>
      </div>
      <div className="mt-4 rounded-md border border-cyan-300/20 bg-black/20 px-3 py-2 text-xs text-cyan-100">
        DEV DATA ONLY
      </div>
      <button className="mt-3 text-sm font-semibold text-slate-200 hover:text-white" onClick={onLogout}>
        Switch dev user
      </button>
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
  sidebarOpen,
  onToggleSidebar,
  onLogout,
}: {
  session: DevSession;
  rawCount: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogout: () => void;
}) {
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
              Development workspace
            </span>
          </div>
          <p className="text-sm text-slate-300">
            {session.name} is testing with isolated dev data. Raw leads: {rawCount}
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
        <button className="relative grid h-11 w-11 place-items-center rounded-md border border-white/10 bg-white/5">
          <Bell className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold">
            0
          </span>
        </button>
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
  lead,
  onSaveRequested,
  onBack,
}: {
  lead: LeadDetail;
  onSaveRequested: (lead: LeadDetail, payload: SaveCallOutcomeInput) => void;
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
          <WonLeadOperationsPreview lead={lead} />
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

function WonLeadOperationsPreview({ lead }: { lead: LeadDetail }) {
  const details = lead.wonDetails;

  return (
    <Panel title="Won Lead Operations">
      <Notice
        tone="warning"
        title="Operations backend is the next controlled phase"
        message="This won lead will not show the normal call-outcome dialog. Vendor assignment, work start/pause/end, photos, and PDF certificates must be backed by job, vendor, file-storage, and audit tables before they become active."
      />

      {details ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Info label="Site Contact" value={details.siteContactNumber} />
          <Info label="Schedule" value={details.scheduledAt ? formatDateTime(details.scheduledAt) : formatEnum(details.scheduleStatus)} />
          <Info label="Quoted Price" value={`Rs ${paiseToRs(details.quotedPricePaise)}`} />
          <Info label="Accepted Price" value={`Rs ${paiseToRs(details.acceptedPricePaise)}`} />
          <Info label="Advance Payment" value={`Rs ${paiseToRs(details.advancePaymentPaise)}`} />
          <Info label="Scope" value={details.scopeOfWork} />
          <div className="md:col-span-2">
            <Info label="Location / Written Address" value={details.address} />
          </div>
        </div>
      ) : (
        <Notice tone="danger" title="Won details missing" message="This record is marked won but does not have won customer details. Fix this before operations starts." />
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <OperationStep title="Assign Work" text="Needs vendor database, offer price, and vendor WhatsApp message generation." />
        <OperationStep title="Work Started" text="Needs job status, timestamps, overdue notifications, and audit log." />
        <OperationStep title="Photos / Checklist" text="Needs protected storage and upload progress before mobile field usage." />
        <OperationStep title="Completion PDF" text="Needs certificate templates saved to customer and vendor history." />
      </div>
    </Panel>
  );
}

function OperationStep({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
      <div className="font-semibold text-cyan-100">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
      <button className="secondary-button mt-4 w-full opacity-60" type="button" disabled>
        Backend phase required
      </button>
    </div>
  );
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
