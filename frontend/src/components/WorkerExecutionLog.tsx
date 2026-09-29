import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Laptop,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  HelpCircle,
  GitBranch,
  GitPullRequest,
  GitMerge,
  ShieldCheck,
  Search,
  Activity,
  Loader2,
} from 'lucide-react';
import type { FlowStep, WorkerLogEntry, WorkerLogStatus, WorkerRecord } from '../types';

interface StepState {
  key: FlowStep;
  label: string;
  status: 'completed' | 'in_progress' | 'skipped' | 'failed' | 'pending';
  detail?: string;
}

function getFlowSteps(entry: WorkerLogEntry): StepState[] {
  const isPrEntry = Boolean(entry.prId || entry.prTitle);

  // Default timeline states
  let scanStatus: StepState['status'] = 'completed';
  let matchStatus: StepState['status'] = 'pending';
  let ciStatus: StepState['status'] = 'pending';
  let approveStatus: StepState['status'] = 'pending';
  let mergeStatus: StepState['status'] = 'pending';

  let scanDetail: string | undefined = entry.repository ? `Scanned ${entry.repository}` : undefined;
  let matchDetail: string | undefined;
  let ciDetail: string | undefined;
  let approveDetail: string | undefined;
  let mergeDetail: string | undefined;

  if (entry.status === 'SCANNING_REPO') {
    scanStatus = 'in_progress';
    scanDetail = 'Scanning open pull requests...';
  } else if (!isPrEntry) {
    // Non-PR transition (e.g. worker state change)
    scanStatus = entry.status === 'FAILED' ? 'failed' : 'completed';
  } else {
    // PR Flow Evaluation
    if (entry.status === 'MATCHING_PR') {
      scanStatus = 'completed';
      matchStatus = 'in_progress';
      matchDetail = 'Evaluating filter rules...';
    } else if (entry.status === 'CHECKING_CI') {
      scanStatus = 'completed';
      matchStatus = 'completed';
      matchDetail = 'Rules matched';
      ciStatus = 'in_progress';
      ciDetail = 'Querying commit build status...';
    } else if (entry.status === 'APPROVED') {
      scanStatus = 'completed';
      matchStatus = 'completed';
      matchDetail = 'Rules matched';
      ciStatus = 'completed';
      ciDetail = 'CI build successful';
      approveStatus = 'completed';
      approveDetail = 'Approved on Bitbucket';
    } else if (entry.status === 'MERGED') {
      scanStatus = 'completed';
      matchStatus = 'completed';
      matchDetail = 'Rules matched';
      ciStatus = 'completed';
      ciDetail = 'CI build successful';
      approveStatus = 'completed';
      approveDetail = 'Approved';
      mergeStatus = 'completed';
      mergeDetail = 'Auto-merge executed';
    } else if (entry.status === 'ALREADY_APPROVED') {
      scanStatus = 'completed';
      matchStatus = 'completed';
      matchDetail = 'Rules matched';
      ciStatus = 'completed';
      ciDetail = 'CI build successful';
      approveStatus = 'completed';
      approveDetail = 'Already approved by bot';
    } else if (entry.status === 'DRY_RUN') {
      scanStatus = 'completed';
      matchStatus = 'completed';
      matchDetail = 'Rules matched';
      ciStatus = 'skipped';
      ciDetail = 'Simulated';
      approveStatus = 'completed';
      approveDetail = 'Dry run - would approve';
    } else if (entry.status === 'SKIPPED') {
      if (entry.flowStep === 'CHECK_CI' || entry.failureReason?.toLowerCase().includes('ci')) {
        scanStatus = 'completed';
        matchStatus = 'completed';
        matchDetail = 'Rules matched';
        ciStatus = 'skipped';
        ciDetail = entry.failureReason || 'CI build pending or failed';
      } else {
        scanStatus = 'completed';
        matchStatus = 'skipped';
        matchDetail = entry.failureReason || 'Did not match filter rules';
      }
    } else if (entry.status === 'FAILED') {
      if (entry.flowStep === 'MERGE') {
        scanStatus = 'completed';
        matchStatus = 'completed';
        ciStatus = 'completed';
        approveStatus = 'completed';
        mergeStatus = 'failed';
        mergeDetail = entry.failureReason || 'Merge rejected';
      } else if (entry.flowStep === 'APPROVE') {
        scanStatus = 'completed';
        matchStatus = 'completed';
        ciStatus = 'completed';
        approveStatus = 'failed';
        approveDetail = entry.failureReason || 'Approval failed';
      } else {
        scanStatus = 'completed';
        matchStatus = 'failed';
        matchDetail = entry.failureReason || 'Evaluation failed';
      }
    }
  }

  return [
    { key: 'SCAN_REPO', label: '1. Scan Repo', status: scanStatus, detail: scanDetail },
    { key: 'MATCH_PR', label: '2. Match Rules', status: matchStatus, detail: matchDetail },
    { key: 'CHECK_CI', label: '3. Check CI', status: ciStatus, detail: ciDetail },
    { key: 'APPROVE', label: '4. Approve', status: approveStatus, detail: approveDetail },
    { key: 'MERGE', label: '5. Merge', status: mergeStatus, detail: mergeDetail },
  ];
}

