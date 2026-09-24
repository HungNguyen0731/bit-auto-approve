import { useState, useEffect, useCallback } from 'react';
import {
  ApprovalJob,
  ApprovalLogEntry,
  BitbucketUserProfile,
  CreateJobDto,
  JobFilterRules,
  MaskedConnectionConfig,
  SchedulerStatus,
  ToastMessage,
  VerifyTokenRequest,
  VerifyTokenResponse,
  WorkerLogEntry,
  WorkerRecord,
} from './types';
import { api, encryptTokenForWorker } from './api/client';
import { useSseEvents } from './api/sse';
import { Header } from './components/Header';
import { OnboardingGatekeeper } from './components/OnboardingGatekeeper';
import { StatsOverview } from './components/StatsOverview';
import { TokenCard } from './components/TokenCard';
import { JobList } from './components/JobList';
import { JobFormModal } from './components/JobFormModal';
import { RunJobModal, type ManualRunCredential } from './components/RunJobModal';
import { RulePreviewModal } from './components/RulePreviewModal';
import { ActionLogTable } from './components/ActionLogTable';
import { ToastContainer } from './components/Toast';
import { BitbucketMark, VisualArtwork } from './components/VisualArtwork';
import { WorkerSetup } from './components/WorkerSetup';
import { WorkerExecutionLog } from './components/WorkerExecutionLog';
import { OwnerLogin } from './components/OwnerLogin';
import {
  Activity,
  Key,
  Loader2,
  Laptop,
  Sliders,
  ShieldAlert,
} from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'jobs' | 'workers' | 'settings'>('dashboard');

  // Status & Data
  const [status, setStatus] = useState<SchedulerStatus>({
    isRunning: false,
    activeJobsCount: 0,
    totalJobsCount: 0,
    lastExecutionAt: undefined,
    vpnConnected: false,
    bitbucketStatus: 'UNCONFIGURED',
    totalApprovedCount: 0,
    uptimeSeconds: 0,
  });

  const [config, setConfig] = useState<MaskedConnectionConfig | null>(null);
  const [jobs, setJobs] = useState<ApprovalJob[]>([]);
  const [logs, setLogs] = useState<ApprovalLogEntry[]>([]);
  const [runningJobIds, setRunningJobIds] = useState<Set<string>>(new Set());
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [workerLogs, setWorkerLogs] = useState<WorkerLogEntry[]>([]);

  // Persistent User Profile
  const [userProfile, setUserProfile] = useState<BitbucketUserProfile | null>(null);
  const [isOnboardingManual, setIsOnboardingManual] = useState<boolean>(false);

  // UI state
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [ownerAuthenticated, setOwnerAuthenticated] = useState<boolean | null>(null);
  const [ownerSessionVersion, setOwnerSessionVersion] = useState(0);
  const [isTestingToken, setIsTestingToken] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isSavingJob, setIsSavingJob] = useState<boolean>(false);

  // Modals
  const [isJobModalOpen, setIsJobModalOpen] = useState<boolean>(false);
  const [editingJob, setEditingJob] = useState<ApprovalJob | null>(null);
  const [runJobId, setRunJobId] = useState<string | null>(null);
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [previewRules, setPreviewRules] = useState<JobFilterRules | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (type: ToastMessage['type'], title: string, message?: string) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Fetch all initial data
  const loadData = useCallback(async (): Promise<MaskedConnectionConfig | null> => {
    setIsRefreshing(true);
    try {
      const [s, c, j, l] = await Promise.all([
        api.getStatus(),
        api.getConfig(),
        api.getJobs(),
        api.getLogs({ limit: 50 }),
      ]);
      setStatus(s);
      setConfig(c);
      setJobs(Array.isArray(j) ? j : ((j as any)?.items ?? []));
      setLogs(Array.isArray(l) ? l : ((l as any)?.items ?? []));
      return c;
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const loadWorkerData = useCallback(async () => {
    try {
      const [workerItems, logItems] = await Promise.all([
        api.getWorkers(),
        api.getWorkerLogs({ limit: 300 }),
      ]);
      setWorkers(workerItems);
      setWorkerLogs(logItems);
    } catch (error) {
      console.warn('Worker control plane data is unavailable:', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        await api.getOwnerSession();
        if (cancelled) return;
        setOwnerAuthenticated(true);
      } catch {
        if (!cancelled) {
          setOwnerAuthenticated(false);
          setIsRestoringSession(false);
        }
        return;
      }

      const storedConfig = await loadData();
      if (cancelled) return;
      await loadWorkerData();

      if (!storedConfig?.hasToken) {
        setIsRestoringSession(false);
        return;
      }

      try {
        const restored = await api.restoreSession(storedConfig.workspace);
        if (cancelled) return;
        setUserProfile(restored.user);
        setStatus((prev) => ({
          ...prev,
          bitbucketStatus: 'CONNECTED',
          vpnConnected: restored.user.vpnConnected,
        }));
      } catch (err) {
        if (!cancelled) {
          console.warn('Stored Bitbucket session could not be restored:', err);
        }
      } finally {
        if (!cancelled) setIsRestoringSession(false);
      }
    };

    initialize();
    return () => {
      cancelled = true;
    };
  }, [loadData, loadWorkerData, ownerSessionVersion]);

  // Real-time SSE event listener
  const { connected: sseConnected } = useSseEvents({
    onLogEntry: (newLog) => {
      setLogs((prev) => [newLog, ...prev.slice(0, 99)]);
      if (newLog.status === 'APPROVED') {
        setStatus((prev) => ({
          ...prev,
          totalApprovedCount: prev.totalApprovedCount + 1,
        }));
        addToast('success', `PR Approved: #${newLog.prId}`, newLog.prTitle);
      } else if (newLog.status === 'DRY_RUN') {
        addToast('info', `[Dry Run] Matched PR: #${newLog.prId}`, newLog.prTitle);
      }
    },
    onStatusChange: (newStatus) => {
      setStatus(newStatus);
    },
    onWorkerStatusChange: (changed) => {
      const workerId = changed.id || changed.workerId;
      if (!workerId) return;
      setWorkers((current) =>
        current.map((worker) => (worker.id === workerId ? { ...worker, ...changed } : worker))
      );
    },
    onWorkerLogBatch: (items) => {
      setWorkerLogs((current) => {
        const byId = new Map([...items, ...current].map((item) => [item.id, item]));
        return [...byId.values()]
          .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
          .slice(0, 300);
      });
    },
    onExecutionCompleted: () => {
      loadWorkerData();
    },
  });

  // Token testing
  const handleTestConnection = async (req: VerifyTokenRequest) => {
    setIsTestingToken(true);
    try {
      const res: VerifyTokenResponse = await api.verifyToken(req);
      if (res.valid) {
        addToast(
          'success',
          'Bitbucket Connection Verified',
          `Logged in as ${res.user.displayName} (@${res.user.username})`
        );
        setUserProfile(res.user);
        setStatus((prev) => ({
          ...prev,
          bitbucketStatus: 'CONNECTED',
          vpnConnected: res.user.vpnConnected,
        }));
      }
      return res.user;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      addToast('error', 'Bitbucket Connection Failed', msg);
      throw err;
    } finally {
      setIsTestingToken(false);
    }
  };

  // Save config
  const handleSaveConfig = async (req: Partial<VerifyTokenRequest>) => {
    setIsSavingConfig(true);
    try {
      const updated = await api.updateConfig(req);
      setConfig(updated);
      addToast('success', 'Configuration Saved', 'Encrypted Bitbucket credentials updated.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      addToast('error', 'Failed to Save Configuration', msg);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Toggle Master Scheduler
  const handleToggleScheduler = async (enabled: boolean) => {
    try {
      const updated = await api.toggleScheduler(enabled);
      setStatus(updated);
      addToast(
        enabled ? 'success' : 'warning',
        enabled ? 'Scheduler Started' : 'Scheduler Paused',
        enabled
          ? 'Background runner is actively checking Pull Requests.'
          : 'PR approvals paused.'
      );
    } catch (err) {
      addToast('error', 'Scheduler Toggle Failed', String(err));
    }
  };

  // Toggle single job
  const handleToggleJob = async (id: string) => {
    try {
      const updated = await api.toggleJob(id);
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
      setStatus((prev) => ({
        ...prev,
        activeJobsCount: jobs.map((j) => (j.id === id ? updated : j)).filter((j) => j.enabled)
          .length,
      }));
      addToast(
        updated.enabled ? 'success' : 'info',
        `Job ${updated.enabled ? 'Resumed' : 'Paused'}`,
        updated.name
      );
    } catch (err) {
      addToast('error', 'Error toggling job', String(err));
    }
  };

  // Run job now
  const handleRunNow = async (id: string, credential: ManualRunCredential) => {
    setRunningJobIds((prev) => new Set(prev).add(id));
    setIsSubmittingRun(true);
    try {
      const job = jobs.find((item) => item.id === id);
      if (!job) throw new Error('Selected job is no longer available');
      if (!window.isSecureContext) throw new Error('Sending a Bitbucket token requires HTTPS or localhost.');
      let payload: { username?: string; token?: string; tokenCiphertext?: string } = { ...credential };
      if (job.executionMode === 'worker') {
        const worker = workers.find((item) => item.id === job.workerId);
        if (!worker?.publicKey) throw new Error('Assigned Worker is unavailable. Check Worker connection.');
        if (!window.isSecureContext || !crypto?.subtle) throw new Error('Worker token encryption requires HTTPS or localhost.');
        payload = { username: credential.username, tokenCiphertext: await encryptTokenForWorker(worker.publicKey, credential.token) };
      }
      const res = await api.runJobNow(id, payload);
      addToast('info', 'Job Triggered', res.message || `Job “${job.name}” has been queued.`);
      setTimeout(() => {
        loadData();
      }, 1000);
    } catch (err) {
      addToast('error', 'Run Failed', String(err));
      throw err;
    } finally {
      setIsSubmittingRun(false);
      setTimeout(() => {
        setRunningJobIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1500);
    }
  };

  // Job deletion
  const handleDeleteJob = async (id: string) => {
    const target = jobs.find((j) => j.id === id);
    if (!window.confirm(`Are you sure you want to delete job "${target?.name || id}"?`)) {
      return;
    }

    try {
      await api.deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      setStatus((prev) => ({
        ...prev,
        totalJobsCount: prev.totalJobsCount - 1,
        activeJobsCount: jobs.filter((j) => j.id !== id && j.enabled).length,
      }));
      addToast('info', 'Job Deleted', target?.name);
    } catch (err) {
      addToast('error', 'Delete Job Failed', String(err));
    }
  };

  // Save / Update job modal submit
  const handleSaveJob = async (dto: CreateJobDto, jobId?: string) => {
    setIsSavingJob(true);
    try {
      if (jobId) {
        const updated = await api.updateJob(jobId, dto);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
        addToast('success', 'Job Updated', updated.name);
      } else {
        const created = await api.createJob(dto);
        setJobs((prev) => [created, ...prev]);
        setStatus((prev) => ({
          ...prev,
          totalJobsCount: prev.totalJobsCount + 1,
          activeJobsCount: prev.activeJobsCount + (created.enabled ? 1 : 0),
        }));
        addToast('success', 'Job Created', created.name);
      }
      setIsJobModalOpen(false);
      setEditingJob(null);
    } catch (err) {
      addToast('error', 'Save Job Failed', String(err));
    } finally {
      setIsSavingJob(false);
    }
  };

  // Clear all logs
  const handleClearLogs = async () => {
    if (!window.confirm('Clear all approval action logs?')) return;
    try {
      await api.clearLogs();
      setLogs([]);
      addToast('info', 'Logs Cleared', 'Approval history has been reset.');
    } catch (err) {
      addToast('error', 'Failed to clear logs', String(err));
    }
  };

  // Open Preview rules modal
  const handleOpenPreview = (rules: JobFilterRules) => {
    setPreviewRules(rules);
    setIsPreviewOpen(true);
  };

  // Existing jobs remain available for manual runs even without a configured scheduled token.
  const showGatekeeper = isOnboardingManual || ((!config?.hasToken || !userProfile) && jobs.length === 0);

  if (ownerAuthenticated === false) {
    return (
      <OwnerLogin
        onAuthenticated={() => {
          setOwnerAuthenticated(true);
          setIsRestoringSession(true);
          setOwnerSessionVersion((current) => current + 1);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 soft-canvas text-app-ink flex flex-col selection:bg-brand-200 selection:text-brand-900">
      {/* Top Header */}
      <Header
        status={status}
        sseConnected={sseConnected}
        onToggleScheduler={handleToggleScheduler}
        onRefresh={loadData}
        isRefreshing={isRefreshing}
        userProfile={userProfile}
        onSwitchAccount={() => setIsOnboardingManual(true)}
        onOpenSettings={() => {
          setIsOnboardingManual(false);
          setActiveTab('settings');
        }}
      />

      {isRestoringSession ? (
        <main className="flex-1 min-h-[calc(100dvh-8rem)] flex items-center justify-center px-4 py-10" aria-live="polite" aria-busy="true">
          <div className="w-full max-w-lg rounded-[28px] border border-white/80 bg-app-panel/95 p-7 text-center shadow-float backdrop-blur-xl">
            <VisualArtwork variant="verification" className="mx-auto w-full max-w-xs" />
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 text-xs font-semibold text-brand-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              Restoring secure Bitbucket session
            </div>
            <p className="mt-3 text-xs leading-5 text-app-muted">
              Checking the configured Bitbucket session. Manual tokens are remembered in this browser only if you opt in.
            </p>
          </div>
        </main>
      ) : showGatekeeper ? (
        <OnboardingGatekeeper
          initialConfig={config}
          onTestConnection={handleTestConnection}
          onSaveConfig={handleSaveConfig}
          onComplete={(savedConfig, profile) => {
            setConfig(savedConfig);
            if (profile) setUserProfile(profile);
            setIsOnboardingManual(false);
            addToast(
              'success',
              'Bitbucket Connected',
              `Welcome ${profile?.displayName || 'Developer'}! Dashboard unlocked.`
            );
            loadData();
          }}
          
          isTesting={isTestingToken}
          isSaving={isSavingConfig}
        />
      ) : (
        /* Main Container */
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
        {/* Visual automation overview */}
        <section className="relative overflow-hidden rounded-[28px] bg-brand-900 text-white shadow-float">
          <div className="visual-grid absolute inset-0 opacity-20" aria-hidden="true" />
          <div className="relative grid lg:grid-cols-[1.2fr_0.8fr] items-center">
            <div className="p-6 sm:p-8 lg:p-10">
              <div className="flex items-center gap-3">
                {userProfile?.avatarUrl ? (
                  <img
                    src={userProfile.avatarUrl}
                    alt=""
                    className="h-11 w-11 rounded-2xl border-2 border-white/20 object-cover shadow-lg"
                  />
                ) : (
                  <div className="h-11 w-11 rounded-2xl bg-brand-500 inline-flex items-center justify-center shadow-lg">
                    <BitbucketMark className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">Automation control room</span>
                  <p className="text-sm font-semibold text-white">{userProfile?.displayName || 'Bitbucket Cloud workspace'}</p>
                </div>
              </div>
              <h2 className="mt-6 max-w-2xl text-2xl sm:text-3xl font-bold leading-tight tracking-tight">
                Pull requests move through one visible, accountable pipeline.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100/75">
                Watch live evaluations, confirm matching rules, and keep every automated approval tied to a real Bitbucket identity.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">{status.activeJobsCount} active jobs</span>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">{status.totalApprovedCount} approved PRs</span>
                <span className={`rounded-full border px-3 py-1.5 ${sseConnected ? 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100' : 'border-amber-300/30 bg-amber-400/15 text-amber-100'}`}>
                  {sseConnected ? 'Live events connected' : 'Event stream connecting'}
                </span>
              </div>
            </div>
            <div className="relative min-h-[15rem] self-stretch bg-gradient-to-br from-brand-700/40 to-brand-950/30 px-3 sm:px-8 lg:px-2 flex items-center">
              <VisualArtwork variant="automation" className="mx-auto w-full max-w-lg translate-y-2" />
            </div>
          </div>
        </section>

        {/* Network & VPN Alert Banner if VPN disconnected */}
        {!status.vpnConnected && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-soft">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600" />
            <div className="flex-1 text-xs">
              <h4 className="font-bold text-sm text-rose-900">
                Corporate VPN or IP Whitelist Required
              </h4>
              <p className="mt-0.5 text-rose-700 leading-relaxed">
                Bitbucket server at <code className="font-mono bg-rose-100 px-1 py-0.5 rounded text-rose-900">{config?.baseUrl || 'configured URL'}</code> cannot be reached. Outbound PR approval requests will fail until your VPN tunnel is established.
              </p>
            </div>
          </div>
        )}

        {/* High-Level Stats Overview */}
        <StatsOverview status={status} />

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-app-line bg-app-panel/90 p-1.5 shadow-soft overflow-x-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`min-h-11 flex shrink-0 items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] ${
              activeTab === 'dashboard'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-app-muted hover:text-app-ink hover:bg-brand-50'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Activity</span>
          </button>

          <button
            onClick={() => setActiveTab('jobs')}
            className={`min-h-11 flex shrink-0 items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] ${
              activeTab === 'jobs'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-app-muted hover:text-app-ink hover:bg-brand-50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Approval jobs ({jobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`min-h-11 flex shrink-0 items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] ${
              activeTab === 'settings'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-app-muted hover:text-app-ink hover:bg-brand-50'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Connection</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('workers');
              loadWorkerData();
            }}
            className={`min-h-11 flex shrink-0 items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] ${
              activeTab === 'workers'
                ? 'bg-brand-700 text-white shadow-sm'
                : 'text-app-muted hover:text-app-ink hover:bg-brand-50'
            }`}
          >
            <Laptop className="w-4 h-4" />
            <span>Local Workers ({workers.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Quick Jobs Preview Widget */}
            <div className="rounded-2xl bg-app-panel border border-app-line p-5 shadow-soft">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-app-ink flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-400" />
                  Approval jobs
                </h3>
                <button
                  onClick={() => setActiveTab('jobs')}
                  className="text-xs text-brand-700 hover:text-brand-800 font-semibold"
                >
                  Manage jobs
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(Array.isArray(jobs) ? jobs : []).length === 0 && (
                  <div className="sm:col-span-2 lg:col-span-3 grid sm:grid-cols-[12rem_1fr] items-center gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/55 px-5 py-3">
                    <VisualArtwork variant="empty-jobs" className="hidden sm:block w-full" />
                    <div className="py-4 text-center sm:text-left">
                      <p className="text-sm font-bold text-app-ink">Build your first approval route</p>
                      <p className="mt-1 text-xs leading-5 text-app-muted">Choose repositories, branches, and authors, then preview the exact PRs your rules will match.</p>
                      <button onClick={() => setActiveTab('jobs')} className="mt-3 min-h-11 rounded-xl bg-brand-700 px-4 text-xs font-semibold text-white hover:bg-brand-800">Create approval job</button>
                    </div>
                  </div>
                )}
                {(Array.isArray(jobs) ? jobs : []).map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-xl bg-app-panel-muted border border-app-line flex flex-col justify-between gap-3 transition-colors hover:border-brand-300"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-app-ink truncate max-w-[220px] flex items-center gap-2">
                          <span className="h-7 w-7 flex-shrink-0 rounded-lg bg-brand-500 text-white inline-flex items-center justify-center"><BitbucketMark className="h-3.5 w-3.5" /></span>
                          <span className="truncate">{job.name}</span>
                        </span>
                        <span
                          className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                            job.enabled
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {job.enabled ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </div>
                      <div className="text-[11px] text-app-muted mt-1 line-clamp-1 font-mono">
                        {job.rules.repositories.join(', ')}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-app-muted border-t border-app-line pt-2 font-mono">
                      <span>{job.dryRun ? 'Mode: Dry Run' : 'Mode: Live'}</span>
                      <span>Every {job.intervalSeconds}s</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real-time Action Log Table */}
            <ActionLogTable
              logs={logs}
              onClearLogs={handleClearLogs}
              onRefresh={loadData}
              isRefreshing={isRefreshing}
              sseConnected={sseConnected}
            />
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-6">
            {jobs.length > 0 && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setRunJobId(jobs[0].id)} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                  Select job &amp; run
                </button>
              </div>
            )}
            <JobList
              jobs={jobs}
              onToggleJob={handleToggleJob}
              onRunNow={setRunJobId}
              onEditJob={(job) => {
                setEditingJob(job);
                setIsJobModalOpen(true);
              }}
              onDeleteJob={handleDeleteJob}
              onPreviewRules={(job) => handleOpenPreview(job.rules)}
              onCreateJob={() => {
                setEditingJob(null);
                setIsJobModalOpen(true);
              }}
              runningJobIds={runningJobIds}
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-4xl">
            <TokenCard
              config={config}
              onTestConnection={handleTestConnection}
              onSaveConfig={handleSaveConfig}
              isTesting={isTestingToken}
              isSaving={isSavingConfig}
            />
          </div>
        )}

        {activeTab === 'workers' && (
          <div className="space-y-6">
            <WorkerSetup
              workers={workers}
              configHasToken={Boolean(config?.hasToken)}
              onRefresh={loadWorkerData}
            />
            <WorkerExecutionLog logs={workerLogs} workers={workers} />
          </div>
        )}
      </main>
      )}

      {/* Footer */}
      <footer className="border-t border-app-line py-4 bg-app-panel-muted/80 text-center text-xs text-app-muted font-mono">
        Bitbucket PR Approver  |  Local Cloud automation  |  127.0.0.1
      </footer>

      {/* Create / Edit Job Modal */}
      <JobFormModal
        isOpen={isJobModalOpen}
        onClose={() => {
          setIsJobModalOpen(false);
          setEditingJob(null);
        }}
        onSave={handleSaveJob}
        onPreview={handleOpenPreview}
        editingJob={editingJob}
        isSaving={isSavingJob}
        workers={workers}
      />

      {runJobId && (
        <RunJobModal
          key={runJobId}
          jobs={jobs}
          initialJobId={runJobId}
          busy={isSubmittingRun}
          onClose={() => setRunJobId(null)}
          onRun={handleRunNow}
        />
      )}

      {/* Rule Preview / Test Modal */}
      {previewRules && (
        <RulePreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          rules={previewRules}
        />
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
