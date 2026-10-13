import React, { useState } from 'react';
import type {
  GitFileStatusType,
  GitStatusFile,
  GitWorkingTreeStatus,
  GitDiffResponse,
  GitCommit,
} from '../../types/git';
import {
  MoreHorizontal,
  RotateCcw,
  Plus,
  Minus,
  Copy,
  User,
  CheckSquare,
  Square,
  List,
  FolderTree,
  Loader2,
  Code2,
} from 'lucide-react';

interface GitSourceTreeFileStatusProps {
  status: GitWorkingTreeStatus | null;
  diffData: GitDiffResponse | null;
  selectedFile: { path: string; staged: boolean; status: GitFileStatusType } | null;
  onSelectFile: (file: { path: string; staged: boolean; status: GitFileStatusType } | null) => void;
  onStage: (paths?: string[], all?: boolean) => void;
  onUnstage: (paths?: string[], all?: boolean) => void;
  onDiscard: (paths?: string[], all?: boolean) => void;
  onCommit: (payload: { message: string; amend?: boolean }) => void;
  isStaging?: boolean;
  isCommitting?: boolean;
  isDiffLoading?: boolean;
  lastCommitMessage?: string;
  selectedCommit?: GitCommit | null;
}

export const GitSourceTreeFileStatus: React.FC<GitSourceTreeFileStatusProps> = ({
  status,
  diffData,
  selectedFile,
  onSelectFile,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  isStaging = false,
  isCommitting = false,
  isDiffLoading = false,
  lastCommitMessage = '',
  selectedCommit,
}) => {
  const [filterMode, setFilterMode] = useState<'pending' | 'staged' | 'unstaged'>('pending');
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [commitMessage, setCommitMessage] = useState('');
  const [isAmend, setIsAmend] = useState(false);
  const [activeMenuFile, setActiveMenuFile] = useState<string | null>(null);

  const stagedFiles: GitStatusFile[] = status?.staged || [];
  const unstagedFiles: GitStatusFile[] = [
    ...(status?.unstaged || []),
    ...(status?.untracked || []),
  ];

  // All pending files merged
  const allPendingFiles: Array<GitStatusFile & { isStaged: boolean }> = [
    ...stagedFiles.map((f) => ({ ...f, isStaged: true })),
    ...unstagedFiles.map((f) => ({ ...f, isStaged: false })),
  ];

  // Filter based on dropdown
  const visibleFiles =
    filterMode === 'staged'
      ? stagedFiles.map((f) => ({ ...f, isStaged: true }))
      : filterMode === 'unstaged'
      ? unstagedFiles.map((f) => ({ ...f, isStaged: false }))
      : allPendingFiles;

  const allStaged = stagedFiles.length > 0 && unstagedFiles.length === 0;
  const someStaged = stagedFiles.length > 0;

  const handleToggleAllStaged = () => {
    if (allStaged) {
      onUnstage(undefined, true);
    } else {
      onStage(undefined, true);
    }
  };

  const handleToggleFileStaged = (file: GitStatusFile & { isStaged: boolean }) => {
    if (file.isStaged) {
      onUnstage([file.path]);
    } else {
      onStage([file.path]);
    }
  };

  const handleCommitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    if (stagedFiles.length === 0 && !isAmend) return;

    onCommit({
      message: commitMessage.trim(),
      amend: isAmend,
    });
    setCommitMessage('');
    setIsAmend(false);
  };

  const handleAmendToggle = (checked: boolean) => {
    setIsAmend(checked);
    if (checked && !commitMessage.trim() && lastCommitMessage) {
      setCommitMessage(lastCommitMessage);
    }
  };

  // Status badge matching SourceTree macOS exact visual style
  const renderStatusBadge = (fileStatus: GitFileStatusType) => {
    switch (fileStatus) {
      case 'modified':
        return (
          <span
            className="w-4 h-4 rounded bg-amber-400 text-white flex items-center justify-center font-bold text-[10px] shadow-xs select-none"
            title="Modified"
          >
            …
          </span>
        );
      case 'deleted':
        return (
          <span
            className="w-4 h-4 rounded bg-slate-400 text-white flex items-center justify-center font-bold text-[10px] shadow-xs select-none"
            title="Deleted"
          >
            -
          </span>
        );
      case 'untracked':
        return (
          <span
            className="w-4 h-4 rounded bg-purple-500 text-white flex items-center justify-center font-bold text-[10px] shadow-xs select-none"
            title="Untracked"
          >
            ?
          </span>
        );
      case 'added':
        return (
          <span
            className="w-4 h-4 rounded bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] shadow-xs select-none"
            title="Added"
          >
            +
          </span>
        );
      case 'renamed':
        return (
          <span
            className="w-4 h-4 rounded bg-blue-500 text-white flex items-center justify-center font-bold text-[10px] shadow-xs select-none"
            title="Renamed"
          >
            R
          </span>
        );
      default:
        return (
          <span
            className="w-4 h-4 rounded bg-slate-300 text-slate-700 flex items-center justify-center font-bold text-[10px] select-none"
            title="Unknown"
          >
            •
          </span>
        );
    }
  };

  // Truncate path smartly if very long (like SourceTree: ...ents/skills/...)
  const formatFilePath = (path: string) => {
    if (path.length > 36) {
      const parts = path.split('/');
      if (parts.length > 2) {
        return `…/${parts.slice(-2).join('/')}`;
      }
    }
    return path;
  };

  const activeFileDiff = diffData?.files?.[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-white select-none overflow-hidden">
      {/* Upper Main Split: Left File List + Right Diff Viewer */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 overflow-hidden divide-x divide-app-line">
        {/* Left Column: File List (approx 5 cols on md/lg, 4 on xl) */}
        <div className="md:col-span-5 xl:col-span-4 flex flex-col h-full bg-[#f8fafc] overflow-hidden">
          {/* Header Bar */}
          <div className="shrink-0 px-2 py-1.5 bg-[#eef2f6] border-b border-app-line flex items-center justify-between gap-1 text-xs">
            {/* Toggle All checkbox + Dropdown Filter */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={handleToggleAllStaged}
                disabled={isStaging || allPendingFiles.length === 0}
                className="p-1 rounded text-blue-600 hover:bg-slate-200/60 disabled:opacity-40 transition-colors"
                title={allStaged ? 'Unstage all files' : 'Stage all files'}
              >
                {allStaged ? (
                  <CheckSquare className="w-4 h-4" />
                ) : someStaged ? (
                  <span className="w-4 h-4 rounded border-2 border-blue-600 flex items-center justify-center">
                    <span className="w-2 h-2 bg-blue-600 rounded-xs" />
                  </span>
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
              </button>

              <select
                aria-label="Pending files filter"
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as any)}
                className="min-h-7 px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-800 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 truncate max-w-[210px] shadow-xs"
              >
                <option value="pending">Pending files, sorted by file status</option>
                <option value="staged">Staged Files</option>
                <option value="unstaged">Unstaged Files</option>
              </select>
            </div>

            {/* List / Tree View Toggles */}
            <div className="flex items-center gap-0.5 text-slate-500">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'list' ? 'bg-slate-300/70 text-slate-900 font-semibold' : 'hover:bg-slate-200'
                }`}
                title="List view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={`p-1 rounded transition-colors ${
                  viewMode === 'tree' ? 'bg-slate-300/70 text-slate-900 font-semibold' : 'hover:bg-slate-200'
                }`}
                title="Tree view"
              >
                <FolderTree className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Files List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-200/50 p-1">
            {visibleFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-muted italic">
                {filterMode === 'staged'
                  ? 'No staged files.'
                  : filterMode === 'unstaged'
                  ? 'No unstaged changes.'
                  : 'Nothing to commit (working tree clean).'}
              </div>
            ) : (
              visibleFiles.map((file) => {
                const isSelected =
                  selectedFile?.path === file.path && selectedFile?.staged === file.isStaged;

                return (
                  <div
                    key={`${file.isStaged ? 'staged' : 'unstaged'}-${file.path}`}
                    onClick={() =>
                      onSelectFile({
                        path: file.path,
                        staged: file.isStaged,
                        status: file.status,
                      })
                    }
                    className={`group relative flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#d0e2ff] text-slate-900 font-semibold'
                        : 'hover:bg-slate-200/60 text-slate-800'
                    }`}
                  >
                    {/* Checkbox + Status icon + File name */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Checkbox for Stage / Unstage */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFileStaged(file);
                        }}
                        disabled={isStaging}
                        className="text-blue-600 hover:text-blue-800 focus-visible:outline-none"
                        title={file.isStaged ? 'Unstage file' : 'Stage file'}
                      >
                        {file.isStaged ? (
                          <CheckSquare className="w-4 h-4 fill-blue-600 text-white" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>

                      {/* SourceTree Status Icon */}
                      {renderStatusBadge(file.status)}

                      {/* File Path */}
                      <span
                        className="truncate font-mono text-[11px]"
                        title={file.path}
                      >
                        {formatFilePath(file.path)}
                      </span>
                    </div>

                    {/* Context menu button `...` */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuFile(
                            activeMenuFile === file.path ? null : file.path
                          );
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200/80 transition-colors"
                        title="Options"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>

                      {/* Popup Menu */}
                      {activeMenuFile === file.path && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg border border-slate-200 shadow-float py-1 z-30 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              handleToggleFileStaged(file);
                              setActiveMenuFile(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-2"
                          >
                            {file.isStaged ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                            <span>{file.isStaged ? 'Unstage file' : 'Stage file'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onDiscard([file.path]);
                              setActiveMenuFile(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-700 flex items-center gap-2"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Discard changes</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(file.path);
                              setActiveMenuFile(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-2 text-slate-600"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy relative path</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Diff Viewer (approx 7 cols on md/lg, 8 on xl) */}
        <div className="md:col-span-7 xl:col-span-8 flex flex-col h-full bg-white overflow-hidden">
          {/* File Header Bar (matches image.png) */}
          <div className="shrink-0 px-3 py-1.5 bg-[#f0f3f7] border-b border-app-line flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {selectedFile ? (
                <>
                  {renderStatusBadge(selectedFile.status)}
                  <span className="font-mono font-semibold text-slate-900 truncate" title={selectedFile.path}>
                    {selectedFile.path}
                  </span>
                </>
              ) : selectedCommit ? (
                <span className="font-semibold text-slate-900">
                  Commit: {selectedCommit.shortHash} — {selectedCommit.message.split('\n')[0]}
                </span>
              ) : (
                <span className="text-slate-500 italic">No file selected</span>
              )}
            </div>

            <button
              type="button"
              className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-colors"
              title="Diff options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Hunk Header Bar (Lines, Stage hunk, Discard hunk) */}
          {activeFileDiff && activeFileDiff.hunks.length > 0 && (
            <div className="shrink-0 px-3 py-1 bg-[#f8fafc] border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
              <span className="font-mono text-slate-500">
                Hunk 1 : Lines {activeFileDiff.hunks[0]?.newStart || 1}-{
                  (activeFileDiff.hunks[0]?.newStart || 1) + (activeFileDiff.hunks[0]?.newLines || 0)
                }
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => selectedFile && onStage([selectedFile.path])}
                  disabled={isStaging || selectedFile?.staged}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 disabled:opacity-40 transition-colors shadow-xs"
                >
                  Stage hunk
                </button>
                <button
                  type="button"
                  onClick={() => selectedFile && onDiscard([selectedFile.path])}
                  disabled={isStaging}
                  className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-300 disabled:opacity-40 transition-colors shadow-xs"
                >
                  Discard hunk
                </button>
              </div>
            </div>
          )}

          {/* Diff Content */}
          <div className="flex-1 overflow-auto bg-white font-mono text-[11px] leading-5 select-text">
            {isDiffLoading ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-app-muted">
                <Loader2 className="w-6 h-6 animate-spin text-brand-600 mb-2" />
                <p className="text-xs">Loading diff…</p>
              </div>
            ) : !diffData || !activeFileDiff ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-app-muted space-y-2 select-none">
                <Code2 className="w-8 h-8 text-slate-300" />
                <p className="font-semibold text-slate-700 text-xs">No file selected for diff</p>
                <p className="text-[11px] text-slate-400 max-w-xs text-center">
                  Select a pending file from the list to preview line-by-line changes.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {activeFileDiff.hunks.map((hunk, hunkIdx) => (
                  <div key={`hunk-${hunkIdx}`}>
                    {/* Header if second hunk */}
                    {hunkIdx > 0 && (
                      <div className="px-3 py-1 bg-[#f8fafc] border-y border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                        <span className="font-mono text-slate-500">
                          Hunk {hunkIdx + 1} : Lines {hunk.newStart}-{hunk.newStart + hunk.newLines}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => selectedFile && onStage([selectedFile.path])}
                            className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300"
                          >
                            Stage hunk
                          </button>
                          <button
                            type="button"
                            onClick={() => selectedFile && onDiscard([selectedFile.path])}
                            className="px-2 py-0.5 rounded text-[11px] bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-300"
                          >
                            Discard hunk
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Diff Lines (exact SourceTree macOS styling) */}
                    <div>
                      {hunk.lines.map((line, lineIdx) => {
                        const isAdd = line.type === 'addition';
                        const isDel = line.type === 'deletion';

                        return (
                          <div
                            key={`line-${hunkIdx}-${lineIdx}`}
                            className={`flex items-start ${
                              isAdd
                                ? 'bg-[#ebfbee] text-[#14532d]'
                                : isDel
                                ? 'bg-[#ffebe9] text-[#991b1b]'
                                : 'bg-white text-slate-700'
                            }`}
                          >
                            {/* Old line number */}
                            <span className="w-9 px-1.5 text-right select-none text-slate-400 text-[10px] shrink-0">
                              {line.oldLineNumber ?? ''}
                            </span>

                            {/* New line number */}
                            <span className="w-9 px-1.5 text-right select-none text-slate-400 text-[10px] shrink-0 border-r border-slate-200">
                              {line.newLineNumber ?? ''}
                            </span>

                            {/* Line prefix (+ / - / space) */}
                            <span className="w-4 text-center select-none font-bold shrink-0">
                              {isAdd ? '+' : isDel ? '-' : ' '}
                            </span>

                            {/* Content */}
                            <div className="flex-1 px-1 whitespace-pre-wrap break-all font-mono">
                              {line.content || ' '}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar: Commit Message Box (exact SourceTree macOS design) */}
      <div className="shrink-0 p-3 bg-[#f0f3f7] border-t border-app-line flex items-start gap-3">
        {/* User Avatar */}
        <div className="w-8 h-8 rounded-full bg-slate-300 border border-slate-400 flex items-center justify-center text-slate-600 shrink-0 mt-0.5 shadow-xs">
          <User className="w-4 h-4" />
        </div>

        {/* Commit Input & Controls */}
        <form onSubmit={handleCommitSubmit} className="flex-1 flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Commit message"
              placeholder="Commit message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              disabled={isCommitting}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-app-ink placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 shadow-xs"
            />

            <button
              type="submit"
              disabled={isCommitting || !commitMessage.trim() || (stagedFiles.length === 0 && !isAmend)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-xs shrink-0"
            >
              {isCommitting ? 'Committing…' : `Commit ${stagedFiles.length > 0 ? `(${stagedFiles.length})` : ''}`}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isAmend}
                onChange={(e) => handleAmendToggle(e.target.checked)}
                disabled={isCommitting}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Amend previous commit</span>
            </label>

            <span className="font-mono text-[10px]">
              {stagedFiles.length} staged / {unstagedFiles.length} unstaged
            </span>
          </div>
        </form>
      </div>
    </div>
  );
};
