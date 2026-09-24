import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildServer, type ServerInstance } from '../server.js';

describe('Advanced Logs & Statistics API', () => {
  let tmpDir: string;
  let server: ServerInstance;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-'));
    server = await buildServer({
      dataDir: tmpDir,
      disableScheduler: true,
    });
    await server.app.ready();

    // Populate mock log entries
    const items = [
      {
        jobId: 'job-1',
        jobName: 'Core Approver',
        prId: 501,
        prTitle: 'fix(auth): prevent token expiration race condition',
        prUrl: 'http://bitbucket/CORE/auth/pull-requests/501',
        repository: 'CORE/auth',
        author: 'sarahc',
        sourceBranch: 'bugfix/token-race',
        targetBranch: 'master',
        status: 'APPROVED' as const,
        reason: 'Matched author and target branch',
        dryRun: false,
        durationMs: 120,
      },
      {
        jobId: 'job-1',
        jobName: 'Core Approver',
        prId: 502,
        prTitle: 'feat(ui): add dashboard dark mode',
        prUrl: 'http://bitbucket/CORE/web/pull-requests/502',
        repository: 'CORE/web',
        author: 'alex',
        sourceBranch: 'feature/dark-mode',
        targetBranch: 'develop',
        status: 'DRY_RUN' as const,
        reason: 'Simulated approval in dry run mode',
        dryRun: true,
        durationMs: 45,
      },
      {
        jobId: 'job-2',
        jobName: 'Infra Approver',
        prId: 503,
        prTitle: 'chore: update terraform providers',
        prUrl: 'http://bitbucket/INFRA/tf/pull-requests/503',
        repository: 'INFRA/tf',
        author: 'devops-bot',
        sourceBranch: 'chore/deps',
        targetBranch: 'main',
        status: 'SKIPPED' as const,
        reason: 'Author in blacklist',
        dryRun: false,
        durationMs: 15,
      },
      {
        jobId: 'job-2',
        jobName: 'Infra Approver',
        prId: 504,
        prTitle: 'ci: fix docker build cache',
        prUrl: 'http://bitbucket/INFRA/tf/pull-requests/504',
        repository: 'INFRA/tf',
        author: 'devops-bot',
        sourceBranch: 'ci/cache',
        targetBranch: 'main',
        status: 'FAILED' as const,
        reason: 'HTTP 500 internal bitbucket error',
        dryRun: false,
        durationMs: 90,
      },
    ];

    for (const item of items) {
      server.storage.addLog(item);
    }
  });

  after(async () => {
    server.scheduler.stop();
    server.events.close();
    await server.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searches logs by free-text keywords (title, author, repo, reason)', async () => {
    // Search by title keyword "dark mode"
    const res1 = await server.app.inject({
      method: 'GET',
      url: '/api/logs?search=dark+mode',
    });
    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.data.total, 1);
    assert.equal(body1.data.items[0].prId, 502);

    // Search by author "sarahc"
    const res2 = await server.app.inject({
      method: 'GET',
      url: '/api/logs?search=sarahc',
    });
    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.data.total, 1);
    assert.equal(body2.data.items[0].author, 'sarahc');

    // Search by PR ID number
    const res3 = await server.app.inject({
      method: 'GET',
      url: '/api/logs?search=504',
    });
    assert.equal(res3.statusCode, 200);
    const body3 = res3.json();
    assert.equal(body3.data.total, 1);
    assert.equal(body3.data.items[0].status, 'FAILED');
  });

  it('computes and returns aggregate log statistics via /api/logs/stats', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/logs/stats',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);

    const stats = body.data;
    assert.equal(stats.total, 4);
    assert.equal(stats.approved, 1);
    assert.equal(stats.dryRun, 1);
    assert.equal(stats.skipped, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.recent24hCount, 4);
    assert.equal(stats.byRepository['CORE/auth'], 1);
    assert.equal(stats.byRepository['INFRA/tf'], 2);
  });
});
