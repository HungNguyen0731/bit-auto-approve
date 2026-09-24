import React, { useState } from 'react';
import {
  BitbucketAuthType,
  BitbucketServerType,
  BitbucketUserProfile,
  MaskedConnectionConfig,
  VerifyTokenRequest,
} from '../types';
import {
  Wifi,
  Sparkles,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  Lock,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Check,
} from 'lucide-react';
import { BitbucketMark, VisualArtwork, ArtworkVariant } from './VisualArtwork';

interface OnboardingGatekeeperProps {
  initialConfig?: MaskedConnectionConfig | null;
  onTestConnection: (req: VerifyTokenRequest) => Promise<BitbucketUserProfile>;
  onSaveConfig: (req: Partial<VerifyTokenRequest>) => Promise<void>;
  onComplete: (savedConfig: MaskedConnectionConfig, profile?: BitbucketUserProfile) => void;
  onSkipToDemo?: () => void; // legacy prop ignored: Cloud verification cannot be skipped
  isTesting: boolean;
  isSaving: boolean;
}

export const OnboardingGatekeeper: React.FC<OnboardingGatekeeperProps> = ({
  initialConfig,
  onTestConnection,
  onSaveConfig,
  onComplete,
  isTesting,
  isSaving,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Form states
  const serverType: BitbucketServerType = 'cloud';
  const baseUrl = 'https://api.bitbucket.org/2.0';
  const authType: BitbucketAuthType = 'basic';
  const [username, setUsername] = useState<string>(initialConfig?.username || '');
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(initialConfig?.workspace || '');

  // Advanced network
  const [skipSsl, setSkipSsl] = useState<boolean>(
    Boolean(initialConfig?.skipSslVerification)
  );
  const [proxyUrl, setProxyUrl] = useState<string>(initialConfig?.proxyUrl || '');
  const [timeoutMs, setTimeoutMs] = useState<number>(initialConfig?.timeoutMs || 15000);

  // Handshake verification
  const [verifiedUser, setVerifiedUser] = useState<BitbucketUserProfile | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<{
    code: string;
    message: string;
    suggestion?: string;
    canAutoFixSsl?: boolean;
  } | null>(null);

  const handleTestHandshake = async () => {
    setDiagnosticError(null);
    setVerifiedUser(null);
    try {
      const user = await onTestConnection({
        serverType,
        baseUrl: baseUrl.trim(),
        authType,
        token: token.trim() || undefined,
        username: username.trim() || undefined,
        workspace: selectedWorkspace || initialConfig?.workspace,
        skipSslVerification: skipSsl,
        proxyUrl: proxyUrl.trim() || undefined,
        timeoutMs,
      });
      setVerifiedUser(user);
      setSelectedWorkspace(user.selectedWorkspace || user.workspaces?.[0]?.slug || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let code = 'ERROR';
      let suggestion = 'Please check your Bitbucket credentials and network status.';
      let canAutoFixSsl = false;

      if (msg.includes('SSL') || msg.includes('certificate') || msg.includes('DEPTH_ZERO_SELF_SIGNED_CERT')) {
        code = 'ERR_SSL';
        suggestion = 'Internal corporate CA detected. Enable "Skip SSL Certificate Verification" to proceed.';
        canAutoFixSsl = true;
      } else if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
        code = 'ERR_NETWORK';
        suggestion = 'Corporate VPN unreachable. Please ensure WireGuard/OpenVPN tunnel is connected.';
      } else if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('auth')) {
        code = 'ERR_AUTH';
        suggestion = 'Invalid credentials or Personal Access Token expired. Required scopes: PROJECT_READ, REPO_READ, REPO_WRITE.';
      }

      setDiagnosticError({
        code,
        message: msg,
        suggestion,
        canAutoFixSsl,
      });
    }
  };

  const handleEnterDashboard = async () => {
    try {
      await onSaveConfig({
        serverType,
        baseUrl: baseUrl.trim(),
        authType,
        token: token.trim() || undefined,
        username: username.trim() || undefined,
        workspace: selectedWorkspace || verifiedUser?.selectedWorkspace,
        skipSslVerification: skipSsl,
        proxyUrl: proxyUrl.trim() || undefined,
        timeoutMs,
      });

      const saved: MaskedConnectionConfig = {
        serverType,
        baseUrl: baseUrl.trim(),
        authType,
        username: username.trim() || undefined,
        workspace: selectedWorkspace || verifiedUser?.selectedWorkspace,
        hasToken: Boolean(token.trim() || initialConfig?.hasToken),
        tokenPreview: token.trim() ? `••••••••${token.trim().slice(-4)}` : initialConfig?.tokenPreview,
        skipSslVerification: skipSsl,
        proxyUrl: proxyUrl.trim() || undefined,
        timeoutMs,
      };

      onComplete(saved, verifiedUser || undefined);
    } catch (err) {
      console.error('Failed to save config in onboarding:', err);
    }
  };

  const steps = [
    { num: 1, title: 'Cloud account', desc: 'Bitbucket Cloud v2.0' },
    { num: 2, title: 'Credentials', desc: 'Atlassian username and App Password' },
    { num: 3, title: 'Connection', desc: 'Optional proxy and timeout' },
    { num: 4, title: 'Verify & Connect', desc: 'Handshake test & profile confirmation' },
  ];

  const stepVisuals: Record<number, { variant: ArtworkVariant; eyebrow: string; title: string; body: string }> = {
    1: {
      variant: 'cloud',
      eyebrow: 'Cloud-native setup',
      title: 'Connect the workspace you already trust.',
      body: 'A guided connection to Bitbucket Cloud v2.0 with no server-side fallback or simulated identity.',
    },
    2: {
      variant: 'credentials',
      eyebrow: 'Local security boundary',
      title: 'Your App Password stays on this machine.',
      body: 'Credentials are encrypted locally and used only for authenticated Bitbucket API requests.',
    },
    3: {
      variant: 'connection',
      eyebrow: 'Corporate-ready networking',
      title: 'Route safely through your existing network.',
      body: 'Tune proxy, certificate, and timeout settings without moving the approval runner outside your VPN.',
    },
    4: {
      variant: verifiedUser ? 'verified' : 'verification',
      eyebrow: verifiedUser ? 'Identity verified' : 'Live handshake',
      title: verifiedUser ? 'You are ready to automate.' : 'Verify before the dashboard unlocks.',
      body: verifiedUser
        ? `Connected as ${verifiedUser.displayName}. The live Bitbucket profile is now confirmed.`
        : 'We validate the real Cloud identity and permissions before any approval workspace becomes available.',
    },
  };

  const currentVisual = stepVisuals[currentStep];

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-slate-50 soft-canvas flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-8 lg:py-12 relative overflow-hidden selection:bg-blue-600 selection:text-white">
      {/* Background glow ambient */}
      <div className="absolute -top-24 left-[-8rem] h-[30rem] w-[30rem] bg-brand-200/55 blur-3xl pointer-events-none rounded-full" />
      <div className="absolute bottom-[-12rem] right-[-6rem] h-[32rem] w-[32rem] bg-emerald-100/70 blur-3xl pointer-events-none rounded-full" />

      {/* Brand Header */}
      <div className="text-center max-w-xl mx-auto mb-7 relative z-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-500 shadow-[0_14px_36px_rgba(12,102,228,0.25)] text-white mb-3.5 rotate-[-3deg]">
          <BitbucketMark className="w-7 h-7" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
          Bitbucket PR Auto-Approver
        </h1>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-600">
          Secure automation for Bitbucket Cloud pull requests
        </p>
      </div>

      {/* Main Stepper Card */}
      <div className="w-full max-w-6xl rounded-[28px] bg-app-panel/95 border border-white/80 shadow-float relative z-10 overflow-hidden grid lg:grid-cols-[0.86fr_1.14fr] backdrop-blur-xl">
        <aside className="relative hidden lg:flex min-h-[650px] flex-col justify-between overflow-hidden bg-brand-900 p-8 xl:p-10 text-white">
          <div className="visual-grid absolute inset-0 opacity-25" aria-hidden="true" />
          <div className="relative z-10">
            <span className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100">
              {currentVisual.eyebrow}
            </span>
            <h2 className="mt-5 max-w-sm text-3xl font-bold leading-tight tracking-tight text-white">
              {currentVisual.title}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-blue-100/80">
              {currentVisual.body}
            </p>
          </div>

          <div className="relative z-10 -mx-3 my-4">
            <VisualArtwork variant={currentVisual.variant} className="w-full drop-shadow-2xl" />
          </div>

          <div className="relative z-10 flex items-center gap-3 text-xs text-blue-100/75">
            <div className="flex -space-x-2" aria-hidden="true">
              <span className="h-8 w-8 rounded-full border-2 border-brand-900 bg-blue-300" />
              <span className="h-8 w-8 rounded-full border-2 border-brand-900 bg-emerald-300" />
              <span className="h-8 w-8 rounded-full border-2 border-brand-900 bg-amber-300" />
            </div>
            <span>Local-first automation for engineering teams</span>
          </div>
        </aside>

        <section className="min-w-0 flex flex-col bg-app-panel/96">
        {/* Step Indicator Progress Bar */}
        <div className="border-b border-app-line bg-app-panel-muted/80 px-5 sm:px-7 py-4">
          <div className="flex items-center justify-between">
            {steps.map((step) => {
              const isPassed = currentStep > step.num;
              const isCurrent = currentStep === step.num;
              return (
                <button
                  type="button"
                  key={step.num}
                  className="flex min-h-11 items-center gap-2 rounded-xl px-1 text-left disabled:cursor-default"
                  disabled={!isPassed && !isCurrent}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={
                    isCurrent
                      ? `Current step ${step.num}`
                      : isPassed
                      ? `Return to step ${step.num}: ${step.title}`
                      : `Step ${step.num} unavailable`
                  }
                  onClick={() => {
                    if (isPassed || isCurrent) setCurrentStep(step.num as any);
                  }}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
                      isPassed
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : isCurrent
                        ? 'bg-blue-600 text-white ring-2 ring-blue-500/30'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isPassed ? <Check className="w-4 h-4 stroke-[3]" /> : step.num}
                  </div>
                  <span
                    className={`hidden sm:inline text-xs font-semibold ${
                      isCurrent
                        ? 'text-slate-950'
                        : isPassed
                        ? 'text-slate-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {step.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Content Container */}
        <div className="p-5 sm:p-8 space-y-6 flex-1">
          <div className="lg:hidden overflow-hidden rounded-2xl border border-brand-100 bg-brand-50/80">
            <div className="grid sm:grid-cols-[1fr_12rem] items-center gap-2 pl-5">
              <div className="py-5">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">{currentVisual.eyebrow}</span>
                <p className="mt-1.5 text-sm font-bold leading-snug text-app-ink">{currentVisual.title}</p>
              </div>
              <VisualArtwork variant={currentVisual.variant} className="h-36 w-full object-contain sm:h-auto" />
            </div>
          </div>
          {/* STEP 1: Platform Selection & Endpoint Setup */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-base font-bold text-slate-950">Select Bitbucket Platform</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Choose your organization's deployment model to configure the appropriate API client.
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center"><BitbucketMark className="w-5 h-5" /></div>
                <div><h4 className="text-sm font-bold text-slate-950">Bitbucket Cloud v2.0</h4><p className="text-xs text-slate-600 mt-1">This product connects only to api.bitbucket.org. Server and Data Center hosts are not supported.</p></div>
              </div>

              {/* Base URL Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Bitbucket Base URL <span className="text-rose-700">*</span></span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    REST v2.0 endpoint
                  </span>
                </label>
                <input
                  type="url"
                  required
                  value={baseUrl}
                  readOnly
                  placeholder="https://api.bitbucket.org/2.0"
                  className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-600 outline-none font-mono"
                />
                <p className="text-[11px] text-slate-500">
                  The canonical REST root endpoint for Atlassian Bitbucket Cloud.
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: Authentication Credentials & Scopes */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-base font-bold text-slate-950">Authentication & Access Token</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Provide your personal credentials to authorize automated PR reviews.
                </p>
              </div>

              {/* Username for Cloud */}
              {serverType === 'cloud' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Atlassian Account Username <span className="text-rose-700">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. hungnv_atlassian"
                    className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-600 outline-none font-mono"
                  />
                </div>
              )}

              {/* Token Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-brand-700" />
                    <span>
                      App Password
                      <span className="text-rose-700"> *</span>
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-500 font-mono">Encrypted locally</span>
                </div>

                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste Bitbucket App Password..."
                    className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-900 placeholder-slate-600 outline-none font-mono tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-1 top-1/2 min-h-11 min-w-11 -translate-y-1/2 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label={showToken ? 'Hide App Password' : 'Show App Password'}
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Scope Checklist Box */}
              <div className="p-4 rounded-xl bg-app-panel-muted border border-app-line space-y-2.5">
                <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  Required Scopes Checklist
                </h5>
                <p className="text-[11px] text-slate-600">
                  Ensure the created token includes the following permissions in Bitbucket:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                  <div className="p-2 rounded-lg bg-app-panel border border-app-line flex items-center gap-1.5 text-emerald-800">
                    <Check className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                    <span>PROJECT_READ</span>
                  </div>
                  <div className="p-2 rounded-lg bg-app-panel border border-app-line flex items-center gap-1.5 text-emerald-800">
                    <Check className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                    <span>REPO_READ</span>
                  </div>
                  <div className="p-2 rounded-lg bg-app-panel border border-app-line flex items-center gap-1.5 text-emerald-800">
                    <Check className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                    <span>REPO_WRITE</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Advanced Network & Corporate SSL */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-base font-bold text-slate-950">Corporate Network & SSL Settings</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Tailor connection parameters for corporate firewall, self-signed SSL CA, and proxy tunnels.
                </p>
              </div>

              {/* Skip SSL Switch */}
              <div className="p-4 rounded-xl bg-app-panel-muted border border-app-line flex items-start gap-3">
                <input
                  type="checkbox"
                  id="gatekeeper-skip-ssl"
                  checked={skipSsl}
                  onChange={(e) => setSkipSsl(e.target.checked)}
                  className="mt-0.5 rounded border-app-line bg-app-panel text-brand-700 focus:ring-brand-500 cursor-pointer w-4 h-4"
                />
                <label htmlFor="gatekeeper-skip-ssl" className="text-xs text-slate-700 cursor-pointer">
                  <span className="font-semibold text-amber-800">Skip SSL Certificate Verification</span>
                  <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                    Recommended for corporate environments using internal private root CAs or self-signed certificates. Sets <code className="font-mono text-app-ink bg-app-panel-strong px-1 py-0.5 rounded">NODE_TLS_REJECT_UNAUTHORIZED=0</code> for Bitbucket calls.
                  </p>
                </label>
              </div>

              {/* Proxy URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  HTTP / HTTPS Proxy URL (Optional)
                </label>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="e.g. http://proxy.corp.internal:8080"
                  className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder-slate-600 outline-none font-mono"
                />
              </div>

              {/* Request Timeout */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Request Timeout (ms)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  className="w-full bg-app-panel-strong border border-app-line focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-slate-900 outline-none font-mono max-w-xs"
                />
              </div>
            </div>
          )}

          {/* STEP 4: Verification Handshake & Profile Extraction */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-scale-in">
              <div>
                <h3 className="text-base font-bold text-slate-950">Connection Verification</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Perform an end-to-end handshake with Bitbucket to verify your credentials and extract your profile.
                </p>
              </div>

              {/* Trigger Handshake Button */}
              {!verifiedUser && (
                <div className="p-6 rounded-xl bg-app-panel-muted border border-app-line text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 text-brand-700 flex items-center justify-center mx-auto">
                    <Wifi className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-950">Ready for Bitbucket Handshake</h4>
                    <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
                      Connecting to <code className="font-mono text-blue-700">{baseUrl}</code> as a Cloud client.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestHandshake}
                    disabled={isTesting}
                    className="inline-flex min-h-11 items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Performing Handshake...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Verify & Connect</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Diagnostic Error Box if failed */}
              {diagnosticError && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-800 text-xs space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="font-bold text-rose-200">
                        Handshake Failed [{diagnosticError.code}]:
                      </span>
                      <p className="text-rose-800/90 leading-relaxed font-mono text-[11px]">
                        {diagnosticError.message}
                      </p>
                      <p className="text-slate-700 mt-1 font-sans">
                        <strong>Suggested fix:</strong> {diagnosticError.suggestion}
                      </p>
                    </div>
                  </div>

                  {diagnosticError.canAutoFixSsl && (
                    <button
                      type="button"
                      onClick={() => {
                        setSkipSsl(true);
                        setDiagnosticError(null);
                        handleTestHandshake();
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-500/30 font-semibold hover:bg-amber-500/30 transition-colors flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Enable "Skip SSL Verification" and Retry</span>
                    </button>
                  )}
                </div>
              )}

              {/* Verified Profile Card */}
              {verifiedUser && (
                <div className="p-5 rounded-2xl bg-emerald-950/20 border border-emerald-500/40 text-slate-900 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {verifiedUser.avatarUrl ? (
                        <img
                          src={verifiedUser.avatarUrl}
                          alt={verifiedUser.displayName}
                          className="w-14 h-14 rounded-full border-2 border-emerald-400 object-cover bg-slate-100 shadow-md"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-emerald-600/30 border-2 border-emerald-400 text-emerald-800 flex items-center justify-center font-bold text-xl">
                          {verifiedUser.displayName.charAt(0)}
                        </div>
                      )}

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-slate-950">
                            {verifiedUser.displayName}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-800 border border-emerald-500/40 flex items-center gap-1 font-semibold">
                            <CheckCircle2 className="w-3 h-3" /> VERIFIED
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 font-mono">
                          <span>@{verifiedUser.username}</span>
                          {verifiedUser.email && <span>{verifiedUser.email}</span>}
                          <span className="text-brand-700">
                            {verifiedUser.serverEdition || `${verifiedUser.serverType.toUpperCase()} API`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:items-end text-xs">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 font-mono text-[11px] flex items-center gap-1.5">
                        <Wifi className="w-3 h-3 text-emerald-700" />
                        {verifiedUser.latencyMs ? `${verifiedUser.latencyMs}ms Latency` : 'VPN Reachable'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-emerald-500/20 flex items-center justify-between">
                    <div className="min-w-0 flex-1 pr-4">
                      <span className="text-xs text-slate-700">
                        Credentials validated. Ready to enter dashboard.
                      </span>
                      {verifiedUser.workspaces && verifiedUser.workspaces.length > 0 && (
                        <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                          <span className="flex-shrink-0">Active workspace</span>
                          <select
                            value={selectedWorkspace}
                            onChange={(event) => setSelectedWorkspace(event.target.value)}
                            className="min-h-11 min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 font-mono text-[11px] text-slate-900"
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
                    <button
                      type="button"
                      onClick={handleTestHandshake}
                      disabled={isTesting}
                      className="text-xs text-emerald-700 hover:text-emerald-800 font-medium underline"
                    >
                      Re-test
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="px-5 sm:px-7 py-4 bg-app-panel-muted/90 border-t border-app-line flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev - 1) as any)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">


            {currentStep < 4 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev + 1) as any)}
                className="flex min-h-11 items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98]"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEnterDashboard}
                disabled={isSaving || !verifiedUser}
                className="flex min-h-11 items-center gap-1.5 px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Enter Dashboard</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        </section>
      </div>
    </div>
  );
};
