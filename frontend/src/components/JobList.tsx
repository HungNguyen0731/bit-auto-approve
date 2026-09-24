import React from 'react';
import { ApprovalJob } from '../types';
import {
  Plus,
  RotateCw,
  Edit2,
  Trash2,
  Eye,
  GitBranch,
  FolderGit2,
  Users,
  Shield,
  Clock,
  Zap,
} from 'lucide-react';
import { BitbucketMark, VisualArtwork } from './VisualArtwork';

interface JobListProps {
  jobs: ApprovalJob[];
  onToggleJob: (id: string) => void;
  onRunNow: (id: string) => void;
  onEditJob: (job: ApprovalJob) => void;
  onDeleteJob: (id: string) => void;
  onPreviewRules: (job: ApprovalJob) => void;
  onCreateJob: () => void;
  runningJobIds: Set<string>;
}

export const JobList: React.FC<JobListProps> = ({
  jobs,
  onToggleJob,
  onRunNow,
  onEditJob,
  onDeleteJob,
  onPreviewRules,
  onCreateJob,
  runningJobIds,
}) => {
  const safeJobs = Array.isArray(jobs) ? jobs : [];

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-app-ink tracking-tight flex items-center gap-2">
            Configured Approval Jobs
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-100 text-slate-700 border border-slate-300">
              {safeJobs.length}
            </span>
          </h2>
          <p className="text-xs text-slate-600">
            Define automated approval criteria, target branches, author whitelists, and polling intervals.
          </p>
        </div>

        <button
          onClick={onCreateJob}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>New Approval Job</span>
        </button>
      </div>

      {/* Empty State */}
      {safeJobs.length === 0 ? (
        <div className="rounded-2xl bg-app-panel border border-app-line shadow-soft overflow-hidden grid md:grid-cols-[0.9fr_1.1fr] items-center">
          <div className="p-6 sm:p-8 text-left order-2 md:order-1">
            <span className="inline-flex rounded-full bg-brand-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Automation workspace</span>
            <h3 className="mt-4 text-lg font-bold text-app-ink">No Approval Jobs Configured</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 max-w-md">
              Create your first background job to automatically scan pull requests and approve those matching your rules.
            </p>
            <button
              onClick={onCreateJob}
              className="mt-5 inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Job</span>
            </button>
          </div>
          <div className="bg-brand-50/70 p-2 sm:p-5 order-1 md:order-2">
            <VisualArtwork variant="empty-jobs" className="mx-auto w-full max-w-md" />
          </div>
        </div>
      ) : (
        /* Jobs Cards List */
        <div className="grid grid-cols-1 gap-4">
          {safeJobs.map((job) => {
            const isRunningNow = runningJobIds.has(job.id);

            return (
              <div
                key={job.id}
                className={`rounded-2xl bg-app-panel border transition-all duration-200 shadow-soft overflow-hidden ${
                  job.enabled
                    ? 'border-app-line hover:border-brand-300 hover:-translate-y-0.5'
                    : 'border-app-line opacity-70 bg-app-panel-muted'
                }`}
              >
                {/* Job Card Header */}
                <div className="p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3 border-b border-app-line">
                  <div className="flex items-start gap-3 max-w-xl">
                    <div className="mt-0.5 h-10 w-10 flex-shrink-0 rounded-xl bg-brand-500 text-white shadow-sm inline-flex items-center justify-center">
                      <BitbucketMark className="h-5 w-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-sm font-bold text-app-ink">{job.name}</h3>

                      {/* Enabled / Disabled Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold border ${
                          job.enabled
                            ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {job.enabled ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Active
                          </>
                        ) : (
                          'Paused'
                        )}
                      </span>

                      {/* Dry Run Badge */}
                      {job.dryRun ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold bg-amber-500/10 text-amber-700 border border-amber-500/20">
                          <Eye className="w-3 h-3" /> Dry Run Mode
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold bg-blue-500/10 text-brand-700 border border-blue-500/20">
                          <Zap className="w-3 h-3" /> Auto-Approve Live
                        </span>
                      )}

                      {/* Interval Badge */}
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600">
                        <Clock className="w-3 h-3" /> Every {job.intervalSeconds}s
                      </span>
                    </div>
                    </div>

                    {job.description && (
                      <p className="text-xs text-slate-600 line-clamp-1">{job.description}</p>
                    )}
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* Toggle Active / Pause */}
                    <button
                      onClick={() => onToggleJob(job.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                        job.enabled
                          ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 border-amber-500/30'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      }`}
                      title={job.enabled ? 'Pause this job' : 'Resume this job'}
                    >
                      {job.enabled ? 'Pause' : 'Enable'}
                    </button>

                    {/* Run Now Button */}
                    <button
                      onClick={() => onRunNow(job.id)}
                      disabled={isRunningNow || !job.enabled}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-app-panel-strong hover:bg-brand-50 text-app-ink hover:text-brand-800 text-xs font-medium border border-slate-300 transition-colors disabled:opacity-40"
                      title="Trigger immediate execution"
                    >
                      <RotateCw
                        className={`w-3.5 h-3.5 ${isRunningNow ? 'animate-spin text-brand-700' : ''}`}
                      />
                      <span className="hidden sm:inline">Run Now</span>
                    </button>

                    {/* Preview Rules Button */}
                    <button
                      onClick={() => onPreviewRules(job)}
                      className="p-1.5 rounded-xl bg-app-panel-strong hover:bg-brand-50 text-app-muted hover:text-brand-700 border border-slate-300 transition-colors"
                      title="Test rules against Bitbucket PRs"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    {/* Edit Button */}
                    <button
                      onClick={() => onEditJob(job)}
                      className="p-1.5 rounded-xl bg-app-panel-strong hover:bg-brand-50 text-app-muted hover:text-app-ink border border-slate-300 transition-colors"
                      title="Edit job rules"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={() => onDeleteJob(job.id)}
                      className="p-1.5 rounded-xl bg-app-panel-strong hover:bg-rose-50 text-app-muted hover:text-rose-700 border border-slate-300 hover:border-rose-800 transition-colors"
                      title="Delete this job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Rules Summary Matrix */}
                <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs bg-app-panel-muted/50">
                  {/* Target Repositories */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                      <FolderGit2 className="w-3.5 h-3.5 text-brand-700" />
                      <span>Target Repositories</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {job.rules.repositories.map((repo, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-app-panel-strong text-app-ink border border-app-line"
                        >
                          {repo}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Target Branches */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-indigo-700" />
                      <span>Target Branches</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {job.rules.targetBranches.map((branch, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-app-panel-strong text-app-ink border border-app-line"
                        >
                          {branch}
                        </span>
                      ))}
                      {job.rules.sourceBranches && job.rules.sourceBranches.length > 0 && (
                        <span className="text-[11px] text-slate-500 self-center">
                          from [{job.rules.sourceBranches.join(', ')}]
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Author Whitelist */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Author Whitelist</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {job.rules.authorWhitelist.map((author, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md font-mono text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200"
                        >
                          @{author}
                        </span>
                      ))}
                      {job.rules.excludeSelf && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-700 border border-amber-500/20 font-mono">
                          Exclude Self
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pre-conditions Footer */}
                <div className="px-4 py-2.5 bg-app-panel-muted border-t border-app-line flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3 text-slate-600" /> Guards:
                    </span>
                    {job.rules.ignoreDrafts && (
                      <span className="text-slate-700">✓ Skip Drafts</span>
                    )}
                    {job.rules.ignoreWithConflicts && (
                      <span className="text-slate-700">✓ Skip Conflicts</span>
                    )}
                    {job.rules.requireSuccessfulBuild && (
                      <span className="text-emerald-700">✓ Require CI Green</span>
                    )}
                    {job.rules.titleKeywordsExclude && job.rules.titleKeywordsExclude.length > 0 && (
                      <span className="text-rose-700">
                        Excludes: {job.rules.titleKeywordsExclude.join(', ')}
                      </span>
                    )}
                  </div>

                  <div className="text-slate-600 font-mono">
                    Last Run:{' '}
                    {job.lastRunAt
                      ? new Date(job.lastRunAt).toLocaleTimeString()
                      : 'Never'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
