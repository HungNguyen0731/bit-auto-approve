import crypto from 'node:crypto';
import type {
  ApprovalJob,
  BitbucketConnectionConfig,
  ExecutionLease,
  ExecutionResultSummary,
  ExecutionTrigger,
  WorkerRecord,
} from '@bitbucket-pr-approver/shared';
import type { EventHub } from './events.js';
import type { StorageService } from './storage.js';
import type { WorkerStore } from './worker-store.js';
import type { AccountStore } from './account-store.js';
import type { BitbucketOAuth } from './bitbucket-oauth.js';

const LEASE_DURATION_MS = 45 * 1000;
const EXPIRED_LEASE_GRACE_MS = 2 * 60 * 1000;

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
        autoMergeOnSuccessfulBuild: job.autoMergeOnSuccessfulBuild,
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
    private readonly accounts?: AccountStore,
    private readonly oauth?: BitbucketOAuth
  ) {}

  markOfflineWorkers(now: Date = new Date()): string[] {
    this.expireStaleLeases(now);
    const cutoff = new Date(now.getTime() - 35_000).toISOString();
    const workerIds = this.workerStore.markOfflineBefore(cutoff);
    for (const workerId of workerIds) {
      this.events.broadcast('worker_status_changed', { workerId, state: 'OFFLINE' });
    }
    return workerIds;
  }

  private getEligibleWorkers(job: ApprovalJob, now: Date): WorkerRecord[] {
    const allWorkers = this.workerStore.listWorkers();
    return allWorkers
      .filter((worker) => {
        if (worker.revokedAt) return false;
        if (!worker.lastHeartbeatAt || now.getTime() - new Date(worker.lastHeartbeatAt).getTime() > 35_000) {
          return false;
        }
        const stateAllowed = job.accountId
          ? worker.supportsAccountLeases === true && ['ONLINE', 'STARTING', 'ERROR_AUTH'].includes(worker.state)
          : worker.state === 'ONLINE' && worker.hasLegacyToken !== false;
        if (!stateAllowed) return false;
        if (job.autoMergeOnSuccessfulBuild && worker.supportsAutoMerge !== true) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.id === job.workerId) return -1;
        if (b.id === job.workerId) return 1;
        return a.id.localeCompare(b.id);
      });
  }

  schedule(job: ApprovalJob, now: Date = new Date(), trigger: ExecutionTrigger = 'SCHEDULED'): ExecutionLease[] {
    if ((job.executionMode ?? 'local') !== 'worker' || !job.workerId || !job.enabled) return [];

    this.expireStaleLeases(now);
    const leases = this.workerStore.getLeases();
    const active = leases.filter(
      (lease) =>
        lease.jobId === job.id &&
        ['QUEUED', 'LEASED', 'RUNNING', 'RETRYABLE'].includes(lease.status)
    );
    if (active.length > 0) return active;

    const eligibleWorkers = this.getEligibleWorkers(job, now);
    if (eligibleWorkers.length === 0) {
      this.advanceJobSchedule(job, now);
      return [];
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
      serverType: 'cloud' as const, baseUrl: 'https://bitbucket.org/!api/2.0', authType: 'session' as const,
    };
    let bitbucketConfig: Omit<BitbucketConnectionConfig, 'token'> = legacyConfig;
    if (job.accountId) {
      if (!this.accounts) throw Object.assign(new Error('Account store is unavailable'), { code: 'ACCOUNT_STORE_UNAVAILABLE', statusCode: 503 });
      const account = this.accounts.get(job.accountId);
      if (!account) throw Object.assign(new Error('Bitbucket account not found'), { code: 'ACCOUNT_NOT_FOUND', statusCode: 404 });
      bitbucketConfig = { serverType: 'cloud', baseUrl: 'https://bitbucket.org/!api/2.0', authType: account.authType, username: account.username };
    }
    const scheduledFor = trigger === 'MANUAL' ? now.toISOString() : job.nextRunAt || now.toISOString();
    const baseIdempotencyKey = `${job.id}:${scheduledFor}:${revision}`;

    const existing = leases.filter((lease) => lease.idempotencyKey.startsWith(baseIdempotencyKey));
    if (existing.length > 0) return existing;

    const repositories = (job.rules.repositories || []).map((r) => r.trim()).filter(Boolean);
    const numShards = Math.min(Math.max(1, repositories.length), eligibleWorkers.length);

    const newLeases: ExecutionLease[] = [];
    if (numShards > 1 && repositories.length > 1) {
      for (let s = 0; s < numShards; s++) {
        const shardRepos = repositories.filter((_, idx) => idx % numShards === s);
        const assignedWorker = eligibleWorkers[s % eligibleWorkers.length];
        const shardJob: ApprovalJob = {
          ...job,
          rules: {
            ...job.rules,
            repositories: shardRepos,
          },
        };
        const shardRevision = jobRevision(shardJob);
        const shardLease: ExecutionLease = {
          executionId: crypto.randomUUID(),
          idempotencyKey: `${baseIdempotencyKey}:shard:${s}`,
          jobId: job.id,
          jobRevision: shardRevision,
          workerId: assignedWorker.id,
          trigger,
          status: 'QUEUED',
          scheduledFor,
          createdAt: now.toISOString(),
          lastSequence: 0,
          job: { ...shardJob, revision: shardRevision },
          bitbucketConfig,
        };
        newLeases.push(shardLease);
      }
    } else {
      const lease: ExecutionLease = {
        executionId: crypto.randomUUID(),
        idempotencyKey: baseIdempotencyKey,
        jobId: job.id,
        jobRevision: revision,
        workerId: eligibleWorkers[0].id,
        trigger,
        status: 'QUEUED',
        scheduledFor,
        createdAt: now.toISOString(),
        lastSequence: 0,
        job: { ...job, revision },
        bitbucketConfig,
      };
      newLeases.push(lease);
    }

    this.workerStore.saveLeases([...leases, ...newLeases]);
    this.advanceJobSchedule(job, now);
    return newLeases;
  }

  manualRun(
    jobId: string,
    credential?: { username?: string; ciphertext: string },
    now: Date = new Date()
  ): ExecutionLease {
    this.expireStaleLeases(now);
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
    if (job.autoMergeOnSuccessfulBuild && worker?.supportsAutoMerge !== true) {
      throw Object.assign(new Error('Update and restart this Mac Worker before running auto-merge'), {
        code: 'WORKER_UPGRADE_REQUIRED', statusCode: 409,
      });
    }
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
    const scheduled = credential
      ? [this.scheduleManualWithCredential(job, credential, now)]
      : this.schedule({ ...job, enabled: true }, now, 'MANUAL');
    if (!scheduled || scheduled.length === 0) {
      throw Object.assign(new Error('Unable to create worker execution'), {
        code: 'EXECUTION_NOT_CREATED',
        statusCode: 409,
      });
    }
    return scheduled[0];
  }

  private scheduleManualWithCredential(
    job: ApprovalJob,
    credential: { username?: string; ciphertext: string },
    now: Date
  ): ExecutionLease {
    const config = this.storage.getConfig();
    const { token: _token, ...bitbucketConfig } = config || {
      serverType: 'cloud' as const,
      baseUrl: 'https://bitbucket.org/!api/2.0',
      authType: 'session' as const,
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

  async claim(workerId: string, manualOnly = false, now: Date = new Date(), supportsAccountLeases = false): Promise<ExecutionLease | null> {
    this.expireStaleLeases(now);
    const leases = this.workerStore.getLeases();
    if (leases.some((lease) => lease.workerId === workerId &&
        ['LEASED', 'RUNNING'].includes(lease.status) && lease.leasedUntil &&
        new Date(lease.leasedUntil).getTime() > now.getTime())) return null;
    let available = leases.find(
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

    if (!available) {
      available = leases.find((lease) => {
        if (lease.status !== 'QUEUED') return false;
        if (lease.job.accountId && !lease.manualTokenCiphertext && !supportsAccountLeases) return false;
        if (manualOnly && !lease.manualTokenCiphertext && !lease.job.accountId) return false;
        if (lease.job.autoMergeOnSuccessfulBuild) {
          const currentWorker = this.workerStore.getWorker(workerId);
          if (currentWorker?.supportsAutoMerge !== true) return false;
        }
        const assigned = this.workerStore.getWorker(lease.workerId);
        const assignedOffline = !assigned || assigned.revokedAt || !assigned.lastHeartbeatAt ||
          now.getTime() - new Date(assigned.lastHeartbeatAt).getTime() > 35_000 || assigned.state !== 'ONLINE';
        const assignedBusy = leases.some((other) =>
          other.workerId === lease.workerId &&
          other.executionId !== lease.executionId &&
          ['LEASED', 'RUNNING'].includes(other.status) &&
          other.leasedUntil &&
          new Date(other.leasedUntil).getTime() > now.getTime()
        );
        return assignedOffline || assignedBusy || lease.workerId === 'pool';
      });
      if (available) {
        available = { ...available, workerId };
      }
    }

    if (!available) return null;

    let accountTokenCiphertext = available.accountTokenCiphertext;
    let bitbucketConfig = available.bitbucketConfig;
    if (available.job.accountId && !available.manualTokenCiphertext) {
      if (!this.accounts) throw Object.assign(new Error('Account store is unavailable'), { code: 'ACCOUNT_STORE_UNAVAILABLE', statusCode: 503 });
      const worker = this.workerStore.getWorker(workerId);
      if (!worker || worker.revokedAt) throw Object.assign(new Error('Worker is unavailable'), { code: 'WORKER_NOT_FOUND', statusCode: 404 });
      const { account, token } = this.oauth
        ? await this.oauth.getWorkerCredential(available.job.accountId)
        : this.accounts.getCredential(available.job.accountId);
      const publicKey = crypto.createPublicKey({ key: worker.publicKey, format: 'jwk' });
      const maxBytes = (publicKey.asymmetricKeyDetails?.modulusLength || 3072) / 8 - 66;
      if (Buffer.byteLength(token, 'utf8') > maxBytes) {
        if (worker.supportsHybridTokenEnvelope !== true) {
          throw Object.assign(new Error('Update and restart this Mac Worker to use this Bitbucket OAuth account'), { code: 'WORKER_ENCRYPTION_UPGRADE_REQUIRED', statusCode: 409 });
        }
        const secret = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
        const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
        accountTokenCiphertext = 'v2:' + Buffer.from(JSON.stringify({
          key: crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, secret).toString('base64url'),
          iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url'),
        })).toString('base64url');
      } else {
        accountTokenCiphertext = crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, Buffer.from(token, 'utf8')).toString('base64url');
      }
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
    // OAuth refresh introduces an await. Re-read leases so concurrent claims
    // cannot both issue the same execution or overwrite a completed/cancelled run.
    const latestLeases = this.workerStore.getLeases();
    const latest = latestLeases.find((lease) => lease.executionId === claimed.executionId);
    if (!latest || !['QUEUED', 'RETRYABLE', 'LEASED'].includes(latest.status) ||
        (latest.status === 'LEASED' && latest.leasedUntil && Date.parse(latest.leasedUntil) > Date.now()) ||
        latestLeases.some((lease) => lease.workerId === workerId && lease.executionId !== claimed.executionId &&
          ['LEASED', 'RUNNING'].includes(lease.status) && lease.leasedUntil && Date.parse(lease.leasedUntil) > Date.now())) return null;
    this.workerStore.saveLeases(
      latestLeases.map((lease) => (lease.executionId === claimed.executionId ? claimed : lease))
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

    // A 60-second job scanning many repositories can exhaust the hourly
    // Bitbucket quota. Keep the run terminal (earlier PR side effects may have
    // happened), but push out the next scheduled scan instead of hammering 429.
    if (result.failureCode === 'RATE_LIMITED') {
      const previous = leases
        .filter((lease) => lease.jobId === current.jobId && lease.executionId !== current.executionId &&
          lease.result && ['COMPLETED', 'FAILED'].includes(lease.status))
        .sort((left, right) => Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt));
      let consecutive = 1;
      for (const lease of previous) {
        if (lease.result?.failureCode !== 'RATE_LIMITED') break;
        consecutive++;
        if (consecutive >= 5) break;
      }
      const retryAfter = Number.isFinite(result.rateLimitRetryAfterSeconds)
        ? Math.min(Math.max(Math.ceil(result.rateLimitRetryAfterSeconds!), 0), 3600) : 0;
      const delaySeconds = Math.min(3600, Math.max(retryAfter + 5, 300 * 2 ** (consecutive - 1)));
      const job = this.storage.getJobById(current.jobId);
      if (job && jobRevision(job) === current.jobRevision) {
        const nextRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        const jobs = this.storage.getJobs();
        this.storage.saveJobs(jobs.map((item) => item.id === job.id
          ? { ...item, nextRunAt, updatedAt: new Date().toISOString() } : item));
      }
    }

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

  cancelStuckExecution(executionId: string, now: Date = new Date()): ExecutionLease {
    const leases = this.workerStore.getLeases();
    const current = leases.find((lease) => lease.executionId === executionId);
    if (!current) throw Object.assign(new Error('Execution not found'), { code: 'EXECUTION_NOT_FOUND', statusCode: 404 });
    if (['COMPLETED', 'FAILED'].includes(current.status)) return current;
    if (['LEASED', 'RUNNING'].includes(current.status)) {
      const worker = this.workerStore.getWorker(current.workerId);
      const heartbeatAt = worker?.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : 0;
      const startedAt = Date.parse(current.startedAt || current.createdAt);
      if (!worker || worker.activeExecutionId === executionId ||
          heartbeatAt <= startedAt + 10_000 || now.getTime() - heartbeatAt > 35_000) {
        throw Object.assign(new Error('Worker may still be running this execution. Restart the local Worker and wait for a fresh idle heartbeat before cancelling.'), {
          code: 'WORKER_MAY_STILL_BE_RUNNING', statusCode: 409,
        });
      }
    }
    const completedAt = now.toISOString();
    const startedAt = current.startedAt || current.createdAt;
    const result: ExecutionResultSummary = {
      executionId, workerId: current.workerId, jobId: current.jobId, status: 'FAILED',
      startedAt, completedAt, durationMs: Math.max(0, now.getTime() - Date.parse(startedAt)),
      repositoriesScanned: 0, pullRequestsScanned: 0, matched: 0, approved: 0,
      skipped: 0, failed: 1, alreadyApproved: 0,
      failureReason: 'Execution was cancelled after the Worker reported idle. Earlier Bitbucket side effects may have occurred; check the PR before retrying.',
    };
    const cancelled: ExecutionLease = {
      ...current, status: 'FAILED', completedAt, result, leasedUntil: undefined,
      manualTokenCiphertext: undefined, accountTokenCiphertext: undefined,
    };
    this.workerStore.saveLeases(leases.map((lease) => lease.executionId === executionId ? cancelled : lease));
    this.events.broadcast('execution_completed', result);
    return cancelled;
  }

  expireStaleLeases(now: Date = new Date()): number {
    const leases = this.workerStore.getLeases();
    let expired = 0;
    const expiredResults: ExecutionResultSummary[] = [];
    const updated = leases.map((lease) => {
      const deadline = lease.leasedUntil ? Date.parse(lease.leasedUntil) : NaN;
      if (!['LEASED', 'RUNNING'].includes(lease.status) ||
          !Number.isFinite(deadline) ||
          deadline + EXPIRED_LEASE_GRACE_MS > now.getTime()) return lease;

      expired++;
      const completedAt = now.toISOString();
      const startedAt = lease.startedAt || lease.createdAt;
      const result: ExecutionResultSummary = {
        executionId: lease.executionId,
        workerId: lease.workerId,
        jobId: lease.jobId,
        status: 'FAILED',
        startedAt,
        completedAt,
        durationMs: Math.max(0, now.getTime() - Date.parse(startedAt)),
        repositoriesScanned: 0,
        pullRequestsScanned: 0,
        matched: 0,
        approved: 0,
        skipped: 0,
        failed: 1,
        alreadyApproved: 0,
        failureReason: 'Worker stopped renewing this execution lease; its result is unknown. Check the Mac Worker before retrying.',
      };
      expiredResults.push(result);
      return {
        ...lease,
        status: 'FAILED' as const,
        completedAt,
        result,
        leasedUntil: undefined,
        manualTokenCiphertext: undefined,
        accountTokenCiphertext: undefined,
      };
    });
    if (expired > 0) {
      this.workerStore.saveLeases(updated);
      for (const result of expiredResults) this.events.broadcast('execution_completed', result);
    }
    return expired;
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
