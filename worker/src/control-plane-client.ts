import type {
  ClaimResponse,
  EncryptedTokenEnvelope,
  ExecutionResultSummary,
  HeartbeatRequest,
  LogBatchRequest,
  LogBatchResponse,
  PairWorkerRequest,
  PairWorkerResponse,
  WorkerRecord,
} from '@bitbucket-pr-approver/shared';

export class ControlPlaneClient {
  constructor(
    private readonly baseUrl: string,
    private readonly workerId?: string,
    private readonly credential?: string
  ) {}

  pair(request: PairWorkerRequest): Promise<PairWorkerResponse> {
    return this.request('/api/workers/pair', { method: 'POST', body: JSON.stringify(request) }, false);
  }

  heartbeat(request: HeartbeatRequest): Promise<WorkerRecord> {
    return this.request(`/api/workers/${this.requireWorkerId()}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  claim(manualOnly = false): Promise<ClaimResponse> {
    return this.request(`/api/workers/${this.requireWorkerId()}/claims`, {
      method: 'POST', body: JSON.stringify({ manualOnly }),
    });
  }

  renew(executionId: string) {
    return this.request(
      `/api/workers/${this.requireWorkerId()}/executions/${encodeURIComponent(executionId)}/renew`,
      { method: 'POST' }
    );
  }

  sendLogs(executionId: string, batch: LogBatchRequest): Promise<LogBatchResponse> {
    return this.request(
      `/api/workers/${this.requireWorkerId()}/executions/${encodeURIComponent(executionId)}/logs`,
      { method: 'POST', body: JSON.stringify(batch) }
    );
  }

  complete(executionId: string, result: ExecutionResultSummary) {
    return this.request(
      `/api/workers/${this.requireWorkerId()}/executions/${encodeURIComponent(executionId)}/complete`,
      { method: 'POST', body: JSON.stringify(result) }
    );
  }

  claimTokenEnvelope(): Promise<EncryptedTokenEnvelope | null> {
    return this.request(`/api/workers/${this.requireWorkerId()}/token-envelope/claim`, {
      method: 'POST',
    });
  }

  acknowledgeTokenEnvelope(envelopeId: string): Promise<{ removed: boolean }> {
    return this.request(
      `/api/workers/${this.requireWorkerId()}/token-envelope/${encodeURIComponent(envelopeId)}/ack`,
      { method: 'POST' }
    );
  }

  getUpdateManifest(): Promise<{
    available: boolean;
    version: string | null;
    bundleUrl: string | null;
    sha256: string | null;
    signature: string | null;
    minimumProtocol: number;
  }> {
    return this.request(`/api/workers/${this.requireWorkerId()}/update-manifest`, {
      method: 'GET',
    });
  }

  private async request<T>(pathName: string, options: RequestInit, authenticated = true): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (authenticated) {
      if (!this.credential) throw new Error('Worker credential is unavailable');
      headers.set('Authorization', `Bearer ${this.credential}`);
    }
    const response = await fetch(new URL(pathName, this.baseUrl), { ...options, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const error = payload?.error;
      throw Object.assign(new Error(error?.message || `Control plane returned ${response.status}`), {
        code: error?.code || 'CONTROL_PLANE_ERROR',
        statusCode: response.status,
      });
    }
    return payload.data as T;
  }

  private requireWorkerId(): string {
    if (!this.workerId) throw new Error('Worker ID is unavailable');
    return this.workerId;
  }
}
