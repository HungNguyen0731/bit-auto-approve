import React, { useState, useEffect } from 'react';
import {
  ApprovalJob,
  BitbucketBranchMeta,
  BitbucketRepositoryMeta,
  BitbucketUserMeta,
  CreateJobDto,
  JobFilterRules,
  WorkerRecord,
} from '../types';
import { api } from '../api/client';
import { SearchableCombobox } from './SearchableCombobox';
import {
  X,
  FolderGit2,
  GitBranch,
  Users,
  Shield,
  Eye,
  Zap,
  Info,
  Sliders,
  Lock,
} from 'lucide-react';

interface JobFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (jobData: CreateJobDto, jobId?: string) => Promise<void>;
  onPreview: (rules: JobFilterRules) => void;
  editingJob: ApprovalJob | null;
  isSaving: boolean;
  workers: WorkerRecord[];
}

// Reusable tag input for repositories, branches, authors, keywords
const TagInput: React.FC<{
  label: string;
  sublabel?: string;
  tags: string[];
  onChange: (newTags: string[]) => void;
  placeholder: string;
  icon?: React.ReactNode;
}> = ({ label, sublabel, tags, onChange, placeholder, icon }) => {
  const [inputValue, setInputValue] = useState('');

  const addTag = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter((t) => t !== tagToRemove));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </label>
        {sublabel && <span className="text-[11px] text-slate-500">{sublabel}</span>}
      </div>

      <div className="min-h-[42px] p-1.5 bg-app-panel-strong border border-app-line rounded-xl flex flex-wrap items-center gap-1.5 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-100 text-slate-900 border border-slate-300"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-rose-700 p-0.5 rounded transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : 'Add more...'}
          className="flex-1 min-w-[120px] bg-transparent text-xs text-slate-900 placeholder-slate-600 outline-none px-2 py-1 font-mono"
        />
      </div>
    </div>
  );
};

