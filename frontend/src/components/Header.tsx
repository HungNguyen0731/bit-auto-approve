import React, { useState, useRef, useEffect } from 'react';
import { BitbucketUserProfile, SchedulerStatus } from '../types';
import {
  ShieldCheck,
  ShieldAlert,
  Play,
  Pause,
  RefreshCw,
  ChevronDown,
  Key,
  LogOut,
} from 'lucide-react';
import { BitbucketMark } from './VisualArtwork';

interface HeaderProps {
  status: SchedulerStatus;
  sseConnected: boolean;
  onToggleScheduler: (enabled: boolean) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  userProfile?: BitbucketUserProfile | null;
  onSwitchAccount?: () => void;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  sseConnected,
  onToggleScheduler,
  onRefresh,
  isRefreshing,
  userProfile,
  onSwitchAccount,
  onOpenSettings,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-brand-900/40 bg-brand-800/95 backdrop-blur-md shadow-[0_8px_24px_rgba(23,43,77,0.16)]">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Brand Identity */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-brand-500 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_20px_rgba(12,102,228,0.28)] text-white font-bold text-lg rotate-[-2deg]">
            <BitbucketMark className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-1.5 whitespace-nowrap">
                <span><span className="hidden sm:inline">Bitbucket </span>PR Approver</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/10 text-blue-100 border border-white/15">
                  Local
                </span>
              </h1>
            </div>
            <p className="text-xs text-blue-100/75 hidden sm:block">
              Bitbucket Cloud approval automation
            </p>
          </div>
        </div>

        {/* Right: Network & Runner Controls & Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Realtime SSE indicator */}
          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors bg-white/10 border-white/15"
            title={sseConnected ? 'Real-time Server-Sent Events connected' : 'Connecting to real-time events stream...'}
          >
            <span className="relative flex h-2 w-2">
              {sseConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  sseConnected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              ></span>
            </span>
            <span className="text-blue-100/80 hidden md:inline text-[11px] font-mono">
              {sseConnected ? 'LIVE SSE' : 'CONNECTING'}
            </span>
          </div>

          {/* VPN Indicator */}
          <div
            className={`min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium border ${
              status.vpnConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
            title={
              status.vpnConnected
                ? 'Corporate VPN / Whitelist reachability verified'
                : 'Bitbucket domain not reachable. Please connect your corporate VPN.'
            }
          >
            {status.vpnConnected ? (
              <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 animate-pulse" />
            )}
            <span className="hidden sm:inline font-mono text-[11px]">
              {status.vpnConnected ? 'VPN OK' : 'VPN REQUIRED'}
            </span>
          </div>

          {/* Scheduler Master Switch */}
          <button
            onClick={() => onToggleScheduler(!status.isRunning)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
              status.isRunning
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                : 'bg-amber-600/90 hover:bg-amber-500 text-white shadow-amber-900/30'
            }`}
            title={status.isRunning ? 'Pause Background Scheduler' : 'Start Background Scheduler'}
          >
            {status.isRunning ? (
              <>
                <Play className="w-3 h-3 fill-white" />
                <span className="hidden sm:inline">Scheduler on</span>
                <span className="sm:hidden">On</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3 fill-white" />
                <span className="hidden sm:inline">Scheduler paused</span>
                <span className="sm:hidden">Paused</span>
              </>
            )}
          </button>

          {/* Manual Refresh */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 text-blue-50 transition-colors disabled:opacity-50"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          {/* Persistent Identity: User Profile Card / Menu */}
          {userProfile && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="min-h-11 flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-xl bg-white/10 border border-white/15 hover:bg-white/15 transition-all text-xs text-white active:scale-[0.98]"
                title={`Logged in as ${userProfile.displayName} (@${userProfile.username})`}
              >
                {userProfile.avatarUrl ? (
                  <img
                    src={userProfile.avatarUrl}
                    alt={userProfile.displayName}
                    className="w-6 h-6 rounded-full object-cover bg-slate-100 border border-emerald-500/50"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-[10px] flex items-center justify-center border border-emerald-500/50">
                    {userProfile.displayName.charAt(0) || userProfile.username.charAt(0)}
                  </div>
                )}
                <span className="font-semibold text-slate-900 hidden lg:inline max-w-[120px] truncate">
                  {userProfile.displayName}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-600" />
              </button>

              {/* Profile Dropdown */}
              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-app-panel/98 backdrop-blur-xl border border-app-line shadow-float p-3 space-y-2.5 z-50 animate-scale-in">
                  <div className="flex items-center gap-2.5 pb-2.5 border-b border-app-line">
                    {userProfile.avatarUrl ? (
                      <img
                        src={userProfile.avatarUrl}
                        alt={userProfile.displayName}
                        className="w-9 h-9 rounded-full object-cover bg-slate-100 border border-emerald-500/50"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold text-sm flex items-center justify-center">
                        {userProfile.displayName.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-app-ink truncate">
                        {userProfile.displayName}
                      </div>
                      <div className="text-[11px] font-mono text-app-muted truncate">
                        @{userProfile.username}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-app-muted space-y-1">
                    <div className="flex justify-between">
                      <span>Edition:</span>
                      <span className="text-brand-700 font-semibold">
                        {userProfile.serverEdition || userProfile.serverType.toUpperCase()}
                      </span>
                    </div>
                    {userProfile.email && (
                      <div className="flex justify-between">
                        <span>Email:</span>
                        <span className="text-app-ink truncate max-w-[140px]">
                          {userProfile.email}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-app-line flex flex-col gap-1">
                    {onOpenSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onOpenSettings();
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-app-ink hover:bg-brand-50 flex items-center gap-2 transition-colors"
                      >
                        <Key className="w-3.5 h-3.5 text-blue-400" />
                        <span>Token & Network Settings</span>
                      </button>
                    )}
                    {onSwitchAccount && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onSwitchAccount();
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-rose-700 hover:text-rose-800 hover:bg-rose-50 flex items-center gap-2 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5 text-rose-400" />
                        <span>Disconnect / Switch Token</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
