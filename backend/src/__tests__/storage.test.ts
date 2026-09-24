import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageService } from '../services/storage.js';

describe('Storage Service', () => {
  let tmpDir: string;
  let storage: StorageService;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    storage = new StorageService(tmpDir);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and retrieves masked config while storing encrypted token on disk', () => {
    const rawToken = 'my-secret-pat-token-xyz';
    const saved = storage.saveConfig({
      serverType: 'server',
      baseUrl: 'https://bitbucket.internal.company.com',
      authType: 'bearer',
      token: rawToken,
      username: 'hungnv',
      skipSslVerification: true,
      proxyUrl: 'http://proxy.corp:8080',
      timeoutMs: 20000,
    });

    assert.equal(saved.hasToken, true);
    assert.equal(saved.tokenPreview, '••••••••-xyz');
    assert.equal((saved as any).token, undefined);

    // Verify file on disk does not contain plaintext token
    const configOnDisk = fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8');
    assert.ok(!configOnDisk.includes(rawToken));
    assert.ok(configOnDisk.includes('encryptedToken'));

    // Verify internal config retrieval decrypts token
    const internalConfig = storage.getConfig();
    assert.equal(internalConfig?.token, rawToken);
  });

  it('performs CRUD and toggle on Approval Jobs', () => {
    const job = storage.createJob({
      name: 'Test Job 1',
      description: 'First job description',
      intervalSeconds: 30,
      dryRun: true,
      rules: {
        repositories: ['CORE/*'],
        authorWhitelist: ['alex'],
        targetBranches: ['develop'],
        excludeSelf: true,
        ignoreDrafts: true,
        ignoreWithConflicts: true,
      },
    });

    assert.ok(job.id);
    assert.equal(job.name, 'Test Job 1');
    assert.equal(job.enabled, true);
    assert.equal(job.dryRun, true);

    const retrieved = storage.getJobById(job.id);
    assert.equal(retrieved?.name, 'Test Job 1');

    // Update
    const updated = storage.updateJob(job.id, {
      name: 'Updated Job Name',
      dryRun: false,
    });
    assert.equal(updated?.name, 'Updated Job Name');
    assert.equal(updated?.dryRun, false);

    // Toggle
    const toggled = storage.toggleJob(job.id, false);
    assert.equal(toggled?.enabled, false);

    // Delete
    const deleted = storage.deleteJob(job.id);
    assert.equal(deleted, true);
    assert.equal(storage.getJobById(job.id), null);
  });

  it('manages bounded logs with pagination and status counting', () => {
    storage.clearLogs();

    for (let i = 1; i <= 5; i++) {
      storage.addLog({
        jobId: 'job-1',
        jobName: 'Job 1',
        prId: i,
        prTitle: `PR #${i}`,
        prUrl: `http://pr/${i}`,
        repository: 'CORE/repo',
        author: 'dev',
        sourceBranch: 'feat',
        targetBranch: 'main',
        status: i % 2 === 0 ? 'APPROVED' : 'DRY_RUN',
        reason: 'Matched all rules',
        dryRun: i % 2 !== 0,
        durationMs: 50,
      });
    }

    const paged = storage.getLogs({ page: 1, limit: 2 });
    assert.equal(paged.total, 5);
    assert.equal(paged.items.length, 2);
    assert.equal(paged.totalPages, 3);

    const approvedCount = storage.getTotalApprovedCount();
    assert.equal(approvedCount, 2); // PR #2 and #4

    storage.clearLogs();
    assert.equal(storage.getRawLogs().length, 0);
  });
});
