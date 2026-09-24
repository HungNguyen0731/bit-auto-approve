import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  BitbucketUserProfile,
  PullRequest,
  RepositoryInfo,
  RepositoryRef,
} from '@bitbucket-pr-approver/shared';
import { StorageService } from '../services/storage.js';
import { EventHub } from '../services/events.js';
import { SchedulerService } from '../services/scheduler.js';
import type { IBitbucketClient } from '../bitbucket/client.interface.js';
import { BitbucketError } from '../bitbucket/errors.js';

class MockBitbucketClient implements IBitbucketClient {
  public approveCalls: { repo: RepositoryRef; prId: number }[] = [];
  public shouldFailVpn: boolean = false;
  public mockPrs: PullRequest[] = [];

  async testConnection(): Promise<BitbucketUserProfile> {
    return this.getCurrentUser();
  }

  async getCurrentUser(): Promise<BitbucketUserProfile> {
    if (this.shouldFailVpn) {
      throw new BitbucketError('Corporate VPN required to connect to Bitbucket', 'VPN_REQUIRED', 503);
    }
    return {
      username: 'approver-bot',
      displayName: 'Approver Bot',
      serverType: 'server',
      isAvailable: true,
      vpnConnected: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    return [
      {
        projectOrWorkspace: 'CORE',
        slug: 'backend-api',
        name: 'Backend API',
        isPrivate: true,
      },
    ];
  }

  async listOpenPullRequests(repo: RepositoryRef): Promise<PullRequest[]> {
    if (this.shouldFailVpn) {
      throw new BitbucketError('Network timeout reaching Bitbucket host', 'VPN_REQUIRED', 504);
    }
    return this.mockPrs.filter(
      (p) => p.repository.projectOrWorkspace === repo.projectOrWorkspace && p.repository.slug === repo.slug
    );
  }

  async getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest> {
    const pr = this.mockPrs.find(
      (p) => p.repository.projectOrWorkspace === repo.projectOrWorkspace && p.repository.slug === repo.slug && p.id === prId
    );
    if (!pr) throw new Error('Not found');
    return pr;
  }

  async approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }> {
    this.approveCalls.push({ repo, prId });
    return {
      success: true,
      message: `Mock approved #${prId}`,
    };
  }

  async listWorkspaces(): Promise<any[]> {
    return [];
  }

  async searchRepositories(): Promise<any[]> {
    return [];
  }

  async searchBranches(): Promise<any[]> {
    return [];
  }

  async searchUsers(): Promise<any[]> {
    return [];
  }
}

function makePr(id: number, author: string = 'dev-team'): PullRequest {
  return {
    id,
    title: `Feature work #${id}`,
    state: 'OPEN',
    author: { username: author, displayName: author },
    repository: { projectOrWorkspace: 'CORE', slug: 'backend-api' },
    sourceBranch: { name: 'feature/new-api', refId: 'refs/heads/feature/new-api' },
    targetBranch: { name: 'develop', refId: 'refs/heads/develop' },
    reviewers: [],
    isDraft: false,
    hasConflicts: false,
    createdDate: new Date().toISOString(),
    updatedDate: new Date().toISOString(),
    htmlUrl: `http://bitbucket/CORE/backend-api/pull-requests/${id}`,
  };
}

