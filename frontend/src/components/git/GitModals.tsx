import React, { useState, useEffect, useRef } from 'react';
import type { GitBranch, GitStash } from '../../types/git';
import {
  GitBranch as GitBranchIcon,
  Plus,
  ArrowRight,
  Archive,
  Download,
  Upload,
  X,
  Loader2,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface MergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: GitBranch[];
  currentBranch: string;
  onMerge: (branch: string, noFf: boolean, message?: string) => Promise<void>;
}

export const MergeModal: React.FC<MergeModalProps> = ({ isOpen, onClose, branches, currentBranch, onMerge }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [branch, setBranch] = useState('');
  const [noFf, setNoFf] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBranch(''); setMessage(''); setNoFf(false); setError(null);
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, [isOpen]);
  const field = 'w-full min-h-11 px-3 rounded border border-app-line bg-white text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';
  return <dialog ref={dialog} aria-labelledby="merge-title" onCancel={event => { if (pending) event.preventDefault(); else onClose(); }} className="w-full max-w-md rounded-xl border border-app-line p-0 text-app-ink shadow-float backdrop:bg-black/40">
    <form className="p-5 space-y-4" onSubmit={async event => {
      event.preventDefault(); if (!branch || pending) return;
      setPending(true); setError(null);
      try { await onMerge(branch, noFf, message.trim() || undefined); onClose(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Merge failed.'); }
      finally { setPending(false); }
    }}>
      <div className="flex justify-between items-center"><h2 id="merge-title" className="font-semibold">Merge into {currentBranch}</h2><button type="button" aria-label="Close merge dialog" disabled={pending} onClick={onClose} className="min-h-11 min-w-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"><X aria-hidden="true" className="w-4 h-4 mx-auto" /></button></div>
      <label className="block text-sm">Branch to merge<select autoFocus required value={branch} disabled={pending} onChange={event => setBranch(event.target.value)} className={field}><option value="">Select a branch</option>{branches.filter(item => !item.current && item.name !== currentBranch).map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noFf} disabled={pending} onChange={event => setNoFf(event.target.checked)} />Always create a merge commit (--no-ff)</label>
      <label className="block text-sm">Custom message (optional)<textarea value={message} disabled={pending} onChange={event => setMessage(event.target.value)} className={field} /></label>
      <p className="text-xs text-app-muted">Merges into the current branch. Conflicts may require manual resolution.</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={pending || !branch} className="w-full min-h-11 rounded bg-brand-600 text-white font-semibold text-sm disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">{pending ? 'Merging…' : 'Merge'}</button>
    </form>
  </dialog>;
};

/* -------------------------------------------------------------------------- */
/*                                BRANCH MODAL                                */
/* -------------------------------------------------------------------------- */

interface BranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: GitBranch[];
  currentBranch: string;
  onSwitchBranch: (branchName: string) => Promise<void>;
  onCreateBranch: (branchName: string, startPoint?: string, checkout?: boolean) => Promise<void>;
}

