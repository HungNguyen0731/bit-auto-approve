import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { WorkerExecutor } from './executor.js';
import type { ExecutionLease } from '@bitbucket-pr-approver/shared';

describe('WorkerExecutor Session Auth and CI Optimization Tests', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: any;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  it('correctly parses session auth token containing cookie and csrfToken JSON', () => {
    const executor = new WorkerExecutor();
    const lease: ExecutionLease = {
      executionId: 'exec-1',
      idempotencyKey: 'idemp-1',
      jobId: 'job-1',
      jobRevision: '1',
      workerId: 'worker-1',
      trigger: 'MANUAL',
      status: 'LEASED',
      scheduledFor: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastSequence: 0,
      job: {
        id: 'job-1',
        name: 'Test Job',
        rules: {
          repositories: ['my-ws/my-repo'],
          authorWhitelist: ['test-author'],
          targetBranches: ['main'],
          mergeTargetBranches: ['main'],
          excludeSelf: true,
          ignoreDrafts: true,
          ignoreWithConflicts: true,
        },
        intervalSeconds: 60,
        dryRun: false,
        autoMergeOnSuccessfulBuild: true,
      },
      bitbucketConfig: {
        serverType: 'cloud',
        baseUrl: 'https://bitbucket.org/!api/2.0',
        authType: 'session',
      },
    };

    const sessionPayload = JSON.stringify({
      cookie: 'cloud.session.token=xyz; bb_session=abc',
      csrfToken: 'csrf-12345',
    });

    const config = (executor as any).buildBitbucketConfig(lease, sessionPayload);
    assert.equal(config.authType, 'session');
    assert.equal(config.cookie, 'cloud.session.token=xyz; bb_session=abc');
    assert.equal(config.csrfToken, 'csrf-12345');
  });

  it('preserves existing cookie and csrfToken on lease when token is raw', () => {
    const executor = new WorkerExecutor();
    const lease: ExecutionLease = {
      executionId: 'exec-2',
      idempotencyKey: 'idemp-2',
      jobId: 'job-2',
      jobRevision: '1',
      workerId: 'worker-1',
      trigger: 'MANUAL',
      status: 'LEASED',
      scheduledFor: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastSequence: 0,
      job: {
        id: 'job-2',
        name: 'Test Job',
        rules: {
          repositories: ['my-ws/my-repo'],
          authorWhitelist: ['*'],
          targetBranches: ['*'],
          excludeSelf: true,
          ignoreDrafts: true,
          ignoreWithConflicts: true,
        },
        intervalSeconds: 60,
        dryRun: false,
      },
      bitbucketConfig: {
        serverType: 'cloud',
        baseUrl: 'https://bitbucket.org/!api/2.0',
        authType: 'session',
        cookie: 'saved-cookie',
        csrfToken: 'saved-csrf',
      },
    };

    const config = (executor as any).buildBitbucketConfig(lease, 'raw-token');
    assert.equal(config.authType, 'session');
    assert.equal(config.cookie, 'saved-cookie');
    assert.equal(config.csrfToken, 'saved-csrf');
  });

  it('executes approve and merge without duplicate CI status checks', async () => {
    const executor = new WorkerExecutor();
    const pool = mockAgent.get('https://bitbucket.org');

    // 1. /user
    pool.intercept({ path: '/!api/2.0/user', method: 'GET' }).reply(200, {
      account_id: 'acc-123',
      nickname: 'approver-bot',
      display_name: 'Approver Bot',
    }, { headers: { 'content-type': 'application/json' } });

    // 2. /user/workspaces
    pool.intercept({ path: '/!api/2.0/user/workspaces?pagelen=100', method: 'GET' }).reply(200, {
      values: [{ workspace: { slug: 'my-ws', name: 'My WS', uuid: '{ws-1}' } }],
    }, { headers: { 'content-type': 'application/json' } });

    // 3. listOpenPullRequests
    pool.intercept({
      path: '/!api/2.0/repositories/my-ws/my-repo/pullrequests?state=OPEN&pagelen=50',
      method: 'GET',
    }).reply(200, {
      values: [{
        id: 101,
        title: 'Feature: optimize pacing',
        state: 'OPEN',
        author: { account_id: 'dev-1', nickname: 'dev1', display_name: 'Dev One' },
        destination: {
          repository: { full_name: 'my-ws/my-repo', slug: 'my-repo' },
          branch: { name: 'main' },
        },
        source: {
          branch: { name: 'feature/pacing' },
          commit: { hash: 'abcdef123456' },
        },
        participants: [],
      }],
    }, { headers: { 'content-type': 'application/json' } });

    // 4. getCommitBuildStatus - Track call count
    let commitStatusCallCount = 0;
    pool.intercept({
      path: '/!api/2.0/repositories/my-ws/my-repo/commit/abcdef123456/statuses?pagelen=100',
      method: 'GET',
    }).reply(200, () => {
      commitStatusCallCount++;
      return {
        values: [{
          key: 'ci/build',
          state: 'SUCCESSFUL',
          updated_on: new Date().toISOString(),
        }],
      };
    }, { headers: { 'content-type': 'application/json' } });

    // 5. approvePullRequest
    let approveCalled = false;
    pool.intercept({
      path: '/!api/2.0/repositories/my-ws/my-repo/pullrequests/101/approve',
      method: 'POST',
    }).reply(200, () => {
      approveCalled = true;
      return { status: 'APPROVED' };
    }, { headers: { 'content-type': 'application/json' } });

    // 6. fresh getPullRequest
    pool.intercept({
      path: '/!api/2.0/repositories/my-ws/my-repo/pullrequests/101',
      method: 'GET',
    }).reply(200, {
      id: 101,
      title: 'Feature: optimize pacing',
      state: 'OPEN',
      author: { account_id: 'dev-1', nickname: 'dev1', display_name: 'Dev One' },
      destination: {
        repository: { full_name: 'my-ws/my-repo', slug: 'my-repo' },
        branch: { name: 'main' },
      },
      source: {
        branch: { name: 'feature/pacing' },
        commit: { hash: 'abcdef123456' },
      },
      participants: [{
        user: { account_id: 'acc-123', nickname: 'approver-bot' },
        approved: true,
      }],
    }, { headers: { 'content-type': 'application/json' } });

    // 7. mergePullRequest
    let mergeCalled = false;
    pool.intercept({
      path: '/!api/2.0/repositories/my-ws/my-repo/pullrequests/101/merge?async=true',
      method: 'POST',
    }).reply(200, () => {
      mergeCalled = true;
      return { state: 'MERGED' };
    }, { headers: { 'content-type': 'application/json' } });

    const lease: ExecutionLease = {
      executionId: 'exec-3',
      idempotencyKey: 'idemp-3',
      jobId: 'job-3',
      jobRevision: '1',
      workerId: 'worker-1',
      trigger: 'MANUAL',
      status: 'LEASED',
      scheduledFor: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastSequence: 0,
      job: {
        id: 'job-3',
        name: 'Auto Merge Job',
        rules: {
          repositories: ['my-ws/my-repo'],
          authorWhitelist: ['dev1'],
          targetBranches: ['main'],
          mergeTargetBranches: ['main'],
          excludeSelf: true,
          ignoreDrafts: true,
          ignoreWithConflicts: true,
        },
        intervalSeconds: 60,
        dryRun: false,
        autoMergeOnSuccessfulBuild: true,
      },
      bitbucketConfig: {
        serverType: 'cloud',
        baseUrl: 'https://bitbucket.org/!api/2.0',
        authType: 'session',
        cookie: 'cloud.session.token=xyz',
        csrfToken: 'csrf-123',
      },
    };

    const progressSteps: string[] = [];
    const result = await executor.execute(
      lease,
      JSON.stringify({
        cookie: 'cloud.session.token=xyz',
        csrfToken: 'csrf-123',
      }),
      (entry) => {
        if (entry.flowStep) progressSteps.push(entry.flowStep);
      }
    );

    assert.equal(result.summary.status, 'COMPLETED');
    assert.equal(result.summary.approved, 1);
    assert.equal(result.summary.merged, 1);
    assert.equal(approveCalled, true);
    assert.equal(mergeCalled, true);
    // VERIFY OPTIMIZATION: getCommitBuildStatus was called only ONCE!
    assert.equal(commitStatusCallCount, 1, 'getCommitBuildStatus must be called only once without duplicate check');

    // VERIFY REALTIME FLOW STEPS:
    assert.ok(progressSteps.includes('SCAN_REPO'), 'Emitted SCAN_REPO flow step');
    assert.ok(progressSteps.includes('MATCH_PR'), 'Emitted MATCH_PR flow step');
    assert.ok(progressSteps.includes('CHECK_CI'), 'Emitted CHECK_CI flow step');
    assert.ok(progressSteps.includes('APPROVE'), 'Emitted APPROVE flow step');
    assert.ok(progressSteps.includes('MERGE'), 'Emitted MERGE flow step');
  });
});
