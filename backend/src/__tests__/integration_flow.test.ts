import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  ApprovalJob,
  ApprovalLogEntry,
  BitbucketUserProfile,
  PullRequest,
  RepositoryInfo,
  RepositoryRef,
} from '@bitbucket-pr-approver/shared';
import { buildServer, type ServerInstance } from '../server.js';
import type { IBitbucketClient } from '../bitbucket/client.interface.js';
import { BitbucketError } from '../bitbucket/errors.js';
import { RuleFilteringEngine } from '../engine/filter.js';

function createMockPr(
  id: number,
  title: string,
  author: string,
  sourceBranch: string,
  targetBranch: string,
  options: {
    isDraft?: boolean;
    hasConflicts?: boolean;
    buildStatus?: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS';
    repoProject?: string;
    repoSlug?: string;
  } = {}
): PullRequest {
  const project = options.repoProject || 'PAYMENT';
  const slug = options.repoSlug || 'checkout-service';
  return {
    id,
    title,
    description: `PR description for ${title}`,
    author: { username: author, displayName: `${author} user` },
    sourceBranch: { name: sourceBranch, refId: `refs/heads/${sourceBranch}` },
    targetBranch: { name: targetBranch, refId: `refs/heads/${targetBranch}` },
    state: 'OPEN',
    isDraft: Boolean(options.isDraft),
    hasConflicts: Boolean(options.hasConflicts),
    buildStatus: options.buildStatus || 'SUCCESSFUL',
    repository: { projectOrWorkspace: project, slug },
    reviewers: [],
    createdDate: new Date().toISOString(),
    updatedDate: new Date().toISOString(),
    htmlUrl: `https://bitbucket.internal.company.com/projects/${project}/repos/${slug}/pull-requests/${id}`,
  };
}

class MockIntegrationBitbucketClient implements IBitbucketClient {
  public approveCalls: { repo: RepositoryRef; prId: number }[] = [];
  public failMode: 'none' | 'vpn' | 'ip_whitelist' = 'none';
  public prs: PullRequest[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.approveCalls = [];
    this.failMode = 'none';
    this.prs = [
      // 1. Valid PR eligible for approval
      createMockPr(101, 'feat: add user authentication flow', 'alice', 'feature/auth-login', 'main'),
      // 2. Self-authored PR by approver bot
      createMockPr(102, 'chore: bump dependencies by bot', 'approver-bot', 'chore/deps', 'main'),
      // 3. PR by author not in whitelist
      createMockPr(103, 'docs: update architecture notes', 'external-contractor', 'patch/docs', 'main'),
      // 4. PR by blacklisted author
      createMockPr(104, 'refactor: broken experimental refactor', 'rogue-bot', 'feature/risky', 'main'),
      // 5. Non-matching target branch
      createMockPr(105, 'feat: experimental branch targeting staging', 'alice', 'feature/experiment', 'staging'),
      // 6. Draft PR
      createMockPr(106, 'WIP: ongoing work in progress', 'alice', 'feature/wip', 'main', { isDraft: true }),
      // 7. PR with merge conflicts
      createMockPr(107, 'fix: conflicts with upstream main', 'alice', 'fix/bad-merge', 'main', { hasConflicts: true }),
    ];
  }

  async testConnection(): Promise<BitbucketUserProfile> {
    return this.getCurrentUser();
  }