export const BranchModal: React.FC<BranchModalProps> = ({
  isOpen,
  onClose,
  branches,
  currentBranch,
  onSwitchBranch,
  onCreateBranch,
}) => {
  const [activeTab, setActiveTab] = useState<'switch' | 'create'>('switch');
  const [searchQuery, setSearchQuery] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [checkoutNew, setCheckoutNew] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const handleSwitch = async (name: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSwitchBranch(name);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to switch branch');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onCreateBranch(newBranchName.trim(), startPoint.trim() || undefined, checkoutNew);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create branch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-app-line w-full max-w-md shadow-float overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
        {/* Header */}
        <div className="p-3.5 border-b border-app-line bg-app-panel-strong flex items-center justify-between">
          <div className="flex items-center gap-2 text-app-ink font-semibold text-sm">
            <GitBranchIcon className="w-4 h-4 text-brand-600" />
            <span>Branch Management</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-app-muted hover:text-app-ink hover:bg-app-panel transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-app-line bg-app-panel p-1 gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('switch');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'switch'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-app-muted hover:text-app-ink'
            }`}
          >
            Switch Branch
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('create');
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'create'
                ? 'bg-white text-brand-700 shadow-xs'
                : 'text-app-muted hover:text-app-ink'
            }`}
          >
            Create New Branch
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'switch' ? (
            <div className="space-y-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter branches..."
                className="w-full px-3 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />

              <div className="divide-y divide-app-line/50 border border-app-line rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                {filteredBranches.map((branch) => {
                  const isCurrent = branch.current || branch.name === currentBranch;
                  return (
                    <div
                      key={branch.name}
                      className="p-2.5 flex items-center justify-between text-xs hover:bg-brand-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranchIcon
                          className={`w-3.5 h-3.5 ${isCurrent ? 'text-emerald-600' : 'text-app-muted'}`}
                        />
                        <span
                          className={`truncate font-mono ${
                            isCurrent ? 'font-bold text-emerald-800' : 'text-app-ink'
                          }`}
                        >
                          {branch.name}
                        </span>
                        {branch.isRemote && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-medium">
                            remote
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">
                            current
                          </span>
                        )}
                      </div>

                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleSwitch(branch.name)}
                          className="px-2.5 py-1 text-[11px] rounded-md bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors flex items-center gap-1 shadow-xs"
                        >
                          {isSubmitting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <span>Checkout</span>
                              <ArrowRight className="w-3 h-3" />
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-app-ink mb-1">
                  Branch Name
                </label>
                <input
                  type="text"
                  required
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. feature/visual-git-tree"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-app-ink mb-1">
                  Start Point (optional)
                </label>
                <input
                  type="text"
                  value={startPoint}
                  onChange={(e) => setStartPoint(e.target.value)}
                  placeholder="e.g. HEAD or main or commit hash"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-app-ink cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={checkoutNew}
                  onChange={(e) => setCheckoutNew(e.target.checked)}
                  className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                />
                <span>Checkout new branch immediately</span>
              </label>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !newBranchName.trim()}
                  className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating branch...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Branch</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                 STASH MODAL                                */
/* -------------------------------------------------------------------------- */

interface StashModalProps {
  isOpen: boolean;
  onClose: () => void;
  stashes: GitStash[];
  onPushStash: (message?: string, includeUntracked?: boolean) => Promise<void>;
  onPopStash: (index?: number) => Promise<void>;
}