describe('Scheduler Runner & Background Worker', () => {
  let tmpDir: string;
  let storage: StorageService;
  let events: EventHub;
  let scheduler: SchedulerService;
  let mockClient: MockBitbucketClient;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
    storage = new StorageService(tmpDir);
    events = new EventHub();

    // Setup active config
    storage.saveConfig({
      serverType: 'server',
      baseUrl: 'https://bitbucket.internal.corp',
      authType: 'bearer',
      token: 'mock-token',
    });

    scheduler = new SchedulerService(storage, events);
    mockClient = new MockBitbucketClient();
    scheduler.setTestClient(mockClient);
  });

  after(() => {
    scheduler.stop();
    events.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs job in Dry-Run mode without calling approve API', async () => {
    const job = storage.createJob({
      name: 'Dry Run Job',
      enabled: true,
      dryRun: true,
      rules: {
        repositories: ['CORE/backend-api'],
        authorWhitelist: ['dev-team'],
        targetBranches: ['develop'],
        excludeSelf: true,
        ignoreDrafts: true,
        ignoreWithConflicts: true,
      },
    });

    mockClient.mockPrs = [makePr(101)];
    mockClient.approveCalls = [];

    // Capture SSE events
    const emittedEvents: string[] = [];
    const origBroadcast = events.broadcast.bind(events);
    events.broadcast = (type, data) => {
      emittedEvents.push(type);
      origBroadcast(type, data);
    };

    await scheduler.executeJob(job.id, true);

    // API approve should NOT be called in dry-run
    assert.equal(mockClient.approveCalls.length, 0);

    // Logs must record DRY_RUN
    const logs = storage.getLogs({ jobId: job.id });
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0].status, 'DRY_RUN');
    assert.equal(logs.items[0].dryRun, true);

    // SSE events emitted
    assert.ok(emittedEvents.includes('job_started'));
    assert.ok(emittedEvents.includes('pr_evaluated'));
    assert.ok(emittedEvents.includes('pr_approved'));
    assert.ok(emittedEvents.includes('job_completed'));
  });

  it('runs job in Live mode, calls approve API and sets idempotency cache', async () => {
    const job = storage.createJob({
      name: 'Live Approval Job',
      enabled: true,
      dryRun: false,
      rules: {
        repositories: ['CORE/backend-api'],
        authorWhitelist: ['dev-team'],
        targetBranches: ['develop'],
        excludeSelf: true,
        ignoreDrafts: true,
        ignoreWithConflicts: true,
      },
    });

    mockClient.mockPrs = [makePr(202)];
    mockClient.approveCalls = [];

    await scheduler.executeJob(job.id, true);

    // Approve API called once
    assert.equal(mockClient.approveCalls.length, 1);
    assert.equal(mockClient.approveCalls[0].prId, 202);

    // Cache updated
    assert.equal(scheduler.isApprovedCached('CORE/backend-api', 202), true);

    // Logs recorded APPROVED
    const logs = storage.getLogs({ status: 'APPROVED' });
    const approvedLog = logs.items.find((l) => l.prId === 202);
    assert.ok(approvedLog);
    assert.equal(approvedLog.status, 'APPROVED');
    assert.equal(approvedLog.dryRun, false);

    // Second execution with same PR -> Idempotency skips re-approving
    mockClient.approveCalls = [];
    await scheduler.executeJob(job.id, true);
    assert.equal(mockClient.approveCalls.length, 0); // No second approval
  });

  it('hydrates idempotency cache across scheduler restarts', () => {
    // A fresh scheduler instance using the same storage directory
    const newScheduler = new SchedulerService(storage, events);

    // PR #202 was approved in previous test and stored in logs.json
    assert.equal(newScheduler.isApprovedCached('CORE/backend-api', 202), true);
    newScheduler.stop();
  });

  it('handles VPN disconnection gracefully with error classification', async () => {
    const job = storage.createJob({
      name: 'VPN Test Job',
      enabled: true,
      rules: {
        repositories: ['CORE/backend-api'],
        authorWhitelist: ['dev-team'],
        targetBranches: ['develop'],
        excludeSelf: true,
        ignoreDrafts: true,
        ignoreWithConflicts: true,
      },
    });

    mockClient.shouldFailVpn = true;
    mockClient.mockPrs = [makePr(303)];

    let errorEventReceived = false;
    let statusChangeEventReceived = false;

    events.broadcast = (type) => {
      if (type === 'error') errorEventReceived = true;
      if (type === 'status_changed') statusChangeEventReceived = true;
    };

    await scheduler.executeJob(job.id, true);

    const status = scheduler.getStatus();
    assert.equal(status.vpnConnected, false);
    assert.equal(status.bitbucketStatus, 'DISCONNECTED');
    assert.equal(errorEventReceived, true);
    assert.equal(statusChangeEventReceived, true);

    // Restore VPN
    mockClient.shouldFailVpn = false;
  });
});
