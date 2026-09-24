import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildServer, type ServerInstance } from '../server.js';

describe('Fastify REST API', () => {
  let tmpDir: string;
  let server: ServerInstance;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
    server = await buildServer({
      dataDir: tmpDir,
      disableScheduler: true,
    });
    await server.app.ready();
  });

  after(async () => {
    server.scheduler.stop();
    server.events.close();
    await server.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/health returns 200 and system health', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'OK');
  });

  it('GET /api/status returns scheduler status', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(typeof body.data.activeJobsCount, 'number');
  });

  it('POST & GET /api/config saves and returns masked config', async () => {
    const postRes = await server.app.inject({
      method: 'POST',
      url: '/api/config',
      payload: {
        serverType: 'server',
        baseUrl: 'https://bitbucket.internal.company.com',
        authType: 'bearer',
        token: 'BBAA-SECRET-TOKEN-1234',
        username: 'hungnv',
        skipSslVerification: true,
      },
    });

    assert.equal(postRes.statusCode, 200);
    const postBody = postRes.json();
    assert.equal(postBody.success, true);
    assert.equal(postBody.data.hasToken, true);
    assert.equal(postBody.data.tokenPreview, '••••••••1234');
    assert.equal(postBody.data.token, undefined);

    const getRes = await server.app.inject({
      method: 'GET',
      url: '/api/config',
    });

    assert.equal(getRes.statusCode, 200);
    const getBody = getRes.json();
    assert.equal(getBody.success, true);
    assert.equal(getBody.data.baseUrl, 'https://bitbucket.internal.company.com');
    assert.equal(getBody.data.hasToken, true);
  });

  it('Job API lifecycle: POST, GET, PUT, TOGGLE, DELETE', async () => {
    // 1. Create Job
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        name: 'Core Auto Approver',
        description: 'Auto approves backend PRs',
        intervalSeconds: 45,
        dryRun: true,
        rules: {
          repositories: ['CORE/*'],
          authorWhitelist: ['developer-alex'],
          targetBranches: ['develop'],
          excludeSelf: true,
          ignoreDrafts: true,
          ignoreWithConflicts: true,
        },
      },
    });

    assert.equal(createRes.statusCode, 201);
    const createdJob = createRes.json().data;
    assert.ok(createdJob.id);
    assert.equal(createdJob.name, 'Core Auto Approver');
    const jobId = createdJob.id;

    // 2. List Jobs
    const listRes = await server.app.inject({
      method: 'GET',
      url: '/api/jobs',
    });
    assert.equal(listRes.statusCode, 200);
    const jobs = listRes.json().data;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, jobId);

    // 3. Update Job
    const updateRes = await server.app.inject({
      method: 'PUT',
      url: `/api/jobs/${jobId}`,
      payload: {
        name: 'Updated Approver',
        intervalSeconds: 90,
      },
    });
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.json().data.name, 'Updated Approver');
    assert.equal(updateRes.json().data.intervalSeconds, 90);

    // 4. Toggle Job
    const toggleRes = await server.app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/toggle`,
      payload: { enabled: false },
    });
    assert.equal(toggleRes.statusCode, 200);
    assert.equal(toggleRes.json().data.enabled, false);

    // 5. Delete Job
    const deleteRes = await server.app.inject({
      method: 'DELETE',
      url: `/api/jobs/${jobId}`,
    });
    assert.equal(deleteRes.statusCode, 200);

    // Verify deleted
    const verifyRes = await server.app.inject({
      method: 'GET',
      url: '/api/jobs',
    });
    assert.equal(verifyRes.json().data.length, 0);
  });

  it('GET & DELETE /api/logs', async () => {
    server.storage.addLog({
      jobId: 'test-job',
      jobName: 'Test Job',
      prId: 201,
      prTitle: 'fix: memory leak',
      prUrl: 'http://test/pr/201',
      repository: 'CORE/api',
      author: 'alex',
      sourceBranch: 'fix/leak',
      targetBranch: 'master',
      status: 'APPROVED',
      reason: 'Matched all rules',
      dryRun: false,
      durationMs: 80,
    });

    const getRes = await server.app.inject({
      method: 'GET',
      url: '/api/logs?page=1&limit=10',
    });
    assert.equal(getRes.statusCode, 200);
    const body = getRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.total, 1);
    assert.equal(body.data.items[0].prId, 201);

    const deleteRes = await server.app.inject({
      method: 'DELETE',
      url: '/api/logs',
    });
    assert.equal(deleteRes.statusCode, 200);

    const verifyRes = await server.app.inject({
      method: 'GET',
      url: '/api/logs',
    });
    assert.equal(verifyRes.json().data.total, 0);
  });
});