  async getCurrentUser(): Promise<BitbucketUserProfile> {
    if (this.failMode === 'vpn') {
      throw new BitbucketError('Corporate VPN connection timed out (ETIMEDOUT)', 'VPN_REQUIRED', 504);
    }
    if (this.failMode === 'ip_whitelist') {
      throw new BitbucketError('Access denied: client IP not whitelisted in Bitbucket Server (HTTP 403)', 'AUTH_INVALID_CREDENTIALS', 403);
    }
    return {
      username: 'approver-bot',
      displayName: 'Approver Bot',
      email: 'bot@internal.corp',
      serverType: 'server',
      isAvailable: true,
      vpnConnected: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    return [
      {
        projectOrWorkspace: 'PAYMENT',
        slug: 'checkout-service',
        name: 'Checkout Service',
        isPrivate: true,
      },
    ];
  }

  async listOpenPullRequests(repo: RepositoryRef): Promise<PullRequest[]> {
    if (this.failMode === 'vpn') {
      throw new BitbucketError('Network host unreachable (EHOSTUNREACH): VPN disconnected', 'VPN_REQUIRED', 503);
    }
    if (this.failMode === 'ip_whitelist') {
      throw new BitbucketError('Access denied: client IP not whitelisted', 'AUTH_INVALID_CREDENTIALS', 403);
    }
    return this.prs.filter(
      (p) => p.repository.projectOrWorkspace === repo.projectOrWorkspace && p.repository.slug === repo.slug
    );
  }

  async getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest> {
    const pr = this.prs.find(
      (p) => p.repository.projectOrWorkspace === repo.projectOrWorkspace && p.repository.slug === repo.slug && p.id === prId
    );
    if (!pr) throw new Error(`PR #${prId} not found`);
    return pr;
  }

  async approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }> {
    if (this.failMode === 'vpn') {
      throw new BitbucketError('Approve failed: VPN disconnected', 'VPN_REQUIRED', 504);
    }
    this.approveCalls.push({ repo, prId });
    const pr = this.prs.find(
      (p) => p.repository.projectOrWorkspace === repo.projectOrWorkspace && p.repository.slug === repo.slug && p.id === prId
    );
    if (pr) {
      pr.reviewers.push({
        user: { username: 'approver-bot', displayName: 'Approver Bot' },
        status: 'APPROVED',
        isApproved: true,
      });
    }
    return { success: true, message: `Approved PR #${prId} by approver-bot` };
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

describe('Full End-to-End Integration Flow & VPN Whitelist Validation', () => {
  let tmpDir: string;
  let server: ServerInstance;
  let mockClient: MockIntegrationBitbucketClient;
  let createdJobId: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
    mockClient = new MockIntegrationBitbucketClient();

    server = await buildServer({
      dataDir: tmpDir,
      disableScheduler: true,
    });
    server.scheduler.setTestClient(mockClient);
    await server.app.ready();
  });

  after(async () => {
    server.scheduler.stop();
    server.events.close();
    await server.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // STEP 1: Verify Token & Profile Loading
  describe('Step 1: Token Configuration & Connection Verification', () => {
    it('rejects connection test with missing baseUrl or token', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/config/test',
        payload: { serverType: 'server' },
      });
      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    });

    it('saves valid connection config with AES-256-GCM encryption and masked preview', async () => {
      const saveRes = await server.app.inject({
        method: 'POST',
        url: '/api/config',
        payload: {
          serverType: 'server',
          baseUrl: 'https://bitbucket.internal.company.com',
          authType: 'bearer',
          token: 'BBAA-SUPER-SECRET-PAT-XYZ123',
          skipSslVerification: true,
        },
      });

      assert.equal(saveRes.statusCode, 200);
      const saveBody = saveRes.json();
      assert.equal(saveBody.success, true);
      assert.equal(saveBody.data.hasToken, true);
      assert.equal(saveBody.data.tokenPreview, '••••••••Z123'); // Token masked!
      assert.equal(saveBody.data.token, undefined); // Token never leaked!
    });

    it('retrieves saved config with masked preview', async () => {
      const getRes = await server.app.inject({
        method: 'GET',
        url: '/api/config',
      });
      assert.equal(getRes.statusCode, 200);
      const body = getRes.json();
      assert.equal(body.success, true);
      assert.equal(body.data.baseUrl, 'https://bitbucket.internal.company.com');
      assert.equal(body.data.hasToken, true);
      assert.equal(body.data.token, undefined);
    });
  });

  // STEP 2: Job Creation & Filter Rule Setup
  describe('Step 2: Setup Filter Rules Job', () => {
    it('creates an approval job with multi-criteria rule filters', async () => {
      const payload = {
        name: 'Auto Approve Payment Service PRs',
        description: 'Automatically approves clean PRs from team engineers targeting main',
        enabled: true,
        dryRun: true, // Start in dry-run mode for safety
        intervalSeconds: 60,
        rules: {
          repositories: ['PAYMENT/checkout-service'],
          authorWhitelist: ['alice', 'bob'],
          authorBlacklist: ['rogue-bot', 'bad-actor'],
          excludeSelf: true,
          targetBranches: ['main', 'master'],
          sourceBranches: ['feature/*', 'fix/*'],
          ignoreDrafts: true,
          ignoreWithConflicts: true,
          requireSuccessfulBuild: false,
        },
      };

      const res = await server.app.inject({
        method: 'POST',
        url: '/api/jobs',
        payload,
      });

      assert.equal(res.statusCode, 201);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.name, payload.name);
      assert.equal(body.data.dryRun, true);
      assert.equal(body.data.rules.excludeSelf, true);
      assert.ok(body.data.id);
      createdJobId = body.data.id;
    });

    it('verifies created job in list endpoint', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/jobs',
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      const found = body.data.find((j: ApprovalJob) => j.id === createdJobId);
      assert.ok(found);
      assert.equal(found.name, 'Auto Approve Payment Service PRs');
    });

