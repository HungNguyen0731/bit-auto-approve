import React, { useMemo, useState } from 'react';
import type { GitCommit } from '../../types/git';
import {
  GitBranch,
  Tag,
  Clock,
  User,
  Copy,
  Check,
  Search,
  Layers,
  CircleDot,
} from 'lucide-react';

interface GitCommitGraphProps {
  commits: GitCommit[];
  selectedCommit: GitCommit | null;
  onSelectCommit: (commit: GitCommit | null) => void;
  hasWorkingTreeChanges?: boolean;
  isWorkingTreeSelected?: boolean;
  onSelectWorkingTree?: () => void;
  currentBranch?: string;
}

const LANE_COLORS = [
  '#2563eb', // Blue
  '#059669', // Emerald
  '#7c3aed', // Purple
  '#d97706', // Amber
  '#db2777', // Pink
  '#0891b2', // Cyan
  '#ea580c', // Orange
  '#4f46e5', // Indigo
];

interface ComputedRow {
  commit: GitCommit;
  lane: number;
  color: string;
  isMerge: boolean;
  // Active lanes that pass straight through this row
  passThroughLanes: number[];
  // Connections from this commit's center (cy=18) to next row's center/top
  connections: Array<{
    fromLane: number;
    toLane: number;
    color: string;
  }>;
}

