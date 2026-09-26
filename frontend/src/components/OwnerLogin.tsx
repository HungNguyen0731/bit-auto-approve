import React, { useState } from 'react';
import { Download, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { BitbucketMark } from './VisualArtwork';

export const OwnerLogin: React.FC<{ onAuthenticated: () => void }> = ({ onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.loginOwner(password);
      setPassword('');
      onAuthenticated();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="soft-canvas flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-[28px] border border-white/80 bg-app-panel p-7 shadow-float">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white"><BitbucketMark className="h-6 w-6" /></div>
        <h1 className="mt-5 text-2xl font-bold text-app-ink">Control Plane Owner</h1>
        <p className="mt-2 text-sm leading-6 text-app-muted">Sign in to manage jobs, pair local Workers, and view execution logs.</p>
        <label className="mt-6 block text-xs font-semibold text-slate-700">Owner password</label>
        <div className="relative mt-2">
          <KeyRound className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-11 w-full rounded-xl border border-app-line bg-white pl-10 pr-3 text-sm" />
        </div>
        {error && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
        <button type="submit" disabled={!password || busy} className="mt-5 min-h-11 w-full rounded-xl bg-brand-700 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Signing in...</> : 'Sign in'}
        </button>
        <a href="/downloads/Bitbucket-PR-Approver-0.3.3-macOS.zip" download className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-app-line bg-white text-sm font-semibold text-brand-700 hover:bg-brand-50">
          <Download className="h-4 w-4" aria-hidden="true" /> Tải app cho Mac
        </a>
      </form>
    </main>
  );
};
