import React, { useState, useEffect } from 'react';
import {
  BitbucketAuthType,
  BitbucketServerType,
  BitbucketUserProfile,
  MaskedConnectionConfig,
  VerifyTokenRequest,
} from '../types';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp,
  Save,
  Globe,
  UserCheck,
} from 'lucide-react';
import { BitbucketMark, VisualArtwork } from './VisualArtwork';

interface TokenCardProps {
  config: MaskedConnectionConfig | null;
  onTestConnection: (req: VerifyTokenRequest) => Promise<BitbucketUserProfile>;
  onSaveConfig: (req: Partial<VerifyTokenRequest>) => Promise<void>;
  isTesting: boolean;
  isSaving: boolean;
}

export const TokenCard: React.FC<TokenCardProps> = ({
  config,
  onTestConnection,
  onSaveConfig,
  isTesting,
  isSaving,
}) => {
  const serverType: BitbucketServerType = 'cloud';
  const baseUrl = 'https://api.bitbucket.org/2.0';
  const authType: BitbucketAuthType = 'basic';
  const [username, setUsername] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [skipSsl, setSkipSsl] = useState<boolean>(false);
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [timeoutMs, setTimeoutMs] = useState<number>(15000);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [verifiedUser, setVerifiedUser] = useState<BitbucketUserProfile | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Sync with initial config loaded from server
  useEffect(() => {
    if (config) {
      setUsername(config.username || '');
      setSelectedWorkspace(config.workspace || '');
      setSkipSsl(Boolean(config.skipSslVerification));
      setProxyUrl(config.proxyUrl || '');
      setTimeoutMs(config.timeoutMs || 15000);
    }
  }, [config]);

  const handleTest = async () => {
    setTestError(null);
    setVerifiedUser(null);
    try {
      const user = await onTestConnection({
        serverType,
        baseUrl: baseUrl.trim(),
        authType,
        token: token.trim() || undefined,
        username: username.trim() || undefined,
        workspace: selectedWorkspace || config?.workspace,
        skipSslVerification: skipSsl,
        proxyUrl: proxyUrl.trim() || undefined,
        timeoutMs,
      });
      setVerifiedUser(user);
      setSelectedWorkspace(user.selectedWorkspace || user.workspaces?.[0]?.slug || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setTestError(msg);
    }
  };

  const handleSave = async () => {
    await onSaveConfig({
      serverType,
      baseUrl: baseUrl.trim(),
      authType,
      token: token.trim() || undefined,
      username: username.trim() || undefined,
      workspace: selectedWorkspace || verifiedUser?.selectedWorkspace || config?.workspace,
      skipSslVerification: skipSsl,
      proxyUrl: proxyUrl.trim() || undefined,
      timeoutMs,
    });
    // Clear in-memory raw token input after save for hygiene
    if (token) {
      setToken('');
    }
  };

  return (
    <div className="rounded-2xl bg-app-panel border border-app-line shadow-soft overflow-hidden">
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-app-line bg-app-panel-muted/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-brand-500 text-white shadow-sm">
            <BitbucketMark className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-app-ink tracking-tight">
              Bitbucket Connection & Authentication
            </h2>
            <p className="text-xs text-slate-600">
              Encrypted at rest with AES-256-GCM. Token never exposed in plain text.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold"><BitbucketMark className="w-4 h-4 text-brand-500" /> Bitbucket Cloud v2.0</div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem] gap-5 items-start p-5 pb-0">
        <div>
          <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Encrypted locally</span>
          <h3 className="mt-3 text-lg font-bold text-app-ink">A live identity, not a demo connection.</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">Verify the real Bitbucket Cloud profile before storing an updated credential.</p>
        </div>
        <VisualArtwork variant={verifiedUser ? 'verified' : 'credentials'} className="hidden lg:block -mt-8 w-full" />
      </div>

      <div className="p-5 space-y-4">
        {/* URL and Auth Type Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Bitbucket Base URL <span className="text-rose-700">*</span>
            </label>
            <div className="relative">
              <input
                type="url"
                value={baseUrl}
                readOnly
                placeholder="https://api.bitbucket.org/2.0"
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-sm text-slate-900 placeholder-slate-600 outline-none transition-all font-mono"
              />
              <Globe className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
            </div>
            <span className="text-[11px] text-slate-600 mt-1 block">
              Default Bitbucket Cloud REST API v2 base address
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Authentication Method
            </label>
            <select
              value={authType}
              disabled
              className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-sm text-slate-900 outline-none transition-all"
            >
              <option value="bearer">Bearer Token (Personal Access Token)</option>
              <option value="basic">Basic Auth / App Password</option>
            </select>
            <span className="text-[11px] text-slate-600 mt-1 block">
              Requires username + App Password
            </span>
          </div>
        </div>

        {/* Username & Token Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {authType === 'basic' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Username / Email <span className="text-rose-700">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="developer.username"
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-sm text-slate-900 placeholder-slate-600 outline-none transition-all"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">
                App Password / Secret
                {!config?.hasToken && <span className="text-rose-700 ml-1">*</span>}
              </label>
              {config?.hasToken && (
                <span className="text-[11px] text-emerald-700 flex items-center gap-1 font-mono">
                  <Lock className="w-3 h-3" /> Saved: {config.tokenPreview}
                </span>
              )}
            </div>

            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={config?.hasToken ? 'Enter new token to update (or leave blank to keep saved)' : 'Paste Personal Access Token here'}
                className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2 text-sm text-slate-900 placeholder-slate-600 outline-none transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-700 p-0.5 rounded transition-colors"
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Corporate Network Options Accordion */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
          >
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>Advanced Corporate Network Settings (Proxy, Self-Signed SSL, Timeout)</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 p-4 rounded-xl bg-app-panel-muted border border-app-line space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    HTTP/HTTPS Proxy (Optional)
                  </label>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="http://proxy.corp.internal:8080"
                    className="w-full bg-app-panel border border-app-line rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder-slate-600 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Request Timeout (ms)
                  </label>
                  <input
                    type="number"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                    min={3000}
                    max={60000}
                    className="w-full bg-app-panel border border-app-line rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none font-mono"
                  />
                </div>
              </div>

              {/* Skip SSL Toggle */}
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="skipSsl"
                  checked={skipSsl}
                  onChange={(e) => setSkipSsl(e.target.checked)}
                  className="mt-0.5 rounded border-app-line bg-app-panel text-brand-700 focus:ring-brand-500 cursor-pointer"
                />
                <label htmlFor="skipSsl" className="text-xs text-slate-700 cursor-pointer">
                  <span className="font-semibold text-amber-800">Skip SSL Certificate Verification</span> (NODE_TLS_REJECT_UNAUTHORIZED = 0)
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Enable only for internal corporate servers using self-signed or private enterprise root CA certificates.
                  </p>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Test Result Error Banner */}
        {testError && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-700" />
            <div>
              <span className="font-semibold">Connection Test Failed:</span> {testError}
              <div className="mt-1 text-[11px] text-rose-700/90">
                Please verify that your corporate VPN client is active and that your token has repository read/write permissions.
              </div>
            </div>
          </div>
        )}

        {/* Verified Profile Card */}
        {verifiedUser && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {verifiedUser.avatarUrl ? (
                <img
                  src={verifiedUser.avatarUrl}
                  alt={verifiedUser.displayName}
                  className="w-12 h-12 rounded-full border-2 border-emerald-500/40 object-cover bg-slate-100"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-emerald-600/30 border-2 border-emerald-500/40 text-emerald-800 flex items-center justify-center font-bold text-lg">
                  {verifiedUser.displayName.charAt(0) || verifiedUser.username.charAt(0)}
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-app-ink">
                    {verifiedUser.displayName}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-800 border border-emerald-500/30 flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> VERIFIED
                  </span>
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 font-mono">
                  <span>@{verifiedUser.username}</span>
                  {verifiedUser.email && <span>{verifiedUser.email}</span>}
                  <span className="capitalize text-slate-600">
                    Platform: {verifiedUser.serverType}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:items-end text-xs text-slate-600">
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Bitbucket API Ready
              </span>
              <span className="text-[11px] mt-0.5">
                Checked at {new Date(verifiedUser.verifiedAt).toLocaleTimeString()}
              </span>
              {verifiedUser.workspaces && verifiedUser.workspaces.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                  <span className="flex-shrink-0">Workspace</span>
                  <select
                    value={selectedWorkspace}
                    onChange={(event) => setSelectedWorkspace(event.target.value)}
                    className="min-h-11 min-w-[11rem] rounded-lg border border-emerald-300 bg-white px-2.5 font-mono text-[11px] text-slate-900"
                  >
                    {verifiedUser.workspaces.map((workspace) => (
                      <option key={workspace.uuid} value={workspace.slug}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-app-line">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || (!token && !config?.hasToken)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-700 text-slate-900 text-xs font-semibold border border-slate-300 transition-colors disabled:opacity-50"
          >
            {isTesting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-700" />
                <span>Testing Bitbucket Link & Auth...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-brand-700" />
                <span>Test Connection & Verify Token</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Encrypted Config...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Credentials</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