const STATUS_BADGES: Record<
  WorkerLogStatus,
  { label: string; bg: string; text: string; border: string; icon: React.ComponentType<{ className?: string }> }
> = {
  APPROVED: { label: 'APPROVED', bg: 'bg-emerald-500/10', text: 'text-emerald-700', border: 'border-emerald-500/20', icon: CheckCircle2 },
  MERGED: { label: 'MERGED', bg: 'bg-emerald-500/10', text: 'text-emerald-700', border: 'border-emerald-500/20', icon: GitMerge },
  DRY_RUN: { label: 'DRY RUN', bg: 'bg-blue-500/10', text: 'text-brand-700', border: 'border-blue-500/20', icon: Eye },
  ALREADY_APPROVED: { label: 'ALREADY APPROVED', bg: 'bg-purple-500/10', text: 'text-violet-700', border: 'border-purple-500/20', icon: HelpCircle },
  SKIPPED: { label: 'SKIPPED', bg: 'bg-amber-500/10', text: 'text-amber-700', border: 'border-amber-500/20', icon: AlertCircle },
  FAILED: { label: 'FAILED', bg: 'bg-rose-500/10', text: 'text-rose-700', border: 'border-rose-500/20', icon: XCircle },
  PAUSED_VPN: { label: 'PAUSED VPN', bg: 'bg-orange-500/10', text: 'text-orange-700', border: 'border-orange-500/20', icon: AlertCircle },
  RESUMED: { label: 'RESUMED', bg: 'bg-teal-500/10', text: 'text-teal-700', border: 'border-teal-500/20', icon: CheckCircle2 },
  SCANNING_REPO: { label: 'SCANNING', bg: 'bg-cyan-500/10', text: 'text-cyan-700', border: 'border-cyan-500/20', icon: Loader2 },
  MATCHING_PR: { label: 'MATCHING', bg: 'bg-indigo-500/10', text: 'text-indigo-700', border: 'border-indigo-500/20', icon: Activity },
  CHECKING_CI: { label: 'CHECKING CI', bg: 'bg-sky-500/10', text: 'text-sky-700', border: 'border-sky-500/20', icon: ShieldCheck },
};

