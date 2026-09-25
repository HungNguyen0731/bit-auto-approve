import crypto from 'node:crypto';
import type {
  ApprovalJob,
  BitbucketConnectionConfig,
  ExecutionLease,
  ExecutionResultSummary,
  ExecutionTrigger,
} from '@bitbucket-pr-approver/shared';
import type { EventHub } from './events.js';
import type { StorageService } from './storage.js';
import type { WorkerStore } from './worker-store.js';
import type { AccountStore } from './account-store.js';

const LEASE_DURATION_MS = 45 * 1000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function jobRevision(job: ApprovalJob): string {
  return crypto
    .createHash('sha256')
    .update(
      stableJson({
        name: job.name,
        dryRun: job.dryRun,
        intervalSeconds: job.intervalSeconds,
        executionMode: job.executionMode ?? 'local',
        workerId: job.workerId,
        accountId: job.accountId,
        rules: job.rules,
      })
    )
    .digest('hex');
}

export class ExecutionDispatcher {
  constructor(
    private readonly storage: StorageService,
    private readonly workerStore: WorkerStore,
    private readonly events: EventHub,
    private readonly accounts?: AccountStore
  ) {}

  markOfflineWorkers(now: Date = new Date()): string[] {
    const cutoff = new Date(now.getTime() - 35_000).toISOString();
    const workerIds = this.workerStore.markOfflineBefore(cutoff);
    for (const workerId of workerIds) {
      this.events.broadcast('worker_status_changed', { workerId, state: 'OFFLINE' });
    }
    return workerIds;
  }

  schedule(job: ApprovalJob, now: Date = new Date(), trigger: ExecutionTrigger = 'SCHEDULED'):
    | ExecutionLease
    | null {
    if ((job.executionMode ?? 'local') !== 'worker' || !job.workerId || !job.enabled) return null;

    const worker = this.workerStore.getWorker(job.workerId);
    const leases = this.workerStore.getLeases();
    const active = leases.find(
      (lease) =>
        lease.jobId === job.id &&
        ['QUEUED', 'LEASED', 'RUNNING', 'RETRYABLE'].includes(lease.status)
    );
    if (active) return active;

    const stateAllowed = job.accountId
      ? worker?.supportsAccountLeases === true && ['ONLINE', 'STARTING', 'ERROR_AUTH'].includes(worker.state)
      : worker?.state === 'ONLINE' && worker.hasLegacyToken !== false;
    if (!worker || worker.revokedAt || !stateAllowed || !worker.lastHeartbeatAt ||
        now.getTime() - new Date(worker.lastHeartbeatAt).getTime() > 35_000) {
      this.advanceJobSchedule(job, now);
      return null;
    }

    const revision = jobRevision(job);
    const config = this.storage.getConfig();
    if (!job.accountId && !config) {
      throw Object.assign(new Error('Bitbucket connection is not configured'), {
        code: 'CONFIG_MISSING',
        statusCode: 409,
      });
    }
    const { token: _token, ...legacyConfig } = config || {
      serverType: 'cloud' as const, baseUrl: 'https://api.bitbucket.org/2.0', authType: 'bearer' as const,
    };
    let bitbucketConfig: Omit<BitbucketConnectionConfig, 'token'> = legacyConfig;
    if (job.accountId) {
      if (!this.accounts) throw Object.assign(new Error('Account store is unavailable'), { code: 'ACCOUNT_STORE_UNAVAILABLE', statusCode: 503 });
      const account = this.accounts.get(job.accountId);
      if (!account) throw Object.assign(new Error('Bitbucket account not found'), { code: 'ACCOUNT_NOT_FOUND', statusCode: 404 });
      bitbucketConfig = { serverType: 'cloud', baseUrl: 'https://api.bitbucket.org/2.0', authType: account.authType, username: account.username };
    }
    const scheduledFor = trigger === 'MANUAL' ? now.toISOString() : job.nextRunAt || now.toISOString();
    const idempotencyKey = `${job.id}:${scheduledFor}:${revision}`;
    const existing = leases.find((lease) => lease.idempotencyKey === idempotencyKey);
    if (existing) return existing;

    const lease: ExecutionLease = {
      executionId: crypto.randomUUID(),
      idempotencyKey,
      jobId: job.id,
      jobRevision: revision,
      workerId: job.workerId,
      trigger,
      status: 'QUEUED',
      scheduledFor,
      createdAt: now.toISOString(),
      lastSequence: 0,
      job: { ...job, revision },
      bitbucketConfig,
    };
    this.workerStore.saveLeases([...leases, lease]);
    this.advanceJobSchedule(job, now);
    return lease;
  }