export const JobFormModal: React.FC<JobFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onPreview,
  editingJob,
  isSaving,
  workers,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [dryRun, setDryRun] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [executionMode, setExecutionMode] = useState<'local' | 'worker'>('worker');
  const [workerId, setWorkerId] = useState('');

  // Filter Rules
  const [repositories, setRepositories] = useState<string[]>([]);
  const [authorWhitelist, setAuthorWhitelist] = useState<string[]>([]);
  const [authorBlacklist, setAuthorBlacklist] = useState<string[]>([]);
  const [excludeSelf, setExcludeSelf] = useState(true);
  const [targetBranches, setTargetBranches] = useState<string[]>([]);
  const [sourceBranches, setSourceBranches] = useState<string[]>([]);
  const [titleKeywordsExclude, setTitleKeywordsExclude] = useState<string[]>([
    '[WIP]',
    'DO NOT MERGE',
  ]);
  const [ignoreDrafts, setIgnoreDrafts] = useState(true);
  const [ignoreWithConflicts, setIgnoreWithConflicts] = useState(true);
  const [requireSuccessfulBuild, setRequireSuccessfulBuild] = useState(false);

  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name);
      setDescription(editingJob.description || '');
      setIntervalSeconds(editingJob.intervalSeconds || 60);
      setDryRun(editingJob.dryRun);
      setEnabled(editingJob.enabled);
      setExecutionMode('worker');
      setWorkerId(editingJob.workerId || '');
      setRepositories(editingJob.rules.repositories || []);
      setAuthorWhitelist(editingJob.rules.authorWhitelist || []);
      setAuthorBlacklist(editingJob.rules.authorBlacklist || []);
      setExcludeSelf(editingJob.rules.excludeSelf ?? true);
      setTargetBranches(editingJob.rules.targetBranches || []);
      setSourceBranches(editingJob.rules.sourceBranches || []);
      setTitleKeywordsExclude(editingJob.rules.titleKeywordsExclude || []);
      setIgnoreDrafts(editingJob.rules.ignoreDrafts ?? true);
      setIgnoreWithConflicts(editingJob.rules.ignoreWithConflicts ?? true);
      setRequireSuccessfulBuild(editingJob.rules.requireSuccessfulBuild ?? false);
    } else {
      setName('');
      setDescription('');
      setIntervalSeconds(60);
      setDryRun(false);
      setEnabled(true);
      setExecutionMode('worker');
      setWorkerId(workers.find((worker) => worker.state === 'ONLINE')?.id || '');
      setRepositories([]);
      setAuthorWhitelist([]);
      setAuthorBlacklist([]);
      setExcludeSelf(true);
      setTargetBranches([]);
      setSourceBranches([]);
      setTitleKeywordsExclude(['[WIP]', 'DO NOT MERGE']);
      setIgnoreDrafts(true);
      setIgnoreWithConflicts(true);
      setRequireSuccessfulBuild(false);
    }
  }, [editingJob, isOpen, workers]);

  if (!isOpen) return null;

  const currentRules: JobFilterRules = {
    repositories,
    authorWhitelist,
    authorBlacklist: authorBlacklist.length > 0 ? authorBlacklist : undefined,
    excludeSelf,
    targetBranches,
    sourceBranches: sourceBranches.length > 0 ? sourceBranches : undefined,
    titleKeywordsExclude: titleKeywordsExclude.length > 0 ? titleKeywordsExclude : undefined,
    ignoreDrafts,
    ignoreWithConflicts,
    requireSuccessfulBuild,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (executionMode === 'worker' && !workerId)) return;

    await onSave(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        enabled,
        intervalSeconds,
        dryRun,
        executionMode,
        workerId: executionMode === 'worker' ? workerId : undefined,
        rules: currentRules,
      },
      editingJob?.id
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-950/35 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl bg-app-panel border border-app-line shadow-float overflow-hidden my-8 animate-scale-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-app-line bg-app-panel-muted/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-brand-700">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-app-ink tracking-tight">
                {editingJob ? 'Edit Approval Job' : 'Create New Approval Job'}
              </h3>
              <p className="text-xs text-slate-600">
                Configure matching filters and automated approval behavior
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 hover:text-slate-950 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Basic Job Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Job Name <span className="text-rose-700">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Auto-Approve Backend Microservices"
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-600 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Description (Optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description of this job's purpose"
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-600 outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-app-line bg-app-panel-muted p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Execution Location</label>
                <p className="mt-1 text-[11px] text-slate-600">Coolify only coordinates jobs. A paired Mac Worker makes every Bitbucket request.</p>
              </div>
              <span className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white">Mac Worker</span>
            </div>
            {executionMode === 'worker' && (
              <select value={workerId} onChange={(event) => setWorkerId(event.target.value)} className="mt-3 min-h-11 w-full rounded-xl border border-app-line bg-white px-3 text-xs text-app-ink">
                <option value="">Select a paired Worker</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id} disabled={worker.state !== 'ONLINE'}>
                    {worker.name} — {worker.state}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Execution Mode & Interval */}
          <div className="p-4 rounded-xl bg-app-panel-muted border border-app-line grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Auto-Approve vs Dry-Run Mode */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Execution Mode
              </label>
              <div className="flex rounded-xl bg-app-panel p-1 border border-app-line text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setDryRun(false)}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    !dryRun
                      ? 'bg-blue-600 text-white font-semibold shadow'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Auto-Approve</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDryRun(true)}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    dryRun
                      ? 'bg-amber-600 text-white font-semibold shadow'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Dry Run (Preview Only)</span>
                </button>
              </div>
              <span className="text-[11px] text-slate-600 mt-1 block">
                {dryRun
                  ? 'Safe mode: Evaluates rules and logs matches without modifying Pull Requests.'
                  : 'Live mode: Automatically sends Bitbucket Approve API call when PR matches.'}
              </span>
            </div>

            {/* Polling Interval */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Polling Interval
              </label>
              <select
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 outline-none font-mono"
              >
                <option value={15}>Every 15 seconds (High frequency)</option>
                <option value={30}>Every 30 seconds</option>
                <option value={60}>Every 60 seconds (Recommended)</option>
                <option value={120}>Every 2 minutes</option>
                <option value={300}>Every 5 minutes</option>
              </select>
              <span className="text-[11px] text-slate-600 mt-1 block">
                Background runner checks Bitbucket on this schedule.
              </span>
            </div>
          </div>

          {/* Section: Smart Filter Rules */}
          <div className="space-y-4 pt-1">
            <h4 className="text-xs font-bold text-brand-700 uppercase tracking-wider flex items-center gap-1.5">
              <FolderGit2 className="w-4 h-4" /> Filter Rules
            </h4>

            {/* Repositories */}
            <SearchableCombobox<BitbucketRepositoryMeta>
              label="Target Repositories"
              sublabel="e.g. CORE/*, PROJ/backend-service (Enter to add)"
              placeholder="Search Bitbucket repositories or type wildcard (e.g. CORE/*)..."
              values={repositories}
              onChange={setRepositories}
              entityType="repository"
              allowWildcard={true}
              enableSelectAll={true}
              maxVisibleChips={3}
              icon={<FolderGit2 className="w-3.5 h-3.5 text-brand-700" />}
              fetchOptions={(q) => api.getRepositories({ query: q, limit: 100 })}
              getItemValue={(r) => r.fullName}
              getItemLabel={(r) => r.description || r.slug}
              renderOption={(repo) => (
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-brand-700 border border-blue-500/20 flex-shrink-0">
                      [{repo.projectKey}]
                    </span>
                    <span className="font-semibold text-slate-900 text-xs font-mono truncate">
                      {repo.slug}
                    </span>
                    {repo.description && (
                      <span className="text-slate-600 text-[11px] truncate max-w-[220px]">
                        {repo.description}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 font-mono text-[10px]">
                    {repo.isPrivate && (
                      <span className="text-slate-500 flex items-center gap-0.5">
                        <Lock className="w-2.5 h-2.5" /> Private
                      </span>
                    )}
                    {repo.defaultBranch && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-300">
                        {repo.defaultBranch}
                      </span>
                    )}
                  </div>
                </div>
              )}
            />

            {/* Branches: Target & Source */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SearchableCombobox<BitbucketBranchMeta>
                label="Target Branches (Destination)"
                sublabel="e.g. main, develop, release/*"
                placeholder="Search branches or pattern..."
                values={targetBranches}
                onChange={setTargetBranches}
                entityType="branch"
                allowWildcard={true}
                icon={<GitBranch className="w-3.5 h-3.5 text-indigo-700" />}
                fetchOptions={(q) => {
                  const concreteRepo = repositories.find((r) => !r.includes('*'));
                  return concreteRepo ? api.getBranches({ repository: concreteRepo, query: q, limit: 50 }) : Promise.resolve([]);
                }}
                getItemValue={(b) => b.name}
                getItemLabel={(b) => b.displayId}
                renderOption={(branch) => {
                  const badgeColor =
                    branch.type === 'default'
                      ? 'bg-blue-500/10 text-brand-700 border-blue-500/20'
                      : branch.type === 'release'
                      ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      : branch.type === 'feature'
                      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-700 border-rose-500/20';

                  return (
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch className="w-3.5 h-3.5 text-indigo-700 flex-shrink-0" />
                        <span className="font-mono text-xs font-semibold text-slate-900 truncate">
                          {branch.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
                        {branch.type && (
                          <span className={`px-1.5 py-0.5 rounded border capitalize ${badgeColor}`}>
                            {branch.type}
                          </span>
                        )}
                        {branch.latestCommit && (
                          <span className="text-slate-500">{branch.latestCommit}</span>
                        )}
                      </div>
                    </div>
                  );
                }}
              />

              <SearchableCombobox<BitbucketBranchMeta>
                label="Source Branches (Optional origin)"
                sublabel="e.g. feature/*, bugfix/*, hotfix/*"
                placeholder="Any source branch if empty..."
                values={sourceBranches}
                onChange={setSourceBranches}
                entityType="branch"
                allowWildcard={true}
                icon={<GitBranch className="w-3.5 h-3.5 text-slate-600" />}
                fetchOptions={(q) => {
                  const concreteRepo = repositories.find((r) => !r.includes('*'));
                  return concreteRepo ? api.getBranches({ repository: concreteRepo, query: q, limit: 50 }) : Promise.resolve([]);
                }}
                getItemValue={(b) => b.name}
                getItemLabel={(b) => b.displayId}
                renderOption={(branch) => (
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                      <span className="font-mono text-xs font-semibold text-slate-900 truncate">
                        {branch.name}
                      </span>
                    </div>
                    {branch.type && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-slate-300 bg-slate-100 text-slate-600">
                        {branch.type}
                      </span>
                    )}
                  </div>
                )}
              />
            </div>

            {/* Author Whitelist & Blacklist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SearchableCombobox<BitbucketUserMeta>
                label="Author Whitelist"
                sublabel="* for all authors, or specific usernames"
                placeholder="Username or * for all..."
                values={authorWhitelist}
                onChange={setAuthorWhitelist}
                entityType="user"
                allowWildcard={true}
                icon={<Users className="w-3.5 h-3.5 text-emerald-700" />}
                fetchOptions={(q) => api.getUsers({ query: q, limit: 25 })}
                getItemValue={(u) => u.username}
                getItemLabel={(u) => u.displayName}
                renderOption={(user) => (
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName}
                          className="w-5 h-5 rounded-full object-cover bg-slate-100 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                          {user.displayName.charAt(0)}
                        </div>
                      )}
                      <span className="font-medium text-slate-900 text-xs truncate">
                        {user.displayName}
                      </span>
                      <span className="font-mono text-[11px] text-slate-600">
                        @{user.username}
                      </span>
                    </div>
                    {user.email && (
                      <span className="font-mono text-[11px] text-slate-500 truncate max-w-[140px]">
                        {user.email}
                      </span>
                    )}
                  </div>
                )}
              />

              <SearchableCombobox<BitbucketUserMeta>
                label="Author Blacklist (Never approve)"
                sublabel="e.g. bot-qa, external-contrib"
                placeholder="Blacklisted username..."
                values={authorBlacklist}
                onChange={setAuthorBlacklist}
                entityType="user"
                allowWildcard={true}
                icon={<Users className="w-3.5 h-3.5 text-rose-700" />}
                fetchOptions={(q) => api.getUsers({ query: q, limit: 25 })}
                getItemValue={(u) => u.username}
                getItemLabel={(u) => u.displayName}
                renderOption={(user) => (
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName}
                          className="w-5 h-5 rounded-full object-cover bg-slate-100 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                          {user.displayName.charAt(0)}
                        </div>
                      )}
                      <span className="font-medium text-slate-900 text-xs truncate">
                        {user.displayName}
                      </span>
                      <span className="font-mono text-[11px] text-rose-700">
                        @{user.username}
                      </span>
                    </div>
                    {user.email && (
                      <span className="font-mono text-[11px] text-slate-500 truncate max-w-[140px]">
                        {user.email}
                      </span>
                    )}
                  </div>
                )}
              />
            </div>

            {/* Excluded Title Keywords */}
            <TagInput
              label="Title Keywords to Exclude"
              sublabel="Skip PR if title contains any of these"
              tags={titleKeywordsExclude}
              onChange={setTitleKeywordsExclude}
              placeholder="e.g. [WIP], [DO NOT MERGE]..."
              icon={<Info className="w-3.5 h-3.5 text-amber-400" />}
            />
          </div>

          {/* Safety Guards & Toggles */}
          <div className="p-4 rounded-xl bg-app-panel-muted border border-app-line space-y-3">
            <h5 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-emerald-700" /> Pre-Condition Safety Guards
            </h5>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-app-panel-strong border border-app-line">
                <input
                  type="checkbox"
                  checked={excludeSelf}
                  onChange={(e) => setExcludeSelf(e.target.checked)}
                  className="rounded border-slate-300 bg-slate-50 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-900">Exclude Self (My PRs)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-app-panel-strong border border-app-line">
                <input
                  type="checkbox"
                  checked={ignoreDrafts}
                  onChange={(e) => setIgnoreDrafts(e.target.checked)}
                  className="rounded border-slate-300 bg-slate-50 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-900">Skip Draft PRs</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-app-panel-strong border border-app-line">
                <input
                  type="checkbox"
                  checked={ignoreWithConflicts}
                  onChange={(e) => setIgnoreWithConflicts(e.target.checked)}
                  className="rounded border-slate-300 bg-slate-50 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-900">Skip Merge Conflicts</span>
              </label>
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-app-panel-strong border border-app-line">
                <input
                  type="checkbox"
                  checked={requireSuccessfulBuild}
                  onChange={(e) => setRequireSuccessfulBuild(e.target.checked)}
                  className="rounded border-slate-300 bg-slate-50 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-900 text-xs">
                  Require CI Build Success (Only approve if commit status is green)
                </span>
              </label>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-3 border-t border-app-line flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onPreview(currentRules)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-700 text-brand-700 hover:text-blue-300 text-xs font-semibold border border-slate-300 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview Against Live PRs</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-700 text-slate-700 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50"
              >
                {isSaving ? 'Saving Job...' : editingJob ? 'Update Job' : 'Create Job'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
