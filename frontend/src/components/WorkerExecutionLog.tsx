import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Laptop } from 'lucide-react';
import type { WorkerLogEntry, WorkerRecord } from '../types';

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
      return [entry.repository, entry.prTitle, entry.author, entry.failureReason]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [logs, search, status]);

  return (
    <section className="overflow-hidden rounded-2xl border border-app-line bg-app-panel shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-line bg-app-panel-muted p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-app-ink"><Laptop className="h-4 w-4 text-brand-700" /> Local Worker Execution Log</h2>
          <p className="mt-1 text-xs text-app-muted">Showing the newest 300 worker events with exact filter decisions.</p>
        </div>
        <div className="flex gap-2">
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-xl border border-app-line bg-white px-3 text-xs">
            {['ALL', 'APPROVED', 'SKIPPED', 'DRY_RUN', 'ALREADY_APPROVED', 'FAILED', 'PAUSED_VPN', 'RESUMED'].map((item) => <option key={item}>{item}</option>)}
          </select>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search worker logs" className="min-h-11 rounded-xl border border-app-line bg-white px-3 text-xs" />
        </div>
      </div>
      <div className="divide-y divide-app-line">
        {visible.map((entry) => (
          <article key={entry.id} className="p-4">
            <button onClick={() => setExpanded(expanded === entry.id ? null : entry.id)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{entry.status}</span>
                  <span className="truncate text-xs font-semibold text-app-ink">{entry.repository || 'Worker transition'}{entry.prId ? ` #${entry.prId}` : ''}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-app-muted">{workerNames.get(entry.workerId) || entry.workerId} · {new Date(entry.timestamp).toLocaleString()}</p>
              </div>
              {expanded === entry.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expanded === entry.id && (
              <div className="mt-3 grid gap-3 rounded-xl bg-app-panel-muted p-3 text-xs md:grid-cols-2">
                <div><div className="font-semibold text-app-ink">Matched conditions</div>{entry.matchedConditions.length ? <ul className="mt-1 space-y-1 text-app-muted">{entry.matchedConditions.map((condition) => <li key={condition}>✓ {condition}</li>)}</ul> : <p className="mt-1 text-app-muted">None</p>}</div>
                <div><div className="font-semibold text-app-ink">Final decision</div><p className="mt-1 text-app-muted">{entry.failureReason || 'All configured conditions passed.'}</p></div>
              </div>
            )}
          </article>
        ))}
        {visible.length === 0 && <div className="p-8 text-center text-xs text-app-muted">No worker events match the current filters.</div>}
      </div>
    </section>
  );
};