export const WorkerExecutionLog: React.FC<{
  logs: WorkerLogEntry[];
  workers: WorkerRecord[];
}> = ({ logs, workers }) => {
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const workerNames = new Map(workers.map((worker) => [worker.id, worker.name]));

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (status !== 'ALL' && entry.status !== status) return false;
      if (!query) return true;
      return [entry.repository, entry.prTitle, entry.author, entry.failureReason, entry.flowStep]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [logs, search, status]);

  return (
    <section className="overflow-hidden rounded-2xl border border-app-line bg-app-panel shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-line bg-app-panel-muted p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-app-ink">
            <Laptop className="h-4 w-4 text-brand-700" /> Realtime Worker Flow Log
          </h2>
          <p className="mt-1 text-xs text-app-muted">
            Theo dõi tiến trình trực quan theo từng bước (Scan → Match → CI → Approve → Merge) qua SSE realtime.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="min-h-11 rounded-xl border border-app-line bg-white px-3 text-xs text-slate-800 outline-none"
          >
            {[
              'ALL',
              'APPROVED',
              'MERGED',
              'SKIPPED',
              'DRY_RUN',
              'ALREADY_APPROVED',
              'CHECKING_CI',
              'MATCHING_PR',
              'SCANNING_REPO',
              'FAILED',
              'PAUSED_VPN',
            ].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="relative">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search repo, PR, author..."
              className="min-h-11 rounded-xl border border-app-line bg-white pl-8 pr-3 text-xs text-slate-800 outline-none"
            />
            <Search className="pointer-events-none absolute left-2.5 top-3.5 h-4 w-4 text-slate-400" />
          </div>
        </div>
      </div>

      <div className="divide-y divide-app-line">
        {visible.map((entry) => {
          const badge = STATUS_BADGES[entry.status] || {
            label: entry.status,
            bg: 'bg-slate-100',
            text: 'text-slate-700',
            border: 'border-slate-200',
            icon: Activity,
          };
          const BadgeIcon = badge.icon;
          const isExpanded = expanded === entry.id;
          const flowSteps = getFlowSteps(entry);

          return (
            <article key={entry.id} className="p-4 hover:bg-slate-50/50 transition-colors">
              <button
                onClick={() => setExpanded(isExpanded ? null : entry.id)}
                className="flex min-h-11 w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      <BadgeIcon className={`h-3 w-3 ${entry.status.startsWith('SCANNING') ? 'animate-spin' : ''}`} />
                      {badge.label}
                    </span>
                    <span className="truncate text-xs font-semibold text-app-ink">
                      {entry.repository || 'Worker internal event'}
                      {entry.prId ? ` #${entry.prId}` : ''}
                    </span>
                    {entry.prTitle && (
                      <span className="truncate text-xs text-slate-600 max-w-md hidden sm:inline">
                        — {entry.prTitle}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-app-muted">
                    {workerNames.get(entry.workerId) || entry.workerId}
                    {entry.author ? ` · Author: @${entry.author}` : ''} ·{' '}
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-slate-400">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>

              {/* Realtime Flow Timeline */}
              <div className="mt-3 overflow-x-auto pb-1">
                <div className="flex items-center gap-1 min-w-[540px]">
                  {flowSteps.map((step, idx) => {
                    const isLast = idx === flowSteps.length - 1;
                    const statusColors = {
                      completed: 'bg-emerald-500 text-white border-emerald-600 ring-emerald-100',
                      in_progress: 'bg-sky-500 text-white border-sky-600 ring-sky-100 animate-pulse',
                      skipped: 'bg-amber-400 text-amber-950 border-amber-500 ring-amber-100',
                      failed: 'bg-rose-500 text-white border-rose-600 ring-rose-100',
                      pending: 'bg-slate-100 text-slate-400 border-slate-200 ring-transparent',
                    }[step.status];

                    const connectorColor = {
                      completed: 'bg-emerald-500',
                      in_progress: 'bg-sky-400',
                      skipped: 'bg-amber-300',
                      failed: 'bg-rose-400',
                      pending: 'bg-slate-200',
                    }[step.status];

                    return (
                      <React.Fragment key={step.key}>
                        <div
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-all"
                          title={step.detail || step.label}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold ring-2 ${statusColors}`}
                          >
                            {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'skipped' ? '!' : idx + 1}
                          </span>
                          <span
                            className={`whitespace-nowrap ${
                              step.status === 'pending'
                                ? 'text-slate-400'
                                : step.status === 'in_progress'
                                ? 'text-sky-700 font-bold'
                                : step.status === 'failed'
                                ? 'text-rose-700 font-bold'
                                : 'text-slate-700 font-semibold'
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {!isLast && <div className={`h-0.5 w-4 flex-shrink-0 rounded-full ${connectorColor}`} />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-3 grid gap-3 rounded-xl bg-app-panel-muted p-3.5 text-xs md:grid-cols-2 animate-scale-in">
                  <div className="space-y-2">
                    <div>
                      <span className="font-semibold text-app-ink">Pull Request:</span>
                      <p className="mt-0.5 text-slate-700 font-mono text-[11px]">
                        {entry.repository} {entry.prId ? `· PR #${entry.prId}` : ''}
                      </p>
                      {entry.prTitle && <p className="mt-0.5 text-slate-800 font-medium">{entry.prTitle}</p>}
                    </div>

                    {(entry.sourceBranch || entry.targetBranch) && (
                      <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-slate-600">
                        <GitBranch className="h-3.5 w-3.5 text-slate-500" />
                        <span>{entry.sourceBranch || 'source'}</span>
                        <span>→</span>
                        <GitPullRequest className="h-3.5 w-3.5 text-slate-500" />
                        <span>{entry.targetBranch || 'target'}</span>
                      </div>
                    )}

                    <div>
                      <div className="font-semibold text-app-ink">Matched Conditions:</div>
                      {entry.matchedConditions?.length ? (
                        <ul className="mt-1 space-y-1 text-slate-600 text-[11px]">
                          {entry.matchedConditions.map((condition, i) => (
                            <li key={i} className="flex items-center gap-1.5 text-emerald-800">
                              <span className="text-emerald-600 font-bold">✓</span> {condition}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-slate-500 text-[11px]">None</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="font-semibold text-app-ink">Decision & Flow Status:</div>
                      <p
                        className={`mt-1 text-[11px] leading-relaxed ${
                          entry.failureReason ? 'text-amber-800 font-medium' : 'text-slate-700'
                        }`}
                      >
                        {entry.failureReason || 'Tất cả tiêu chí và bước kiểm tra trong flow đều thoả mãn.'}
                      </p>
                      {entry.providerErrorCode && (
                        <span className="mt-1 inline-block rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-mono text-rose-700">
                          Error Code: {entry.providerErrorCode}
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 space-y-0.5">
                      <div>Sequence: #{entry.sequence} · Execution: {entry.executionId.slice(0, 8)}...</div>
                      <div>Timestamp: {new Date(entry.timestamp).toISOString()}</div>
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}

        {visible.length === 0 && (
          <div className="p-8 text-center text-xs text-app-muted">
            Không có sự kiện worker nào khớp với bộ lọc hiện tại.
          </div>
        )}
      </div>
    </section>
  );
};
