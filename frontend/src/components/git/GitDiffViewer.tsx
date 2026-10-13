import React, { useState } from 'react';
import type { GitCommit, GitDiffResponse, GitFileDiff } from '../../types/git';
import {
  FileDiff,
  Check,
  Copy,
  Code2,
  Loader2,
  FileWarning,
} from 'lucide-react';

interface GitDiffViewerProps {
  diffData: GitDiffResponse | null;
  selectedCommit?: GitCommit | null;
  selectedFilePath?: string | null;
  isLoading?: boolean;
}

export const GitDiffViewer: React.FC<GitDiffViewerProps> = ({
  diffData,
  selectedCommit,
  selectedFilePath,
  isLoading = false,
}) => {
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'unified' | 'raw'>('unified');
  const [copied, setCopied] = useState(false);

  const files = diffData?.files || [];
  // Find index of selected file if provided, otherwise activeFileIndex
  const currentFile: GitFileDiff | undefined =
    selectedFilePath && files.length > 0
      ? files.find((f) => f.newPath === selectedFilePath || f.oldPath === selectedFilePath) ||
        files[activeFileIndex] ||
        files[0]
      : files[activeFileIndex] || files[0];

  const handleCopyRaw = () => {
    const textToCopy = currentFile?.rawDiff || diffData?.rawDiff || '';
    if (!textToCopy) return;
    navigator.clipboard?.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalAdditions = files.reduce((acc, f) => acc + (f.additions || 0), 0);
  const totalDeletions = files.reduce((acc, f) => acc + (f.deletions || 0), 0);

  return (
    <div className="flex flex-col h-full bg-white border border-app-line rounded-xl overflow-hidden shadow-soft select-text">
      {/* Top Header */}
      <div className="p-2.5 border-b border-app-line bg-app-panel-strong flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileDiff className="w-4 h-4 text-brand-600 shrink-0" />
          {selectedCommit ? (
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-xs font-semibold text-app-ink truncate">
                Commit: {selectedCommit.shortHash || selectedCommit.hash.slice(0, 7)}
              </span>
              <span className="text-[11px] text-app-muted truncate hidden sm:inline" title={selectedCommit.message}>
                — {selectedCommit.message.split('\n')[0]}
              </span>
            </div>
          ) : currentFile ? (
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-xs font-semibold text-app-ink font-mono truncate" title={currentFile.newPath}>
                {currentFile.newPath}
              </span>
              {currentFile.isNew && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  New
                </span>
              )}
              {currentFile.isDeleted && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                  Deleted
                </span>
              )}
              {currentFile.isRenamed && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                  Renamed
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs font-semibold text-app-ink">Diff Inspector</span>
          )}
        </div>

        {/* Stats & Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Additions / Deletions pills */}
          {files.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="inline-flex items-center text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                +{currentFile ? currentFile.additions : totalAdditions}
              </span>
              <span className="inline-flex items-center text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded font-medium">
                -{currentFile ? currentFile.deletions : totalDeletions}
              </span>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center bg-app-panel-muted border border-app-line rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('unified')}
              className={`px-2 py-1 text-[11px] rounded font-medium transition-colors ${
                viewMode === 'unified' ? 'bg-white text-brand-700 shadow-xs' : 'text-app-muted hover:text-app-ink'
              }`}
            >
              Unified
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`px-2 py-1 text-[11px] rounded font-medium transition-colors ${
                viewMode === 'raw' ? 'bg-white text-brand-700 shadow-xs' : 'text-app-muted hover:text-app-ink'
              }`}
            >
              Raw
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyRaw}
            disabled={!currentFile?.rawDiff && !diffData?.rawDiff}
            className="p-1.5 rounded-lg border border-app-line text-app-muted hover:text-app-ink hover:bg-app-panel transition-colors disabled:opacity-40"
            title="Copy diff to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Multi-file selector bar (for commits or multiple diff files) */}
      {files.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-app-panel border-b border-app-line overflow-x-auto text-xs">
          <span className="text-[11px] text-app-muted font-medium shrink-0 mr-1">
            Files ({files.length}):
          </span>
          {files.map((file, idx) => {
            const isCurrent = currentFile?.newPath === file.newPath;
            return (
              <button
                key={file.newPath}
                type="button"
                onClick={() => setActiveFileIndex(idx)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono shrink-0 transition-colors flex items-center gap-1.5 ${
                  isCurrent
                    ? 'bg-brand-600 text-white font-medium shadow-xs'
                    : 'bg-white text-app-ink border border-app-line/60 hover:bg-brand-50'
                }`}
              >
                <span>{file.newPath.split('/').pop() || file.newPath}</span>
                <span className={`text-[9px] ${isCurrent ? 'text-white/80' : 'text-emerald-700 font-semibold'}`}>
                  +{file.additions}
                </span>
                <span className={`text-[9px] ${isCurrent ? 'text-white/80' : 'text-rose-700 font-semibold'}`}>
                  -{file.deletions}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Diff Content */}
      <div className="flex-1 overflow-auto bg-slate-50 font-mono text-xs">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-app-muted">
            <Loader2 className="w-6 h-6 animate-spin text-brand-600 mb-2" />
            <p className="text-xs">Generating diff...</p>
          </div>
        ) : !diffData || files.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-app-muted space-y-2 select-none">
            <Code2 className="w-8 h-8 text-app-muted/40" />
            <p className="font-semibold text-app-ink">No Changes to Display</p>
            <p className="text-[11px] text-center max-w-sm">
              Select an unstaged or staged file from the Staging panel, or click any commit in the DAG graph to inspect its changes.
            </p>
          </div>
        ) : viewMode === 'raw' ? (
          <div className="p-3 bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed whitespace-pre overflow-x-auto min-h-full">
            {currentFile?.rawDiff || diffData.rawDiff || 'No raw diff content.'}
          </div>
        ) : currentFile?.isBinary ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-app-muted space-y-2 select-none">
            <FileWarning className="w-8 h-8 text-amber-500" />
            <p className="font-semibold text-app-ink">Binary File</p>
            <p className="text-[11px]">Git diff is not supported for binary assets.</p>
          </div>
        ) : (
          <div className="divide-y divide-app-line/40">
            {currentFile?.hunks.map((hunk, hunkIdx) => (
              <div key={`hunk-${hunkIdx}`} className="bg-white">
                {/* Hunk Header */}
                <div className="bg-blue-50/70 text-blue-800 px-3 py-1 text-[11px] border-y border-blue-100/80 font-mono select-none flex items-center gap-2">
                  <span className="font-semibold">{hunk.header}</span>
                </div>

                {/* Hunk Lines */}
                <div className="divide-y divide-slate-100/50">
                  {hunk.lines.map((line, lineIdx) => {
                    const isAdd = line.type === 'addition';
                    const isDel = line.type === 'deletion';

                    return (
                      <div
                        key={`line-${hunkIdx}-${lineIdx}`}
                        className={`flex items-start text-[11px] leading-5 ${
                          isAdd
                            ? 'bg-emerald-50/80 text-emerald-950'
                            : isDel
                            ? 'bg-rose-50/80 text-rose-950'
                            : 'bg-white text-slate-800'
                        }`}
                      >
                        {/* Old line number */}
                        <span
                          className={`w-10 px-2 text-right select-none shrink-0 ${
                            isDel ? 'text-rose-600 bg-rose-100/60 font-semibold' : 'text-slate-400 bg-slate-50/60'
                          }`}
                        >
                          {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
                        </span>

                        {/* New line number */}
                        <span
                          className={`w-10 px-2 text-right select-none shrink-0 border-r border-slate-200/60 ${
                            isAdd ? 'text-emerald-600 bg-emerald-100/60 font-semibold' : 'text-slate-400 bg-slate-50/60'
                          }`}
                        >
                          {line.newLineNumber !== undefined ? line.newLineNumber : ''}
                        </span>

                        {/* Line marker +/- */}
                        <span
                          className={`w-5 text-center font-bold select-none shrink-0 ${
                            isAdd ? 'text-emerald-600' : isDel ? 'text-rose-600' : 'text-transparent'
                          }`}
                        >
                          {isAdd ? '+' : isDel ? '-' : ' '}
                        </span>

                        {/* Line content */}
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
  );
};
