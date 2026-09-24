import React, { useState } from 'react';
import { ApprovalActionStatus, ApprovalLogEntry } from '../types';
import {
  Trash2,
  ExternalLink,
  Search,
  CheckCircle2,
  Eye,
  AlertCircle,
  HelpCircle,
  XCircle,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { BitbucketMark, VisualArtwork } from './VisualArtwork';

interface ActionLogTableProps {
  logs: ApprovalLogEntry[];
  onClearLogs: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  sseConnected: boolean;
}

const STATUS_CONFIG: Record<
  ApprovalActionStatus,
  { label: string; bg: string; text: string; border: string; icon: React.ComponentType<{ className?: string }> }
> = {
  APPROVED: {
    label: 'APPROVED',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-700',
    border: 'border-emerald-500/20',
    icon: CheckCircle2,
  },
  DRY_RUN: {
    label: 'DRY RUN',
    bg: 'bg-blue-500/10',
    text: 'text-brand-700',
    border: 'border-blue-500/20',
    icon: Eye,
  },
  ALREADY_APPROVED: {
    label: 'ALREADY APPROVED',
    bg: 'bg-purple-500/10',
    text: 'text-violet-700',
    border: 'border-purple-500/20',
    icon: HelpCircle,
  },
  SKIPPED: {
    label: 'SKIPPED',
    bg: 'bg-amber-500/10',
    text: 'text-amber-700',
    border: 'border-amber-500/20',
    icon: AlertCircle,
  },
  FAILED: {
    label: 'FAILED',
    bg: 'bg-rose-500/10',
    text: 'text-rose-700',
    border: 'border-rose-500/20',
    icon: XCircle,
  },
};

export const ActionLogTable: React.FC<ActionLogTableProps> = ({
  logs,
  onClearLogs,
  onRefresh,
  isRefreshing,
  sseConnected,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const safeLogs = Array.isArray(logs) ? logs : [];

  const filteredLogs = safeLogs.filter((log) => {
    if (statusFilter !== 'ALL' && log.status !== statusFilter) {
      return false;
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchesTitle = log.prTitle.toLowerCase().includes(q);
      const matchesRepo = log.repository.toLowerCase().includes(q);
      const matchesAuthor = log.author.toLowerCase().includes(q);
      const matchesJob = log.jobName.toLowerCase().includes(q);
      const matchesBranch =
        log.sourceBranch.toLowerCase().includes(q) ||
        log.targetBranch.toLowerCase().includes(q);
      return matchesTitle || matchesRepo || matchesAuthor || matchesJob || matchesBranch;
    }
    return true;
  });

  const filterOptions = ['ALL', 'APPROVED', 'DRY_RUN', 'SKIPPED', 'FAILED'];

  return (
    <div className="rounded-2xl bg-app-panel border border-app-line shadow-soft overflow-hidden">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-app-line bg-app-panel-muted/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-brand-500 text-white shadow-sm">
            <BitbucketMark className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-app-ink tracking-tight">
                Live Approval Action Log
              </h2>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-300">
                <Radio className={`w-3 h-3 ${sseConnected ? 'text-emerald-700 animate-pulse' : 'text-slate-500'}`} />
                {sseConnected ? 'STREAMING' : 'POLLING'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Real-time audit log of PR evaluations, dry runs, and Bitbucket approval calls.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-app-panel hover:bg-brand-50 text-app-ink text-xs font-medium border border-slate-300 transition-colors disabled:opacity-50"
            title="Refresh logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-app-panel hover:bg-rose-50 text-app-muted hover:text-rose-700 text-xs font-medium border border-slate-300 hover:border-rose-800 transition-colors disabled:opacity-40"
            title="Clear approval history"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear History</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Sub-bar */}
      <div className="px-4 sm:px-5 py-3 border-b border-app-line bg-app-panel-muted/50 flex flex-wrap items-center justify-between gap-3">
        {/* Status Filter Buttons */}
        <div className="flex items-center flex-wrap gap-1.5 text-xs font-medium">
          {filterOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                statusFilter === opt
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'bg-transparent hover:bg-brand-50 text-app-muted hover:text-app-ink border border-transparent'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px] max-w-xs w-full">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search PR title, repo, author..."
            className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-600 outline-none transition-all"
          />
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Logs Table */}
      <div className="overflow-x-auto">
        {filteredLogs.length === 0 ? (
          <div className="grid md:grid-cols-[15rem_1fr] items-center gap-2 px-6 py-5 md:px-10 md:py-7">
            <VisualArtwork variant="empty-logs" className="mx-auto w-full max-w-[15rem]" />
            <div className="text-center md:text-left">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Waiting for activity</span>
              <p className="mt-2 text-sm font-bold text-app-ink">No approval logs found.</p>
              <p className="mt-1 text-xs leading-5 text-slate-600 max-w-md">
                When the background scheduler evaluates pull requests, live records and author context will appear here.
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-app-panel-muted text-[11px] font-semibold text-slate-600 uppercase tracking-wider border-b border-app-line">
              <tr>
                <th scope="col" className="py-3 px-4">
                  Status
                </th>
                <th scope="col" className="py-3 px-4">
                  Pull Request
                </th>
                <th scope="col" className="py-3 px-4">
                  Repository & Job
                </th>
                <th scope="col" className="py-3 px-4">
                  Author
                </th>
                <th scope="col" className="py-3 px-4">
                  Branch Flow
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Time / Latency
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-line font-sans">
              {filteredLogs.map((log) => {
                const conf = STATUS_CONFIG[log.status] || STATUS_CONFIG.SKIPPED;
                const StatusIcon = conf.icon;
                const isExpanded = expandedLogId === log.id;

                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="hover:bg-brand-50/70 cursor-pointer transition-colors"
                    >
                      {/* Status Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${conf.bg} ${conf.text} ${conf.border}`}
                        >
                          <StatusIcon className="w-3 h-3 flex-shrink-0" />
                          {conf.label}
                        </span>
                      </td>

                      {/* PR Title & Link */}
                      <td className="py-3 px-4 max-w-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-slate-600 text-[11px]">
                            #{log.prId}
                          </span>
                          <a
                            href={log.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-slate-900 hover:text-brand-700 flex items-center gap-1 truncate"
                            title={log.prTitle}
                          >
                            <span className="truncate">{log.prTitle}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500 flex-shrink-0 hover:text-brand-700" />
                          </a>
                        </div>
                      </td>

                      {/* Repository & Job */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-[11px] text-slate-900">
                          {log.repository}
                        </div>
                        <div className="text-[10px] text-slate-500 line-clamp-1">
                          {log.jobName}
                        </div>
                      </td>

                      {/* Author */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-slate-700">
                        @{log.author}
                      </td>

                      {/* Branch Flow */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span className="text-slate-600">{log.sourceBranch}</span>
                          <span className="text-slate-600">→</span>
                          <span className="text-indigo-400 font-semibold">{log.targetBranch}</span>
                        </div>
                      </td>

                      {/* Timestamp & Latency */}
                      <td className="py-3 px-4 whitespace-nowrap text-right font-mono text-[11px] text-slate-600">
                        <div>{new Date(log.timestamp).toLocaleTimeString()}</div>
                        <div className="text-[10px] text-slate-500">{log.durationMs}ms</div>
                      </td>
                    </tr>

                    {/* Detailed Reason Accordion */}
                    {isExpanded && (
                      <tr className="bg-app-panel-muted">
                        <td colSpan={6} className="py-3 px-6">
                          <div className="text-xs space-y-1">
                            <div className="text-[11px] uppercase font-semibold text-slate-600">
                              Evaluation Details:
                            </div>
                            <p className="text-app-ink font-mono text-[11px] bg-app-panel-strong p-2.5 rounded-lg border border-app-line">
                              {log.reason}
                            </p>
                            {Array.isArray(log.details?.matchedConditions) && (
                              <div className="mt-2 space-y-1">
                                {(log.details.matchedConditions as string[]).map((condition) => (
                                  <div key={condition} className="text-[11px] text-emerald-700">✓ {condition}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
