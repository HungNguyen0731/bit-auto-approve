import { useEffect, useState } from 'react';
import type { ApprovalJob } from '../types';

const STORAGE_KEY = 'bitbucket-pr-approver:manual-run-credential';

export interface ManualRunCredential {
  username?: string;
  token: string;
}

export function RunJobModal({ jobs, initialJobId, busy, onClose, onRun }: {
  jobs: ApprovalJob[];
  initialJobId: string;
  busy: boolean;
  onClose: () => void;
  onRun: (jobId: string, credential: ManualRunCredential) => Promise<void>;
}) {
  const [jobId, setJobId] = useState(initialJobId);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const legacyServerJob = jobs.find((job) => job.id === jobId)?.executionMode !== 'worker';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const credential = JSON.parse(saved) as ManualRunCredential;
        setUsername(credential.username || '');
        setToken(credential.token || '');
        setRemember(true);
      }
    } catch { /* Browser storage may be disabled. */ }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!jobId || !token.trim() || legacyServerJob) return;
    setError('');
    try {
      if (remember) localStorage.setItem(STORAGE_KEY, JSON.stringify({ username: username.trim(), token: token.trim() }));
      else localStorage.removeItem(STORAGE_KEY);
      await onRun(jobId, { username: username.trim() || undefined, token: token.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-brand-950/40 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label="Run selected job" onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-app-line bg-white p-6 shadow-2xl">
        <div>
          <h2 className="text-lg font-bold text-app-ink">Run a job with your token</h2>
          <p className="mt-1 text-sm text-app-muted">This credential applies only to the selected run, not the scheduled Worker token.</p>
        </div>
        <label className="block text-sm font-medium">Job
          <select required value={jobId} onChange={(e) => setJobId(e.target.value)} className="mt-1 w-full rounded-xl border border-app-line bg-white p-2.5">
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.name} ({job.executionMode === 'worker' ? 'Local Worker' : 'Legacy Server — unavailable'})</option>)}
          </select>
        </label>
        {legacyServerJob && <p role="alert" className="text-sm text-amber-800">This job must be moved to a paired Mac Worker before Run. Coolify cannot call Bitbucket for it.</p>}
        <label className="block text-sm font-medium">Bitbucket username (optional for bearer token)
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={320} className="mt-1 w-full rounded-xl border border-app-line p-2.5" />
        </label>
        <label className="block text-sm font-medium">Token
          <input required type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-xl border border-app-line p-2.5" />
        </label>
        <label className="flex items-start gap-2 text-sm text-app-muted">
          <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); if (!e.target.checked) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* unavailable */ } } }} className="mt-1" />
          <span>Remember on this browser (localStorage). Anyone with access to this browser, or injected scripts, may read the token.</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-app-line px-4 py-2">Cancel</button>
          <button type="submit" disabled={busy || !jobId || !token.trim() || legacyServerJob} className="rounded-xl bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Starting…' : 'Run selected job'}</button>
        </div>
      </form>
    </div>
  );
}