  manualRun(
    jobId: string,
    credential?: { username?: string; ciphertext: string },
    now: Date = new Date()
  ): ExecutionLease {
    const job = this.storage.getJobById(jobId);
    if (!job) {
      throw Object.assign(new Error('Job not found'), { code: 'JOB_NOT_FOUND', statusCode: 404 });
    }
    if ((job.executionMode ?? 'local') !== 'worker' || !job.workerId) {
      throw Object.assign(new Error('Job is not assigned to a local worker'), {
        code: 'WORKER_NOT_ASSIGNED',
        statusCode: 409,
      });
    }
    const worker = this.workerStore.getWorker(job.workerId);
    if (!worker || worker.revokedAt ||
        !worker.lastHeartbeatAt ||
        now.getTime() - new Date(worker.lastHeartbeatAt).getTime() > 35_000 ||
        (!credential && !job.accountId && worker.state !== 'ONLINE') ||
        (!credential && job.accountId && !['ONLINE', 'STARTING', 'ERROR_AUTH'].includes(worker.state)) ||
        (credential && !['ONLINE', 'STARTING', 'ERROR_AUTH'].includes(worker.state))) {
      throw Object.assign(new Error('Assigned local worker is not online'), {
        code: 'WORKER_NOT_ONLINE',
        statusCode: 409,
      });
    }
    const lease = credential
      ? this.scheduleManualWithCredential(job, credential, now)
      : this.schedule({ ...job, enabled: true }, now, 'MANUAL');
    if (!lease) {
      throw Object.assign(new Error('Unable to create worker execution'), {
        code: 'EXECUTION_NOT_CREATED',
        statusCode: 409,
      });
    }
    return lease;
  }

  private scheduleManualWithCredential(
    job: ApprovalJob,
    credential: { username?: string; ciphertext: string },
    now: Date
  ): ExecutionLease {
    const config = this.storage.getConfig();
    const { token: _token, ...bitbucketConfig } = config || {
      serverType: 'cloud' as const,
      baseUrl: 'https://api.bitbucket.org/2.0',
      authType: 'basic' as const,
    };
    const lease: ExecutionLease = {
      executionId: crypto.randomUUID(),
      idempotencyKey: `${job.id}:manual:${crypto.randomUUID()}`,
      jobId: job.id,
      jobRevision: jobRevision(job),
      workerId: job.workerId!,
      trigger: 'MANUAL',
      status: 'QUEUED',
      scheduledFor: now.toISOString(),
      createdAt: now.toISOString(),
      lastSequence: 0,
      job: { ...job, revision: jobRevision(job) },
      bitbucketConfig: { ...bitbucketConfig, authType: credential.username ? 'basic' : 'bearer', username: credential.username },
      manualTokenCiphertext: credential.ciphertext,
    };
    const leases = this.workerStore.getLeases();
    if (leases.some((item) => item.jobId === job.id && ['QUEUED', 'LEASED', 'RUNNING', 'RETRYABLE'].includes(item.status))) {
      throw Object.assign(new Error('Job already has an active execution'), { code: 'JOB_ALREADY_RUNNING', statusCode: 409 });
    }
    this.workerStore.saveLeases([...leases, lease]);
    return lease;
  }

