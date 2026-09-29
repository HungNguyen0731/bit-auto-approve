import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApprovalJob, HeartbeatRequest, WorkerMetadata } from '@bitbucket-pr-approver/shared';
import { EventHub } from './events.js';
import { ExecutionDispatcher } from './execution-dispatcher.js';
import { StorageService } from './storage.js';
import { WorkerStore } from './worker-store.js';

const temporaryDirectories: string[] = [];
const eventHubs: EventHub[] = [];

function createHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-pool-test-'));
  temporaryDirectories.push(dataDir);
  const storage = new StorageService(dataDir);
  const workerStore = new WorkerStore(dataDir);
  const events = new EventHub();
  eventHubs.push(events);
  const dispatcher = new ExecutionDispatcher(storage, workerStore, events);
  return { storage, workerStore, dispatcher };
}

function addOnlineWorker(workerStore: WorkerStore, name: string, now: Date) {
  const session = workerStore.createPairingSession('owner-1', 'https://control.example', now);
  const metadata: WorkerMetadata = {
    name,
    platform: 'darwin',
    architecture: 'arm64',
    version: '1.0.0',
  };
  const { worker } = workerStore.consumePairingSession(
    session.code,
    { kty: 'RSA', n: 'AQAB', e: 'AQAB' },
    metadata,
    now
  );
  const heartbeat: HeartbeatRequest = {
    state: 'ONLINE',
    version: metadata.version,
    platform: metadata.platform,
    architecture: metadata.architecture,
    queueDepth: 0,
    hasLegacyToken: true,
    supportsAccountLeases: true,
    supportsHybridTokenEnvelope: true,
    supportsAutoMerge: true,
  };
  workerStore.recordHeartbeat(worker.id, heartbeat, now);
  return worker.id;
}

function createJob(workerId: string, repositories: string[]): ApprovalJob {
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  return {
    id: 'job-1',
    name: 'Pooled job',
    enabled: true,
    intervalSeconds: 60,
    dryRun: true,
    executionMode: 'worker',
    workerId,
    createdAt: now,
    updatedAt: now,
    rules: {
      repositories,
      authorWhitelist: ['*'],
      targetBranches: ['main'],
      excludeSelf: true,
      ignoreDrafts: true,
      ignoreWithConflicts: true,
    },
  };
}

afterEach(() => {
  for (const events of eventHubs.splice(0)) events.close();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ExecutionDispatcher worker pool scheduling', () => {
  it('shards explicit repositories across online compatible workers', () => {
    const { storage, workerStore, dispatcher } = createHarness();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const workerA = addOnlineWorker(workerStore, 'worker-a', now);
    const workerB = addOnlineWorker(workerStore, 'worker-b', now);
    storage.saveConfig({
      serverType: 'cloud',
      baseUrl: 'https://bitbucket.org/!api/2.0',
      authType: 'session',
      token: JSON.stringify({ cookie: 'session=[REDACTED]', csrfToken: '[REDACTED]' }),
    });
    const job = createJob(workerA, ['team/repo-a', 'team/repo-b', 'team/repo-c', 'team/repo-d']);
    storage.saveJobs([job]);

    const leases = dispatcher.schedule(job, now);

    assert.ok(Array.isArray(leases));
    assert.equal(leases.length, 2);
    assert.deepEqual(new Set(leases.map((lease) => lease.workerId)), new Set([workerA, workerB]));
    assert.deepEqual(
      leases.flatMap((lease) => lease.job.rules.repositories).sort(),
      ['team/repo-a', 'team/repo-b', 'team/repo-c', 'team/repo-d']
    );
    assert.equal(new Set(leases.flatMap((lease) => lease.job.rules.repositories)).size, 4);
    assert.equal(new Set(leases.map((lease) => lease.idempotencyKey)).size, 2);
  });

  it('allows different workers to claim distinct shards of one job', async () => {
    const { storage, workerStore, dispatcher } = createHarness();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const workerA = addOnlineWorker(workerStore, 'worker-a', now);
    const workerB = addOnlineWorker(workerStore, 'worker-b', now);
    storage.saveConfig({
      serverType: 'cloud',
      baseUrl: 'https://bitbucket.org/!api/2.0',
      authType: 'session',
      token: JSON.stringify({ cookie: 'session=[REDACTED]', csrfToken: '[REDACTED]' }),
    });
    const job = createJob(workerA, ['team/repo-a', 'team/repo-b']);
    storage.saveJobs([job]);
    dispatcher.schedule(job, now);

    const [claimA, claimB] = await Promise.all([
      dispatcher.claim(workerA, false, now, true),
      dispatcher.claim(workerB, false, now, true),
    ]);

    assert.ok(claimA);
    assert.ok(claimB);
    assert.notEqual(claimA.executionId, claimB.executionId);
    assert.equal(claimA.job.rules.repositories.length, 1);
    assert.equal(claimB.job.rules.repositories.length, 1);
    assert.notEqual(claimA.job.rules.repositories[0], claimB.job.rules.repositories[0]);
  });

  it('returns the existing shard set when the scheduler repeats the same run', () => {
    const { storage, workerStore, dispatcher } = createHarness();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const workerA = addOnlineWorker(workerStore, 'worker-a', now);
    addOnlineWorker(workerStore, 'worker-b', now);
    storage.saveConfig({
      serverType: 'cloud',
      baseUrl: 'https://bitbucket.org/!api/2.0',
      authType: 'session',
      token: JSON.stringify({ cookie: 'session=[REDACTED]', csrfToken: '[REDACTED]' }),
    });
    const job = createJob(workerA, ['team/repo-a', 'team/repo-b']);
    storage.saveJobs([job]);

    const first = dispatcher.schedule(job, now);
    const repeated = dispatcher.schedule(job, now);

    assert.equal(repeated.length, first.length);
    assert.deepEqual(
      repeated.map((lease) => lease.executionId).sort(),
      first.map((lease) => lease.executionId).sort()
    );
    assert.equal(workerStore.getLeases().length, first.length);
  });
});
