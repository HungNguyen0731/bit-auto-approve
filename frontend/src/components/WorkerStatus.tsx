import React from 'react';
import { Laptop, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { WorkerRecord } from '../types';

const STATE_STYLE: Record<WorkerRecord['state'], string> = {
  STARTING: 'bg-blue-50 text-blue-700 border-blue-200',
  ONLINE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAUSED_VPN: 'bg-amber-50 text-amber-800 border-amber-200',
  OFFLINE_CONTROL_PLANE: 'bg-rose-50 text-rose-700 border-rose-200',
  OFFLINE: 'bg-slate-100 text-slate-600 border-slate-300',
  UPDATING: 'bg-violet-50 text-violet-700 border-violet-200',
  ERROR_AUTH: 'bg-rose-50 text-rose-700 border-rose-200',
  ERROR: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const WorkerStatus: React.FC<{ workers: WorkerRecord[] }> = ({ workers }) => {
  if (workers.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {workers.map((worker) => (
        <article key={worker.id} className="min-w-0 rounded-2xl border border-app-line bg-app-panel p-4 shadow-soft">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                <Laptop className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-app-ink">{worker.name}</h3>
                <p className="truncate text-[11px] font-mono text-app-muted">
                  {worker.platform}/{worker.architecture} · v{worker.version}
                </p>
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${STATE_STYLE[worker.state]}`}>
              {worker.state}
            </span>
          </div>
          <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {worker.state === 'ONLINE' ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5" />}
              {worker.lastHeartbeatAt ? `Heartbeat ${new Date(worker.lastHeartbeatAt).toLocaleTimeString()}` : 'Awaiting first heartbeat'}
            </span>
            <span className="font-mono">Queue {worker.queueDepth}</span>
          </div>
          {worker.state === 'PAUSED_VPN' && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Jobs are paused until the workstation VPN or IP allowlist route recovers. They resume automatically without catch-up bursts.
            </div>
          )}
        </article>
      ))}
    </div>
  );
};
