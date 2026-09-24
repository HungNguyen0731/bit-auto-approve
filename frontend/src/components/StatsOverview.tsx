import React from 'react';
import { SchedulerStatus } from '../types';
import { MetricEmblem } from './VisualArtwork';

interface StatsOverviewProps {
  status: SchedulerStatus;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ status }) => {
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${seconds % 60}s`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* Active Jobs */}
      <div className="p-4 rounded-2xl bg-app-panel border border-app-line shadow-soft relative overflow-hidden group hover:border-brand-300 hover:-translate-y-0.5 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-app-muted">Active Jobs</span>
          <MetricEmblem variant="jobs" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-app-ink">
            {status.activeJobsCount}
          </span>
          <span className="text-xs text-app-muted font-mono">/ {status.totalJobsCount} total</span>
        </div>
        <div className="mt-1 text-[11px] text-app-muted">
          {status.isRunning ? 'Auto-polling in progress' : 'Scheduler is currently paused'}
        </div>
      </div>

      {/* Approved PRs */}
      <div className="p-4 rounded-2xl bg-app-panel border border-app-line shadow-soft relative overflow-hidden group hover:border-brand-300 hover:-translate-y-0.5 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-app-muted">Approved PRs</span>
          <MetricEmblem variant="approved" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-emerald-700">
            {status.totalApprovedCount}
          </span>
          <span className="text-xs text-emerald-700 font-medium">Auto-approved</span>
        </div>
        <div className="mt-1 text-[11px] text-app-muted">Passed all branch & author filters</div>
      </div>

      {/* Bitbucket Connection */}
      <div className="p-4 rounded-2xl bg-app-panel border border-app-line shadow-soft relative overflow-hidden group hover:border-brand-300 hover:-translate-y-0.5 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-app-muted">Bitbucket Link</span>
          <MetricEmblem variant="connection" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              status.bitbucketStatus === 'CONNECTED'
                ? 'bg-emerald-500'
                : status.bitbucketStatus === 'ERROR'
                ? 'bg-rose-500'
                : 'bg-amber-500'
            }`}
          />
          <span className="text-sm font-semibold font-mono tracking-wide text-app-ink">
            {status.bitbucketStatus}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-app-muted truncate">
          {status.vpnConnected ? 'Via corporate tunnel' : 'VPN reachability failed'}
        </div>
      </div>

      {/* Local Uptime */}
      <div className="p-4 rounded-2xl bg-app-panel border border-app-line shadow-soft relative overflow-hidden group hover:border-brand-300 hover:-translate-y-0.5 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-app-muted">Local Daemon</span>
          <MetricEmblem variant="uptime" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xl font-bold font-mono tracking-tight text-app-ink">
            {formatUptime(status.uptimeSeconds)}
          </span>
          <span className="text-xs text-slate-600">uptime</span>
        </div>
        <div className="mt-1 text-[11px] text-app-muted">
          Last run:{' '}
          {status.lastExecutionAt
            ? new Date(status.lastExecutionAt).toLocaleTimeString()
            : 'Pending'}
        </div>
      </div>
    </div>
  );
};