export const StashModal: React.FC<StashModalProps> = ({
  isOpen,
  onClose,
  stashes,
  onPushStash,
  onPopStash,
}) => {
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePush = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await onPushStash(stashMessage.trim() || undefined, includeUntracked);
      setStashMessage('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to stash changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePop = async (index: number) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onPopStash(index);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to pop stash');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-app-line w-full max-w-md shadow-float overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
        {/* Header */}
        <div className="p-3.5 border-b border-app-line bg-app-panel-strong flex items-center justify-between">
          <div className="flex items-center gap-2 text-app-ink font-semibold text-sm">
            <Archive className="w-4 h-4 text-brand-600" />
            <span>Stash Management</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-app-muted hover:text-app-ink hover:bg-app-panel transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Create new stash form */}
          <form onSubmit={handlePush} className="p-3 rounded-xl bg-app-panel border border-app-line space-y-2.5">
            <h4 className="text-xs font-semibold text-app-ink flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5 text-brand-600" />
              <span>Create New Stash</span>
            </h4>
            <input
              type="text"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              placeholder="Optional stash description (e.g. WIP on staging panel)..."
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <label className="flex items-center gap-2 text-xs text-app-ink cursor-pointer">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(e) => setIncludeUntracked(e.target.checked)}
                className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
              />
              <span>Include untracked files</span>
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-1.5 px-3 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-xs flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" />
                  <span>Stash Changes</span>
                </>
              )}
            </button>
          </form>

          {/* Stash list */}
          <div>
            <h4 className="text-xs font-semibold text-app-ink mb-2 flex items-center justify-between">
              <span>Saved Stashes</span>
              <span className="text-[10px] font-mono bg-app-panel-muted px-1.5 py-0.5 rounded text-app-muted">
                {stashes.length}
              </span>
            </h4>

            {stashes.length === 0 ? (
              <p className="text-xs text-app-muted text-center py-4">No stashes saved.</p>
            ) : (
              <div className="divide-y divide-app-line/50 border border-app-line rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {stashes.map((s) => (
                  <div
                    key={s.index}
                    className="p-2.5 flex items-center justify-between text-xs hover:bg-app-panel/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono font-bold text-brand-700 text-[11px]">
                          stash@&#123;{s.index}&#125;
                        </span>
                        <span className="truncate text-app-ink" title={s.message}>
                          {s.message}
                        </span>
                      </div>
                      <span className="text-[10px] text-app-muted flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {s.date}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handlePop(s.index)}
                      className="px-2 py-1 text-[11px] rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0 shadow-xs"
                      title="Pop and apply this stash to working tree"
                    >
                      Pop / Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                               REMOTE OPS MODAL                             */
/* -------------------------------------------------------------------------- */

interface RemoteOpsModalProps {
  isOpen: boolean;
  type: 'fetch' | 'pull' | 'push' | null;
  onClose: () => void;
  currentBranch: string;
  onFetch: (remote?: string, prune?: boolean) => Promise<void>;
  onPull: (remote?: string, branch?: string, rebase?: boolean) => Promise<void>;
  onPush: (remote?: string, branch?: string, force?: boolean, setUpstream?: boolean) => Promise<void>;
}

export const RemoteOpsModal: React.FC<RemoteOpsModalProps> = ({
  isOpen,
  type,
  onClose,
  currentBranch,
  onFetch,
  onPull,
  onPush,
}) => {
  const [remote, setRemote] = useState('origin');
  const [branch, setBranch] = useState(currentBranch);
  const [prune, setPrune] = useState(true);
  const [rebase, setRebase] = useState(false);
  const [force, setForce] = useState(false);
  const [setUpstream, setSetUpstream] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBranch(currentBranch);
      setError(null);
    }
  }, [isOpen, currentBranch]);

  if (!isOpen || !type) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (type === 'fetch') {
        await onFetch(remote.trim() || undefined, prune);
      } else if (type === 'pull') {
        await onPull(remote.trim() || undefined, branch.trim() || undefined, rebase);
      } else if (type === 'push') {
        await onPush(remote.trim() || undefined, branch.trim() || undefined, force, setUpstream);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || `Failed to execute git ${type}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title =
    type === 'fetch'
      ? 'Fetch from Remote'
      : type === 'pull'
      ? 'Pull Changes from Remote'
      : 'Push Commits to Remote';

  const icon =
    type === 'fetch' ? (
      <Download className="w-4 h-4 text-blue-600" />
    ) : type === 'pull' ? (
      <Download className="w-4 h-4 text-emerald-600" />
    ) : (
      <Upload className="w-4 h-4 text-indigo-600" />
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-app-line w-full max-w-md shadow-float overflow-hidden flex flex-col animate-scale-in">
        {/* Header */}
        <div className="p-3.5 border-b border-app-line bg-app-panel-strong flex items-center justify-between">
          <div className="flex items-center gap-2 text-app-ink font-semibold text-sm">
            {icon}
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-app-muted hover:text-app-ink hover:bg-app-panel transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-app-ink mb-1">
              Remote
            </label>
            <input
              type="text"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              placeholder="origin"
              className="w-full px-3 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {type !== 'fetch' && (
            <div>
              <label className="block text-xs font-semibold text-app-ink mb-1">
                Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder={currentBranch}
                className="w-full px-3 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}

          {type === 'fetch' && (
            <label className="flex items-center gap-2 text-xs text-app-ink cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={prune}
                onChange={(e) => setPrune(e.target.checked)}
                className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
              />
              <span>Prune tracking branches no longer on remote</span>
            </label>
          )}

          {type === 'pull' && (
            <label className="flex items-center gap-2 text-xs text-app-ink cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={rebase}
                onChange={(e) => setRebase(e.target.checked)}
                className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
              />
              <span>Rebase instead of merge (--rebase)</span>
            </label>
          )}

          {type === 'push' && (
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-app-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={setUpstream}
                  onChange={(e) => setSetUpstream(e.target.checked)}
                  className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                />
                <span>Set upstream tracking (--set-upstream)</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-rose-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="rounded border-rose-300 text-rose-600 focus:ring-rose-500 w-3.5 h-3.5"
                />
                <span>Force push with lease (--force-with-lease)</span>
              </label>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Executing git {type}...</span>
                </>
              ) : (
                <>
                  {icon}
                  <span className="capitalize">Run Git {type}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