export const GitCommitGraph: React.FC<GitCommitGraphProps> = ({
  commits,
  selectedCommit,
  onSelectCommit,
  hasWorkingTreeChanges = false,
  isWorkingTreeSelected = false,
  onSelectWorkingTree,
  currentBranch,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleCopy = (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Filter commits
  const filteredCommits = useMemo(() => {
    if (!filterQuery.trim()) return commits;
    const q = filterQuery.toLowerCase().trim();
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.refs.some((r) => r.name.toLowerCase().includes(q))
    );
  }, [commits, filterQuery]);

  // Compute graph layout
  const { rows, maxLanes } = useMemo(() => {
    let activeLanes: (string | null)[] = [];
    let highWaterMark = 1;

    const computed: ComputedRow[] = filteredCommits.map((commit) => {
      const hash = commit.hash;
      const parents = commit.parents;
      const isMerge = parents.length > 1;

      // Find or allocate lane for this commit
      let lane = activeLanes.indexOf(hash);
      if (lane === -1) {
        lane = activeLanes.indexOf(null);
        if (lane === -1) {
          lane = activeLanes.length;
          activeLanes.push(hash);
        } else {
          activeLanes[lane] = hash;
        }
      }

      const color = LANE_COLORS[lane % LANE_COLORS.length];
      const connections: ComputedRow['connections'] = [];

      // Which other lanes are passing through?
      const passThroughLanes: number[] = [];
      activeLanes.forEach((target, lIdx) => {
        if (lIdx !== lane && target !== null) {
          passThroughLanes.push(lIdx);
        }
      });

      // Update activeLanes for parents
      if (parents.length === 0) {
        activeLanes[lane] = null;
      } else {
        // First parent stays in this lane if not already assigned
        const p0 = parents[0];
        const p0ExistingLane = activeLanes.indexOf(p0);
        if (p0ExistingLane !== -1 && p0ExistingLane !== lane) {
          connections.push({
            fromLane: lane,
            toLane: p0ExistingLane,
            color,
          });
          activeLanes[lane] = null;
        } else {
          activeLanes[lane] = p0;
          connections.push({
            fromLane: lane,
            toLane: lane,
            color,
          });
        }

        // Additional parents (merge)
        for (let pIdx = 1; pIdx < parents.length; pIdx++) {
          const p = parents[pIdx];
          const pExistingLane = activeLanes.indexOf(p);
          if (pExistingLane !== -1) {
            connections.push({
              fromLane: lane,
              toLane: pExistingLane,
              color: LANE_COLORS[pExistingLane % LANE_COLORS.length],
            });
          } else {
            let nextFree = activeLanes.indexOf(null);
            if (nextFree === -1) {
              nextFree = activeLanes.length;
              activeLanes.push(p);
            } else {
              activeLanes[nextFree] = p;
            }
            connections.push({
              fromLane: lane,
              toLane: nextFree,
              color: LANE_COLORS[nextFree % LANE_COLORS.length],
            });
          }
        }
      }

      // Compact trailing nulls
      while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
        activeLanes.pop();
      }

      highWaterMark = Math.max(highWaterMark, activeLanes.length, lane + 1);

      return {
        commit,
        lane,
        color,
        isMerge,
        passThroughLanes,
        connections,
      };
    });

    return { rows: computed, maxLanes: Math.max(highWaterMark, 1) };
  }, [filteredCommits]);

  const LANE_WIDTH = 18;
  const ROW_HEIGHT = 38;
  const svgWidth = Math.max(maxLanes * LANE_WIDTH + 14, 32);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-app-line rounded-xl overflow-hidden shadow-soft">
      {/* Top Bar: Search & Commit count */}
      <div className="p-2.5 border-b border-app-line bg-app-panel-strong flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-brand-600" />
          <span className="text-xs font-semibold text-app-ink">Commit History (DAG)</span>
          {currentBranch && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              {currentBranch}
            </span>
          )}
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-app-panel-muted text-app-muted font-mono">
            {filteredCommits.length} commits
          </span>
        </div>

        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Search commits, authors, hashes..."
            className="w-full pl-8 pr-2.5 py-1 text-xs bg-white border border-app-line rounded-md text-app-ink placeholder:text-app-muted/60 focus:outline-none focus:ring-1 focus:ring-brand-500"
            aria-label="Filter commits"
          />
        </div>
      </div>

      {/* Commit Table */}
      <div className="flex-1 overflow-y-auto">
        {/* Working tree item (Sourcetree style top item) */}
        {onSelectWorkingTree && (
          <div
            role="button"
            tabIndex={0}
            onClick={onSelectWorkingTree}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectWorkingTree();
              }
            }}
            className={`flex items-center px-3 py-2 border-b border-app-line cursor-pointer transition-colors ${
              isWorkingTreeSelected
                ? 'bg-amber-50 border-l-4 border-l-amber-500 font-medium'
                : 'hover:bg-app-panel-muted/60'
            }`}
          >
            <div style={{ width: svgWidth }} className="flex items-center justify-center shrink-0">
              <CircleDot
                className={`w-4 h-4 ${hasWorkingTreeChanges ? 'text-amber-600 animate-pulse' : 'text-slate-400'}`}
              />
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-app-ink">
                  Uncommitted Changes (Working Tree)
                </span>
                {hasWorkingTreeChanges ? (
                  <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] rounded font-medium">
                    Modified
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 text-[10px] rounded">
                    Clean
                  </span>
                )}
              </div>
              <span className="text-[11px] text-app-muted">Current workspace state</span>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="p-8 text-center text-app-muted text-xs">
            {commits.length === 0 ? 'No commits in this repository.' : 'No commits matched the filter.'}
          </div>
        ) : (
          rows.map((row) => {
            const commit = row.commit;
            const isSelected = selectedCommit?.hash === commit.hash;
            const cx = row.lane * LANE_WIDTH + 10;
            const cy = ROW_HEIGHT / 2;

            return (
              <div
                key={commit.hash}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCommit(commit)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCommit(commit);
                  }
                }}
                className={`flex items-stretch border-b border-app-line/40 cursor-pointer transition-colors group ${
                  isSelected
                    ? 'bg-brand-50 border-l-4 border-l-brand-600 text-brand-950 font-medium'
                    : 'hover:bg-brand-50/40 text-app-ink'
                }`}
                style={{ minHeight: ROW_HEIGHT }}
                aria-selected={isSelected}
              >
                {/* SVG Lane Graph Column */}
                <div
                  style={{ width: svgWidth, minWidth: svgWidth }}
                  className="relative shrink-0 flex items-center justify-center select-none"
                >
                  <svg
                    width={svgWidth}
                    height={ROW_HEIGHT}
                    className="absolute inset-0 overflow-visible pointer-events-none"
                  >
                    {/* Pass-through vertical lines */}
                    {row.passThroughLanes.map((ptLane) => {
                      const ptX = ptLane * LANE_WIDTH + 10;
                      const ptColor = LANE_COLORS[ptLane % LANE_COLORS.length];
                      return (
                        <line
                          key={`pt-${ptLane}`}
                          x1={ptX}
                          y1={0}
                          x2={ptX}
                          y2={ROW_HEIGHT}
                          stroke={ptColor}
                          strokeWidth={2}
                          strokeOpacity={0.85}
                        />
                      );
                    })}

                    {/* Downward / Branch / Merge Connections */}
                    {row.connections.map((conn, idx) => {
                      const fromX = conn.fromLane * LANE_WIDTH + 10;
                      const toX = conn.toLane * LANE_WIDTH + 10;
                      if (fromX === toX) {
                        return (
                          <line
                            key={`conn-${idx}`}
                            x1={fromX}
                            y1={cy}
                            x2={toX}
                            y2={ROW_HEIGHT}
                            stroke={conn.color}
                            strokeWidth={2}
                          />
                        );
                      }
                      // Smooth bezier curve for branch out or merge in
                      const path = `M ${fromX} ${cy} C ${fromX} ${cy + 14}, ${toX} ${ROW_HEIGHT - 10}, ${toX} ${ROW_HEIGHT}`;
                      return (
                        <path
                          key={`conn-${idx}`}
                          d={path}
                          fill="none"
                          stroke={conn.color}
                          strokeWidth={2}
                        />
                      );
                    })}

                    {/* Commit node circle */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={row.isMerge ? 5.5 : 4.5}
                      fill={row.isMerge ? '#ffffff' : row.color}
                      stroke={row.color}
                      strokeWidth={row.isMerge ? 2.5 : 2}
                    />
                    {row.isMerge && (
                      <circle cx={cx} cy={cy} r={2} fill={row.color} />
                    )}
                  </svg>
                </div>

                {/* Commit Summary & Ref Badges */}
                <div className="flex-1 min-w-0 py-2 pr-3 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {/* Badges for branch / tag / HEAD */}
                    {commit.refs.map((ref) => {
                      if (ref.type === 'head') {
                        return (
                          <span
                            key={ref.fullName}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-900 text-white shrink-0 shadow-xs"
                          >
                            HEAD
                          </span>
                        );
                      }
                      if (ref.type === 'branch') {
                        return (
                          <span
                            key={ref.fullName}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0"
                            title={`Branch: ${ref.name}`}
                          >
                            <GitBranch className="w-2.5 h-2.5" />
                            {ref.name}
                          </span>
                        );
                      }
                      if (ref.type === 'remote-branch') {
                        return (
                          <span
                            key={ref.fullName}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 border border-blue-200 shrink-0"
                            title={`Remote branch: ${ref.name}`}
                          >
                            <GitBranch className="w-2.5 h-2.5" />
                            {ref.name}
                          </span>
                        );
                      }
                      if (ref.type === 'tag') {
                        return (
                          <span
                            key={ref.fullName}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-300 shrink-0"
                            title={`Tag: ${ref.name}`}
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {ref.name}
                          </span>
                        );
                      }
                      return null;
                    })}

                    {/* Commit Message */}
                    <span
                      className="truncate text-app-ink font-normal group-hover:text-brand-700"
                      title={commit.message}
                    >
                      {commit.message.split('\n')[0]}
                    </span>
                  </div>

                  {/* Right metadata: Author, Date, Short Hash */}
                  <div className="flex items-center gap-3 shrink-0 text-app-muted text-[11px]">
                    <span
                      className="truncate max-w-[120px] flex items-center gap-1"
                      title={`${commit.authorName} <${commit.authorEmail}>`}
                    >
                      <User className="w-3 h-3 text-app-muted/70" />
                      {commit.authorName}
                    </span>

                    <span
                      className="whitespace-nowrap flex items-center gap-1 text-[10px]"
                      title={commit.date}
                    >
                      <Clock className="w-3 h-3 text-app-muted/70" />
                      {formatDate(commit.date)}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => handleCopy(commit.hash, e)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-app-panel-muted hover:bg-brand-100 text-app-ink transition-colors"
                      title={`Full Hash: ${commit.hash} (click to copy)`}
                    >
                      <span>{commit.shortHash || commit.hash.slice(0, 7)}</span>
                      {copiedHash === commit.hash ? (
                        <Check className="w-2.5 h-2.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-2.5 h-2.5 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