    it('evaluates rule filters comprehensively against simulated PRs', () => {
      const job = server.storage.getJobById(createdJobId);
      assert.ok(job);
      const botUser: BitbucketUserProfile = {
        username: 'approver-bot',
        displayName: 'Approver Bot',
        serverType: 'server',
        isAvailable: true,
        vpnConnected: true,
        verifiedAt: new Date().toISOString(),
      };

      // 1. Valid PR #101 should match
      const eval101 = RuleFilteringEngine.evaluate(mockClient.prs[0], job.rules, botUser);
      assert.equal(eval101.matched, true);
      assert.equal(eval101.wouldApprove, true);

      // 2. Self PR #102 should be rejected with self-exclusion
      const eval102 = RuleFilteringEngine.evaluate(mockClient.prs[1], job.rules, botUser);
      assert.equal(eval102.matched, false);
      assert.ok(eval102.failureReason?.toLowerCase().includes('self-exclusion'));

      // 3. Contractor PR #103 should be rejected with whitelist
      const eval103 = RuleFilteringEngine.evaluate(mockClient.prs[2], job.rules, botUser);
      assert.equal(eval103.matched, false);
      assert.ok(eval103.failureReason?.toLowerCase().includes('whitelist'));

      // 4. Blacklisted PR #104 should be rejected with blacklist
      const eval104 = RuleFilteringEngine.evaluate(mockClient.prs[3], job.rules, botUser);
      assert.equal(eval104.matched, false);
      assert.ok(eval104.failureReason?.toLowerCase().includes('blacklist'));

      // 5. Target branch staging PR #105 should be rejected with branch mismatch
      const eval105 = RuleFilteringEngine.evaluate(mockClient.prs[4], job.rules, botUser);
      assert.equal(eval105.matched, false);
      assert.ok(eval105.failureReason?.toLowerCase().includes('target branch'));

      // 6. Draft PR #106 should be rejected with draft
      const eval106 = RuleFilteringEngine.evaluate(mockClient.prs[5], job.rules, botUser);
      assert.equal(eval106.matched, false);
      assert.ok(eval106.failureReason?.toLowerCase().includes('draft'));

      // 7. Conflict PR #107 should be rejected with merge conflict
      const eval107 = RuleFilteringEngine.evaluate(mockClient.prs[6], job.rules, botUser);
      assert.equal(eval107.matched, false);
      assert.ok(eval107.failureReason?.toLowerCase().includes('conflict'));
    });
  });

  // STEP 3: Dry-Run Evaluation Mode
  describe('Step 3: Dry-Run Mode (Simulation without approval)', () => {
    it('executes job in dry-run mode: approves 0, logs DRY_RUN for valid PR, does not call approve API', async () => {
      // Execute job in dryRun mode
      await server.scheduler.executeJob(createdJobId, true);

      // Check Bitbucket Approve API calls
      assert.equal(
        mockClient.approveCalls.length,
        0,
        'Bitbucket approvePullRequest API must NOT be called in Dry-Run mode!'
      );

      // Verify logs generated
      const logs = server.storage.getRawLogs();
      assert.ok(logs.length > 0);

      // Valid PR #101 should have status DRY_RUN
      const pr101Log = logs.find((l) => l.prId === 101);
      assert.ok(pr101Log, 'PR #101 should be logged in Dry-Run mode');
      assert.equal(pr101Log?.status, 'DRY_RUN');
      assert.equal(pr101Log?.dryRun, true);
    });
  });

  // STEP 4: Live Mode Execution & Real Approval
  describe('Step 4: Live Mode Approval & Idempotency Cache', () => {
    it('switches job to Live mode, approves eligible PR, and adds to idempotency cache', async () => {
      // Update dryRun = false
      const updateRes = await server.app.inject({
        method: 'PUT',
        url: `/api/jobs/${createdJobId}`,
        payload: {
          dryRun: false,
        },
      });
      assert.equal(updateRes.statusCode, 200);

      // Execute job in Live mode
      await server.scheduler.executeJob(createdJobId, true);

      // Verify Bitbucket Approve API was called exactly once for PR #101
      assert.equal(mockClient.approveCalls.length, 1);
      assert.equal(mockClient.approveCalls[0].prId, 101);
      assert.equal(mockClient.approveCalls[0].repo.slug, 'checkout-service');

      // Verify idempotency cache contains PR #101
      assert.equal(server.scheduler.isApprovedCached('PAYMENT/checkout-service', 101), true);

      // Check log
      const logs = server.storage.getRawLogs();
      const approvedLog = logs.find((l) => l.prId === 101 && l.status === 'APPROVED');
      assert.ok(approvedLog);
      assert.equal(approvedLog?.dryRun, false);
      assert.ok(approvedLog?.reason.includes('Approved PR #101'));
    });

    it('repeat execution does not approve again (idempotent, 0 duplicate approvals)', async () => {
      const previousCallsCount = mockClient.approveCalls.length; // 1

      // Run again
      await server.scheduler.executeJob(createdJobId, true);

      // Verify NO additional approve API calls were made!
      assert.equal(mockClient.approveCalls.length, previousCallsCount);
    });
  });

  // STEP 5: Advanced Logs & Querying
  describe('Step 5: Logs Search & Aggregation API', () => {
    it('GET /api/logs with status filter returns only matching records', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/logs?status=APPROVED',
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.items.length > 0);
      for (const log of body.data.items) {
        assert.equal(log.status, 'APPROVED');
      }
    });

    it('GET /api/logs with free-text search matches title or author', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/logs?search=authentication',
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.items.length > 0);
      assert.ok(body.data.items[0].prTitle.toLowerCase().includes('authentication'));
    });

    it('GET /api/logs/stats returns accurate metrics', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/logs/stats',
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      const stats = body.data;
      assert.ok(stats.total >= 2);
      assert.ok(stats.approved >= 1);
      assert.ok(stats.dryRun >= 1);
      assert.equal(stats.failed, 0);
    });
  });

  // STEP 6: Corporate VPN & IP Whitelist Resilience
  describe('Step 6: Corporate VPN & IP Whitelist Resilience', () => {
    it('classifies network timeout / unreachable host as VPN_REQUIRED and updates status gracefully', async () => {
      mockClient.failMode = 'vpn';

      let errorEventFired = false;
      const originalBroadcast = server.events.broadcast.bind(server.events);
      server.events.broadcast = (type: any, data: any) => {
        if (type === 'error') errorEventFired = true;
        originalBroadcast(type, data);
      };

      // Clear cached user so it tries connecting and hits VPN timeout
      server.scheduler.setTestClient(mockClient);

      // Run job while VPN is down
      await server.scheduler.executeJob(createdJobId, true);

      // Verify scheduler status reflects VPN disconnected
      const status = server.scheduler.getStatus();
      assert.equal(status.vpnConnected, false, 'VPN should be marked disconnected');
      assert.equal(status.bitbucketStatus, 'DISCONNECTED');
      assert.equal(errorEventFired, true);

      server.events.broadcast = originalBroadcast;
    });

    it('recovers cleanly when corporate VPN reconnects', async () => {
      mockClient.failMode = 'none';
      server.scheduler.setTestClient(mockClient);

      // Run job after VPN reconnected
      await server.scheduler.executeJob(createdJobId, true);

      // Verify scheduler status recovered
      const status = server.scheduler.getStatus();
      assert.equal(status.vpnConnected, true, 'VPN status should recover to connected');
      assert.equal(status.bitbucketStatus, 'CONNECTED');
    });

    it('handles IP Whitelist / 403 Forbidden with proper classification without crashing runner', async () => {
      mockClient.failMode = 'ip_whitelist';
      server.scheduler.setTestClient(mockClient);

      await server.scheduler.executeJob(createdJobId, true);

      const status = server.scheduler.getStatus();
      assert.equal(status.bitbucketStatus, 'ERROR');

      // Verify scheduler is still alive and responsive
      assert.equal(server.scheduler.getStatus().isRunning, false);
    });
  });

  // STEP 7: SSE Event Streaming
  describe('Step 7: Realtime SSE Broadcast Verification', () => {
    it('broadcasts lifecycle events during job execution', async () => {
      mockClient.failMode = 'none';
      server.scheduler.setTestClient(mockClient);

      const receivedEvents: string[] = [];
      const originalBroadcast = server.events.broadcast.bind(server.events);
      server.events.broadcast = (type: any, data: any) => {
        receivedEvents.push(type);
        originalBroadcast(type, data);
      };

      await server.scheduler.executeJob(createdJobId, true);

      assert.ok(receivedEvents.includes('job_started'), 'Should broadcast job_started');
      assert.ok(receivedEvents.includes('pr_evaluated'), 'Should broadcast pr_evaluated');
      assert.ok(receivedEvents.includes('job_completed'), 'Should broadcast job_completed');

      server.events.broadcast = originalBroadcast;
    });
  });
});