  claim(workerId: string, manualOnly = false, now: Date = new Date(), supportsAccountLeases = false): ExecutionLease | null {
    const leases = this.workerStore.getLeases();
    const available = leases.find(
      (lease) =>
        lease.workerId === workerId &&
        (!lease.job.accountId || Boolean(lease.manualTokenCiphertext) || supportsAccountLeases) &&
        (!manualOnly || Boolean(lease.manualTokenCiphertext || lease.job.accountId)) &&
        (lease.status === 'QUEUED' ||
          (lease.status === 'RETRYABLE' &&
            (!lease.leasedUntil || new Date(lease.leasedUntil).getTime() <= now.getTime())) ||
          (lease.status === 'LEASED' &&
            lease.leasedUntil &&
            new Date(lease.leasedUntil).getTime() <= now.getTime()))
    );
    if (!available) return null;

    let accountTokenCiphertext = available.accountTokenCiphertext;
    let bitbucketConfig = available.bitbucketConfig;
    if (available.job.accountId && !available.manualTokenCiphertext) {
      if (!this.accounts) throw Object.assign(new Error('Account store is unavailable'), { code: 'ACCOUNT_STORE_UNAVAILABLE', statusCode: 503 });
      const worker = this.workerStore.getWorker(workerId);
      if (!worker || worker.revokedAt) throw Object.assign(new Error('Worker is unavailable'), { code: 'WORKER_NOT_FOUND', statusCode: 404 });
      const { account, token } = this.accounts.getCredential(available.job.accountId);
      const publicKey = crypto.createPublicKey({ key: worker.publicKey, format: 'jwk' });
      accountTokenCiphertext = crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, Buffer.from(token, 'utf8')).toString('base64url');
      bitbucketConfig = { ...bitbucketConfig, authType: account.authType, username: account.username };
    }

    const claimed: ExecutionLease = {
      ...available,
      accountTokenCiphertext,
      bitbucketConfig,
      status: 'LEASED',
      leasedUntil: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
      startedAt: available.startedAt || now.toISOString(),
    };
    this.workerStore.saveLeases(
      leases.map((lease) => (lease.executionId === claimed.executionId ? claimed : lease))
    );
    return claimed;
  }

  renew(workerId: string, executionId: string, now: Date = new Date()): ExecutionLease {
    const leases = this.workerStore.getLeases();
    const current = leases.find((lease) => lease.executionId === executionId);
    if (!current || current.workerId !== workerId || !['LEASED', 'RUNNING'].includes(current.status)) {
      throw Object.assign(new Error('Execution lease is not active for this worker'), {
        code: 'LEASE_NOT_ACTIVE',
        statusCode: 409,
      });
    }
    const renewed: ExecutionLease = {
      ...current,
      status: 'RUNNING',
      leasedUntil: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
    };
    this.workerStore.saveLeases(
      leases.map((lease) => (lease.executionId === executionId ? renewed : lease))
    );
    return renewed;
  }

  complete(workerId: string, result: ExecutionResultSummary): ExecutionLease {
    const leases = this.workerStore.getLeases();
    const current = leases.find((lease) => lease.executionId === result.executionId);
    if (!current || current.workerId !== workerId) {
      throw Object.assign(new Error('Execution does not belong to this worker'), {
        code: 'EXECUTION_SCOPE_MISMATCH',
        statusCode: 409,
      });
    }
    if (['COMPLETED', 'FAILED'].includes(current.status)) return current;

    const completed: ExecutionLease = {
      ...current,
      status: result.status,
      completedAt: result.completedAt,
      result,
      leasedUntil: undefined,
      manualTokenCiphertext: ['COMPLETED', 'FAILED'].includes(result.status) ? undefined : current.manualTokenCiphertext,
      accountTokenCiphertext: ['COMPLETED', 'FAILED'].includes(result.status) ? undefined : current.accountTokenCiphertext,
    };
    this.workerStore.saveLeases(
      leases.map((lease) => (lease.executionId === result.executionId ? completed : lease))
    );
    this.events.broadcast('execution_completed', result);
    return completed;
  }

  private advanceJobSchedule(job: ApprovalJob, now: Date): void {
    const nextRunAt = new Date(now.getTime() + job.intervalSeconds * 1000).toISOString();
    const jobs = this.storage.getJobs();
    const index = jobs.findIndex((item) => item.id === job.id);
    if (index === -1) return;
    jobs[index] = { ...jobs[index], nextRunAt, updatedAt: now.toISOString() };
    this.storage.saveJobs(jobs);
  }
}
