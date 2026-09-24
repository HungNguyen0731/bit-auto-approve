import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, ExternalLink, KeyRound, Loader2, RefreshCw, TerminalSquare } from 'lucide-react';
import { api, encryptTokenForWorker } from '../api/client';
import type { PairingSessionView, WorkerInstallerManifest, WorkerRecord } from '../types';
import { WorkerStatus } from './WorkerStatus';

interface WorkerSetupProps {
  workers: WorkerRecord[];
  configHasToken: boolean;
  onRefresh: () => Promise<void>;
}

export const WorkerSetup: React.FC<WorkerSetupProps> = ({ workers, configHasToken, onRefresh }) => {
  const [manifest, setManifest] = useState<WorkerInstallerManifest | null>(null);
  const [pairing, setPairing] = useState<PairingSessionView | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const terminalPairingWorkerIds = useRef<Set<string> | null>(null);
  const localTerminal = Boolean(manifest?.terminalRunAvailable);
  const secureCloud = window.location.protocol === 'https:';
  const bootstrapCommand = `curl -fLSs --proto '=https' --tlsv1.2 '${window.location.origin}/api/worker-installer/bootstrap/setup' -o "$HOME/Downloads/bitbucket-worker-setup.sh" && /bin/zsh "$HOME/Downloads/bitbucket-worker-setup.sh" '${window.location.origin}'`;

  useEffect(() => {
    api.getWorkerInstallerManifest().then(setManifest).catch(() => setManifest(null));
  }, []);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => onRefresh(), 3000);
    return () => window.clearInterval(timer);
  }, [pairing, onRefresh]);

  useEffect(() => {
    const previousIds = terminalPairingWorkerIds.current;
    if (!previousIds) return;
    const newWorker = workers.find((worker) => !previousIds.has(worker.id));
    if (!newWorker) return;
    terminalPairingWorkerIds.current = null;
    if (!configHasToken) {
      setMessage('Terminal Worker paired. Enter a Bitbucket token below to finish connecting it.');
      return;
    }
    setBusy(`migrate-${newWorker.id}`);
    api.migrateLocalToken(newWorker.id)
      .then(() => {
        setMessage('Terminal Worker paired. The saved token was encrypted for this Mac and queued automatically.');
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Worker paired, but the saved token could not be queued');
      })
      .finally(() => setBusy(null));
  }, [workers, configHasToken]);

  const createPairing = async () => {
    setBusy('pair');
    setMessage(null);
    try {
      const next = await api.createPairingSession(window.location.origin);
      setPairing(next);
      window.location.href = next.pairUrl;
      setMessage('Installer pairing request opened. This page will detect the first heartbeat automatically.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create pairing session');
    } finally {
      setBusy(null);
    }
  };

  const runTerminalWorker = async () => {
    setBusy('terminal');
    setMessage(null);
    try {
      terminalPairingWorkerIds.current = new Set(workers.map((worker) => worker.id));
      const next = await api.createPairingSession(window.location.origin);
      setPairing(next);
      if (localTerminal) {
        await api.runTerminalWorker(next.pairUrl);
        setMessage('Terminal opened. Pairing and saved-token delivery continue automatically; keep that Terminal window open while jobs run.');
      } else {
        window.location.href = next.pairUrl.replace(/^bitbucket-pr-worker:/, 'bitbucket-pr-worker-portable:');
        setMessage('Approve opening Bitbucket PR Worker in your browser. If nothing opens, run the one-time Mac setup command below first.');
      }
    } catch (error) {
      terminalPairingWorkerIds.current = null;
      setMessage(error instanceof Error ? error.message : 'Unable to run Terminal Worker');
    } finally {
      setBusy(null);
    }
  };

  const copyBootstrapCommand = async () => {
    try {
      await navigator.clipboard.writeText(bootstrapCommand);
      setMessage('One-time setup command copied. Review it, then paste it into Terminal on your Mac. Return here and click Run in Terminal.');
    } catch {
      setMessage('Clipboard unavailable. Copy the command shown below manually.');
    }
  };

  const migrateSavedToken = async (workerId: string) => {
    setBusy(`migrate-${workerId}`);
    try {
      await api.migrateLocalToken(workerId);
      setMessage('Encrypted local token queued for the Worker. It will be removed from the relay after acknowledgement.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to migrate local token');
    } finally {
      setBusy(null);
    }
  };

  const sendToken = async (worker: WorkerRecord) => {
    if (!token.trim()) return;
    setBusy(`token-${worker.id}`);
    try {
      const ciphertext = await encryptTokenForWorker(worker.publicKey, token.trim());
      await api.sendWorkerTokenEnvelope(worker.id, ciphertext);
      setToken('');
      setMessage('Token encrypted for this Worker and queued for one-time delivery.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to encrypt token');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-app-line bg-app-panel p-5 shadow-soft sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Local Worker</span>
            <h2 className="mt-2 text-xl font-bold text-app-ink">Install once, then let the workstation VPN do the work.</h2>
            <p className="mt-2 text-sm leading-6 text-app-muted">
              The Worker runs after login, receives jobs outbound-only, pauses on VPN loss, and resumes future cycles automatically.
            </p>
          </div>
          <button onClick={onRefresh} className="min-h-11 rounded-xl border border-app-line px-3 text-xs font-semibold text-app-ink hover:bg-brand-50">
            <RefreshCw className="mr-2 inline h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            onClick={runTerminalWorker}
            disabled={!(localTerminal || (manifest?.portableRunAvailable && secureCloud)) || busy === 'terminal'}
            className="min-h-24 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            {busy === 'terminal' ? <Loader2 className="h-5 w-5 animate-spin" /> : <TerminalSquare className="h-5 w-5" />}
            <div className="mt-2 text-sm font-bold">1. Run in Terminal</div>
            <div className="mt-1 text-[11px]">{localTerminal ? 'Runs on this Mac without setup' : 'Opens the Mac launcher after one-time setup'}</div>
          </button>
          {!localTerminal && (
            <div className="min-h-24 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-brand-800 sm:col-span-2">
              <Copy className="h-5 w-5" />
              <div className="mt-2 text-sm font-bold">Set up this Mac once</div>
              <p className="mt-1 text-xs">{secureCloud ? 'Copy, review, then run this command in Terminal. Requires Apple Command Line Tools; no .pkg or app administrator permission.' : 'Connect through the HTTPS domain first. Pairing and setup are disabled over public HTTP.'}</p>
              {secureCloud && manifest?.portableRunAvailable && (
                <>
                  <button type="button" onClick={copyBootstrapCommand} className="mt-3 min-h-11 rounded-xl bg-brand-700 px-4 text-xs font-semibold text-white">Copy setup command</button>
                  <code className="mt-3 block break-all rounded-lg bg-white p-2 text-[10px] select-all">{bootstrapCommand}</code>
                </>
              )}
            </div>
          )}
          <a
            href={manifest?.available ? manifest.downloadUrl : undefined}
            className={`min-h-24 rounded-2xl border p-4 ${manifest?.available ? 'border-brand-200 bg-brand-50 text-brand-800' : 'pointer-events-none border-slate-200 bg-slate-100 text-slate-500'}`}
          >
            <Download className="h-5 w-5" />
            <div className="mt-2 text-sm font-bold">Alternative: macOS package</div>
            <div className="mt-1 text-[11px]">{manifest?.signed ? 'Signed production package' : 'Unsigned development package — Gatekeeper may block it'}</div>
          </a>
          <button onClick={createPairing} disabled={!manifest?.available || busy === 'pair'} className="min-h-24 rounded-2xl border border-brand-200 bg-white p-4 text-left text-brand-800 hover:bg-brand-50 disabled:opacity-50">
            {busy === 'pair' ? <Loader2 className="h-5 w-5 animate-spin" /> : <ExternalLink className="h-5 w-5" />}
            <div className="mt-2 text-sm font-bold">Pair installed package</div>
            <div className="mt-1 text-[11px]">Only for the packaged app; code expires in ten minutes</div>
          </button>
          <div className="min-h-24 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            <div className="mt-2 text-sm font-bold">Connected automatically</div>
            <div className="mt-1 text-[11px]">Heartbeat and VPN pause/resume; Terminal stays open</div>
          </div>
        </div>

        {pairing && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            Pairing code <strong className="font-mono">{pairing.code}</strong> expires at {new Date(pairing.expiresAt).toLocaleTimeString()}.
            {!localTerminal && <a className="ml-2 font-semibold underline" href={pairing.pairUrl.replace(/^bitbucket-pr-worker:/, 'bitbucket-pr-worker-portable:')}>Open Mac launcher</a>}
          </div>
        )}
        {message && <div role="status" className="mt-4 text-xs text-app-muted">{message}</div>}
      </section>

      <WorkerStatus workers={workers} />

      {workers.map((worker) => (
        <section key={`credential-${worker.id}`} className="rounded-2xl border border-app-line bg-app-panel p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-app-ink">Credential for {worker.name}</h3>
              <p className="mt-1 text-xs text-app-muted">Encrypted with the Worker's RSA public key. The control plane stores ciphertext only.</p>
            </div>
            {configHasToken && (
              <button onClick={() => migrateSavedToken(worker.id)} disabled={busy === `migrate-${worker.id}`} className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-semibold text-emerald-800">
                <KeyRound className="mr-2 inline h-4 w-4" /> Use saved local token
              </button>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Or enter a Bitbucket token once" className="min-h-11 flex-1 rounded-xl border border-app-line bg-white px-3 text-sm" />
            <button onClick={() => sendToken(worker)} disabled={!token.trim() || busy === `token-${worker.id}`} className="min-h-11 rounded-xl bg-brand-700 px-4 text-xs font-semibold text-white disabled:opacity-50">Encrypt & Send</button>
          </div>
        </section>
      ))}
    </div>
  );
};
