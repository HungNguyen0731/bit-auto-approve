import type { ApprovalJob, ApprovalLogEntry, BitbucketBranchMeta, BitbucketRepositoryMeta, BitbucketUserMeta, CreateJobDto, JobFilterRules, MaskedConnectionConfig, OwnerSession, PairingSessionView, PreviewRulesResponse, SchedulerStatus, UpdateJobDto, VerifyTokenRequest, VerifyTokenResponse, WorkerInstallerManifest, WorkerLogEntry, WorkerRecord } from '../types';

const apiBase = () => typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 'http://127.0.0.1:9999/api' : typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? `${window.location.origin}/api` : 'http://127.0.0.1:3100/api';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public rateLimitReset?: number | null) { super(message); this.name = 'ApiError'; }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (options.method || 'GET').toUpperCase();
  if (
    ownerCsrfToken &&
    !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
    endpoint !== '/session/login'
  ) {
    headers.set('X-CSRF-Token', ownerCsrfToken);
  }
  try { response = await fetch(`${apiBase()}${endpoint}`, { ...options, headers }); }
  catch (error) { throw new ApiError('NETWORK_OFFLINE', error instanceof Error ? error.message : 'Cannot reach the local backend.', 0); }
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    const error = json?.error && typeof json.error === 'object' ? json.error : null;
    throw new ApiError(
      error?.code || json?.code || 'GENERIC_API_ERROR',
      error?.message || json?.message || (typeof json?.error === 'string' ? json.error : `Request failed with status ${response.status}`),
      response.status,
      error?.rateLimitReset
    );
  }
  return (json?.data !== undefined ? json.data : json) as T;
}

const items = <T>(value: T[] | { items?: T[] }): T[] => Array.isArray(value) ? value : value?.items || [];
const qs = (values: Record<string, string | number | undefined>) => { const result = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') result.set(key, String(value)); }); return result.toString(); };
let ownerCsrfToken: string | undefined;

async function ensureOwnerSession(): Promise<void> {
  if (ownerCsrfToken) return;
  const session = await request<{ authenticated: boolean; csrfToken?: string }>('/session');
  ownerCsrfToken = session.csrfToken;
}

async function ownerMutation<T>(endpoint: string, body?: unknown): Promise<T> {
  await ensureOwnerSession();
  return request<T>(endpoint, {
    method: 'POST',
    headers: ownerCsrfToken ? { 'X-CSRF-Token': ownerCsrfToken } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  getOwnerSession: async () => {
    const session = await request<OwnerSession>('/session');
    ownerCsrfToken = session.csrfToken;
    return session;
  },
  loginOwner: async (password: string) => {
    const session = await request<OwnerSession>('/session/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    ownerCsrfToken = session.csrfToken;
    return session;
  },
  logoutOwner: async () => {
    const result = await request<{ authenticated: boolean }>('/session/logout', { method: 'POST' });
    ownerCsrfToken = undefined;
    return result;
  },
  getStatus: () => request<SchedulerStatus>('/status'),
  toggleScheduler: (enabled: boolean) => request<SchedulerStatus>('/status/toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
  getConfig: () => request<MaskedConnectionConfig>('/config'),
  updateConfig: (data: Partial<VerifyTokenRequest>) => request<MaskedConnectionConfig>('/config', { method: 'POST', body: JSON.stringify({ ...data, serverType: 'cloud', baseUrl: 'https://api.bitbucket.org/2.0' }) }),
  verifyToken: (data: VerifyTokenRequest) => request<VerifyTokenResponse>('/config/test', { method: 'POST', body: JSON.stringify({ ...data, serverType: 'cloud', baseUrl: 'https://api.bitbucket.org/2.0' }) }),
  restoreSession: (workspace?: string) => request<VerifyTokenResponse>('/config/test', { method: 'POST', body: JSON.stringify({ workspace }) }),
  async getJobs() { return items(await request<ApprovalJob[] | { items?: ApprovalJob[] }>('/jobs')); },
  createJob: (dto: CreateJobDto) => request<ApprovalJob>('/jobs', { method: 'POST', body: JSON.stringify(dto) }),
  updateJob: (id: string, dto: UpdateJobDto) => request<ApprovalJob>(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  deleteJob: (id: string) => request<{ success: boolean }>(`/jobs/${id}`, { method: 'DELETE' }),
  toggleJob: (id: string) => request<ApprovalJob>(`/jobs/${id}/toggle`, { method: 'POST' }),
  runJobNow: (id: string) => request<{ success: boolean; message: string }>(`/jobs/${id}/run-now`, { method: 'POST' }),
  async getLogs(params?: { limit?: number; status?: string }) { return items(await request<ApprovalLogEntry[] | { items?: ApprovalLogEntry[] }>(`/logs?${qs(params || {})}`)); },
  clearLogs: () => request<{ success: boolean }>('/logs', { method: 'DELETE' }),
  previewRules: (rules: JobFilterRules) => request<PreviewRulesResponse>('/prs/preview', { method: 'POST', body: JSON.stringify({ rules }) }),
  async getRepositories(params?: { query?: string; project?: string; workspace?: string; limit?: number }) { return items(await request<BitbucketRepositoryMeta[] | { items?: BitbucketRepositoryMeta[] }>(`/bitbucket/repositories?${qs(params || {})}`)); },
  async getBranches(params: { repository: string; query?: string; limit?: number }) { return items(await request<BitbucketBranchMeta[] | { items?: BitbucketBranchMeta[] }>(`/bitbucket/branches?${qs(params)}`)); },
  async getUsers(params?: { workspace?: string; query?: string; limit?: number }) { return items(await request<BitbucketUserMeta[] | { items?: BitbucketUserMeta[] }>(`/bitbucket/users?${qs(params || {})}`)); },
  async getPullRequests(params: { repository: string; state?: string; query?: string; limit?: number }) { return items(await request<unknown[] | { items?: unknown[] }>(`/bitbucket/pull-requests?${qs(params)}`)); },
  clearMetadataCache: () => request<{ success: boolean; message: string }>('/bitbucket/cache/clear', { method: 'POST' }),
  getWorkers: () => request<WorkerRecord[]>('/workers'),
  createPairingSession: (controlPlaneUrl?: string) => ownerMutation<PairingSessionView>('/workers/pairing-sessions', { controlPlaneUrl }),
  revokeWorker: (workerId: string) => ownerMutation<WorkerRecord>(`/workers/${encodeURIComponent(workerId)}/revoke`),
  migrateLocalToken: (workerId: string) => ownerMutation<{ envelopeId: string; expiresAt: string }>(`/workers/${encodeURIComponent(workerId)}/migrate-local-token`),
  sendWorkerTokenEnvelope: (workerId: string, ciphertext: string) => ownerMutation<{ id: string; expiresAt: string }>(`/workers/${encodeURIComponent(workerId)}/token-envelope`, { ciphertext }),
  getWorkerLogs: (params?: { workerId?: string; jobId?: string; executionId?: string; status?: string; repository?: string; search?: string; limit?: number }) => request<WorkerLogEntry[]>(`/worker-logs?${qs(params || {})}`),
  getWorkerInstallerManifest: () => request<WorkerInstallerManifest>('/worker-installer/manifest'),
  runTerminalWorker: (pairUrl: string) => ownerMutation<{ started: boolean; launcherPath: string }>('/worker-installer/terminal-run', { pairUrl }),
};

export async function encryptTokenForWorker(publicKey: JsonWebKey, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(token)
  );
  const bytes = new Uint8Array(ciphertext);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
