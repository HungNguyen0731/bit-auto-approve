import React, { useState } from 'react';
import type { GitFileStatusType, GitStatusFile, GitWorkingTreeStatus } from '../../types/git';
import {
  Plus,
  Minus,
  RotateCcw,
  Send,
  Loader2,
  AlertTriangle,
  CheckSquare,
  Square,
} from 'lucide-react';

interface GitStagingPanelProps {
  status: GitWorkingTreeStatus | null;
  selectedFile: { path: string; staged: boolean; status: GitFileStatusType } | null;
  onSelectFile: (file: { path: string; staged: boolean; status: GitFileStatusType } | null) => void;
  onStage: (paths?: string[], all?: boolean) => void;
  onUnstage: (paths?: string[], all?: boolean) => void;
  onDiscard: (paths?: string[], all?: boolean) => void;
  onCommit: (payload: { message: string; amend?: boolean; pushImmediately?: boolean; stagePaths?: string[] }) => void;
  isStaging?: boolean;
  isCommitting?: boolean;
  lastCommitMessage?: string;
}

export const GitStagingPanel: React.FC<GitStagingPanelProps> = ({
  status,
  selectedFile,
  onSelectFile,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  isStaging = false,
  isCommitting = false,
  lastCommitMessage = '',
}) => {
  const [commitMessage, setCommitMessage] = useState('');
  const [isAmend, setIsAmend] = useState(false);
  const [pushImmediately, setPushImmediately] = useState(true);
  const [selectedUnstagedPaths, setSelectedUnstagedPaths] = useState<Set<string>>(new Set());
  const [discardConfirmPath, setDiscardConfirmPath] = useState<string | null>(null);

  const unstagedFiles: GitStatusFile[] = [
    ...(status?.unstaged || []),
    ...(status?.untracked || []),
  ];
  const stagedFiles: GitStatusFile[] = status?.staged || [];

  const validSelectedUnstaged = unstagedFiles
    .filter((f) => selectedUnstagedPaths.has(f.path))
    .map((f) => f.path);
  const totalFilesToCommit = stagedFiles.length + validSelectedUnstaged.length;
  const allUnstagedChecked =
    unstagedFiles.length > 0 &&
    unstagedFiles.every((f) => selectedUnstagedPaths.has(f.path));

  const handleAmendToggle = (checked: boolean) => {
    setIsAmend(checked);
    if (checked && !commitMessage.trim() && lastCommitMessage) {
      setCommitMessage(lastCommitMessage);
    }
  };

  const handleToggleUnstagedCheckbox = (path: string) => {
    setSelectedUnstagedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleToggleAllUnstagedCheckboxes = () => {
    if (allUnstagedChecked) {
      setSelectedUnstagedPaths(new Set());
    } else {
      setSelectedUnstagedPaths(new Set(unstagedFiles.map((f) => f.path)));
    }
  };

  const handleCommitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    if (totalFilesToCommit === 0 && !isAmend) return;

    onCommit({
      message: commitMessage.trim(),
      amend: isAmend,
      pushImmediately,
      stagePaths: validSelectedUnstaged,
    });
    setSelectedUnstagedPaths(new Set());
    setCommitMessage('');
    setIsAmend(false);
  };

  const renderStatusBadge = (fileStatus: GitFileStatusType) => {
    switch (fileStatus) {
      case 'modified':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-amber-100 text-amber-700"
            title="Modified"
          >
            M
          </span>
        );
      case 'added':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-emerald-100 text-emerald-700"
            title="Added"
          >
            A
          </span>
        );
      case 'deleted':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-rose-100 text-rose-700"
            title="Deleted"
          >
            D
          </span>
        );
      case 'untracked':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-blue-100 text-blue-700"
            title="Untracked"
          >
            ?
          </span>
        );
      case 'renamed':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-purple-100 text-purple-700"
            title="Renamed"
          >
            R
          </span>
        );
      case 'conflict':
        return (
          <span
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-red-100 text-red-700"
            title="Conflict"
          >
            !
          </span>
        );
      default:
        return (
          <span className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold bg-slate-100 text-slate-700">
            *
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-app-line rounded-xl overflow-hidden shadow-soft select-none">
      {/* 2-Pane Split: Unstaged and Staged */}
      <div className="flex-1 grid grid-cols-2 divide-x divide-app-line overflow-hidden min-h-0">
        {/* Left: Unstaged Files */}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="p-2 border-b border-app-line bg-app-panel-strong flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-app-ink">Unstaged Files</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-mono">
                {unstagedFiles.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleAllUnstagedCheckboxes}
                disabled={unstagedFiles.length === 0}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700 hover:bg-slate-200/60 border border-slate-300 disabled:opacity-40 transition-colors"
                title={allUnstagedChecked ? 'Deselect all unstaged' : 'Select all unstaged'}
                aria-label={allUnstagedChecked ? 'Deselect all unstaged' : 'Select all unstaged'}
              >
                {allUnstagedChecked ? (
                  <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{allUnstagedChecked ? 'Deselect' : 'Select'}</span>
              </button>

              <button
                type="button"
                onClick={() => onStage(undefined, true)}
                disabled={isStaging || unstagedFiles.length === 0}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 disabled:opacity-40 transition-colors"
                title="Stage all unstaged changes"
              >
                <Plus className="w-3 h-3" />
                <span>Stage All</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-app-line/30 p-1">
            {unstagedFiles.length === 0 ? (
              <div className="p-4 text-center text-app-muted text-xs">
                No unstaged changes.
              </div>
            ) : (
              unstagedFiles.map((f) => {
                const isSelected = selectedFile?.path === f.path && !selectedFile?.staged;
                return (
                  <div
                    key={`unstaged-${f.path}`}
                    onClick={() => onSelectFile({ path: f.path, staged: false, status: f.status })}
                    className={`flex items-center justify-between p-1.5 rounded-lg text-xs cursor-pointer group transition-colors ${
                      isSelected
                        ? 'bg-amber-50 text-amber-950 font-medium'
                        : selectedUnstagedPaths.has(f.path)
                        ? 'bg-blue-50/60 text-slate-900'
                        : 'hover:bg-app-panel-muted text-app-ink'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleUnstagedCheckbox(f.path);
                        }}
                        className="text-blue-600 hover:text-blue-800 focus-visible:outline-none"
                        title={selectedUnstagedPaths.has(f.path) ? `Deselect ${f.path}` : `Select ${f.path}`}
                        aria-label={selectedUnstagedPaths.has(f.path) ? `Deselect ${f.path}` : `Select ${f.path}`}
                      >
                        {selectedUnstagedPaths.has(f.path) ? (
                          <CheckSquare className="w-3.5 h-3.5 fill-blue-600 text-white" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                      {renderStatusBadge(f.status)}
                      <span className="truncate font-mono text-[11px]" title={f.path}>
                        {f.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStage([f.path]);
                        }}
                        className="p-1 rounded hover:bg-emerald-100 text-emerald-700 transition-colors"
                        title="Stage file"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDiscardConfirmPath(f.path);
                        }}
                        className="p-1 rounded hover:bg-rose-100 text-rose-700 transition-colors"
                        title="Discard changes"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Staged Files */}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="p-2 border-b border-app-line bg-app-panel-strong flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-app-ink">Staged Files</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-mono font-medium">
                {stagedFiles.length}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onUnstage(undefined, true)}
              disabled={isStaging || stagedFiles.length === 0}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 disabled:opacity-40 transition-colors"
              title="Unstage all staged files"
            >
              <Minus className="w-3 h-3" />
              <span>Unstage All</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-app-line/30 p-1">
            {stagedFiles.length === 0 ? (
              <div className="p-4 text-center text-app-muted text-xs">
                No staged files. Click + on files or &quot;Stage All&quot; to stage.
              </div>
            ) : (
              stagedFiles.map((f) => {
                const isSelected = selectedFile?.path === f.path && selectedFile?.staged;
                return (
                  <div
                    key={`staged-${f.path}`}
                    onClick={() => onSelectFile({ path: f.path, staged: true, status: f.status })}
                    className={`flex items-center justify-between p-1.5 rounded-lg text-xs cursor-pointer group transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-950 font-medium'
                        : 'hover:bg-app-panel-muted text-app-ink'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {renderStatusBadge(f.status)}
                      <span className="truncate font-mono text-[11px]" title={f.path}>
                        {f.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnstage([f.path]);
                        }}
                        className="p-1 rounded hover:bg-slate-200 text-slate-700 transition-colors"
                        title="Unstage file"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bottom: Commit Form */}
      <form
        onSubmit={handleCommitSubmit}
        className="p-2.5 border-t border-app-line bg-app-panel space-y-2 shrink-0"
      >
        <div className="relative">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Write a clear commit message (e.g. feat: add git DAG graph visualizer)..."
            rows={2}
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-app-line rounded-lg text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500 font-sans resize-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5 text-xs text-brand-700 cursor-pointer select-none font-medium">
            <input
              type="checkbox"
              checked={pushImmediately}
              onChange={(e) => setPushImmediately(e.target.checked)}
              className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
            />
            <span>Push changes immediately to branch <strong className="font-mono">{status?.branch || 'current'}</strong></span>
          </label>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-app-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAmend}
                onChange={(e) => handleAmendToggle(e.target.checked)}
                className="rounded border-app-line text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
              />
              <span>Amend previous commit</span>
            </label>

            <button
              type="submit"
              disabled={
                isCommitting ||
                !commitMessage.trim() ||
                (totalFilesToCommit === 0 && !isAmend)
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {isCommitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Committing...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isAmend ? (pushImmediately ? 'Amend & Push' : 'Amend Commit') : (pushImmediately ? 'Commit & Push' : 'Commit')} {totalFilesToCommit > 0 ? `(${totalFilesToCommit})` : ''}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Discard Confirmation Dialog */}
      {discardConfirmPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-app-line p-4 max-w-sm w-full space-y-3 shadow-float animate-scale-in">
            <div className="flex items-center gap-2 text-rose-600 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>Discard Changes?</span>
            </div>
            <p className="text-xs text-app-muted">
              Are you sure you want to discard local changes in{' '}
              <span className="font-mono text-app-ink font-semibold">{discardConfirmPath}</span>?
              This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDiscardConfirmPath(null)}
                className="px-3 py-1.5 text-xs rounded-lg border border-app-line text-app-ink hover:bg-app-panel-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDiscard([discardConfirmPath]);
                  setDiscardConfirmPath(null);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-700 font-medium transition-colors"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
