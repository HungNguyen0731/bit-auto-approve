import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import type {
  BitbucketUserProfile,
  JobFilterRules,
  PullRequest,
} from '@bitbucket-pr-approver/shared';
import { buildServer, type ServerInstance } from '../server.js';
import { RuleFilteringEngine } from '../engine/filter.js';
import { CryptoService } from '../services/crypto.js';

describe('Performance Benchmarks & Resource Profiling', () => {
  let tmpDir: string;
  let server: ServerInstance;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
    server = await buildServer({
      dataDir: tmpDir,
      disableScheduler: true,
    });
    await server.app.ready();

    // Populate some baseline logs for query benchmarking
    for (let i = 1; i <= 200; i++) {
      server.storage.addLog({
        jobId: `job-${i % 5}`,
        jobName: `Job #${i % 5}`,
        prId: 1000 + i,
        prTitle: `Fix issue #${i} in payment gateway and optimize auth`,
        prUrl: `https://bitbucket.internal/repo/pull-requests/${1000 + i}`,
        repository: `PAYMENT/service-${i % 3}`,
        author: `engineer-${i % 10}`,
        sourceBranch: `feature/ticket-${i}`,
        targetBranch: 'main',
        status: i % 4 === 0 ? 'APPROVED' : i % 4 === 1 ? 'DRY_RUN' : 'SKIPPED',
        reason: 'Automated evaluation result reason description',
        dryRun: i % 4 === 1,
        durationMs: 2,
      });
    }
  });

  after(async () => {
    server.scheduler.stop();
    server.events.close();
    await server.app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Benchmark: Fastify REST API response latency is ultra-fast (< 5ms mean)', async () => {
    const iterations = 100;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/health',
      });
      const duration = performance.now() - start;
      latencies.push(duration);
      assert.equal(res.statusCode, 200);
    }

    const meanLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
    latencies.sort((a, b) => a - b);
    const p95Latency = latencies[Math.floor(iterations * 0.95)];

    // Target: Mean latency well under 5ms, p95 under 10ms for local in-process injection
    assert.ok(meanLatency < 5, `Mean latency ${meanLatency.toFixed(2)}ms should be < 5ms`);
    assert.ok(p95Latency < 10, `P95 latency ${p95Latency.toFixed(2)}ms should be < 10ms`);
  });

  it('Benchmark: Log search & Stats aggregation over 200+ records (< 10ms mean)', async () => {
    const iterations = 50;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/logs?search=gateway&status=APPROVED&limit=20',
      });
      const duration = performance.now() - start;
      latencies.push(duration);
      assert.equal(res.statusCode, 200);
    }

    const meanLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
    assert.ok(meanLatency < 10, `Mean logs search latency ${meanLatency.toFixed(2)}ms should be < 10ms`);
  });

  it('Benchmark: Rule Filtering Engine throughput (> 20,000 evaluations/sec)', () => {
    const rules: JobFilterRules = {
      repositories: ['PAYMENT/*'],
      authorWhitelist: ['alice', 'bob', 'charlie', 'engineer-*'],
      authorBlacklist: ['bad-bot', 'rogue-*'],
      excludeSelf: true,
      targetBranches: ['main', 'master', 'develop'],
      sourceBranches: ['feature/*', 'fix/*', 'hotfix/*'],
      ignoreDrafts: true,
      ignoreWithConflicts: true,
      titleKeywordsExclude: ['[WIP]', 'DO NOT MERGE'],
      requireSuccessfulBuild: false,
    };

    const currentUser: BitbucketUserProfile = {
      username: 'approver-bot',
      displayName: 'Approver Bot',
      serverType: 'server',
      isAvailable: true,
      vpnConnected: true,
      verifiedAt: new Date().toISOString(),
    };

    const testPrs: PullRequest[] = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      title: i % 7 === 0 ? '[WIP] Experimental refactor' : `feat: implement microservice feature #${i}`,
      state: 'OPEN',
      author: {
        username: i % 10 === 0 ? 'approver-bot' : `engineer-${i % 8}`,
        displayName: `Engineer ${i % 8}`,
      },
      repository: {
        projectOrWorkspace: 'PAYMENT',
        slug: `service-${i % 4}`,
      },
      sourceBranch: {
        name: i % 3 === 0 ? `feature/feat-${i}` : `chore/misc-${i}`,
        refId: `refs/heads/branch-${i}`,
      },
      targetBranch: {
        name: i % 5 === 0 ? 'staging' : 'main',
        refId: 'refs/heads/main',
      },
      reviewers: [],
      isDraft: i % 11 === 0,
      hasConflicts: i % 13 === 0,
      createdDate: new Date().toISOString(),
      updatedDate: new Date().toISOString(),
      htmlUrl: `http://bitbucket/PAYMENT/repo/pull-requests/${i}`,
    }));

    const start = performance.now();
    for (const pr of testPrs) {
      RuleFilteringEngine.evaluate(pr, rules, currentUser);
    }
    const elapsedMs = performance.now() - start;

    const opsPerSec = (testPrs.length / elapsedMs) * 1000;
    const microsecPerOp = (elapsedMs / testPrs.length) * 1000;

    // Fast memory evaluation: > 20,000 PRs/sec, < 50µs per PR
    assert.ok(
      opsPerSec > 20000,
      `Rule evaluation throughput ${opsPerSec.toFixed(0)} ops/sec should exceed 20,000 ops/sec (took ${elapsedMs.toFixed(2)}ms for 5,000 PRs, ~${microsecPerOp.toFixed(2)}µs/op)`
    );
  });

  it('Benchmark: CryptoService AES-256-GCM encryption/decryption throughput (> 10,000 ops/sec)', () => {
    const keyPath = path.join(tmpDir, 'master.key');
    const cryptoService = new CryptoService(keyPath);
    const secret = 'BBAA-SUPER-SECRET-PAT-VERY-LONG-KEY-1234567890-ABCDEF';
    const iterations = 1000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const encrypted = cryptoService.encrypt(secret);
      const decrypted = cryptoService.decrypt(encrypted);
      assert.equal(decrypted, secret);
    }
    const elapsedMs = performance.now() - start;
    const opsPerSec = (iterations / elapsedMs) * 1000;

    assert.ok(
      opsPerSec > 10000,
      `AES-256-GCM throughput ${opsPerSec.toFixed(0)} ops/sec should exceed 10,000 ops/sec (took ${elapsedMs.toFixed(2)}ms for 1,000 cycles)`
    );
  });

  it('Resource Profile: Node.js memory footprint remains lean (< 50MB heap)', () => {
    if (global.gc) {
      global.gc();
    }
    const mem = process.memoryUsage();
    const heapUsedMb = mem.heapUsed / 1024 / 1024;
    const rssMb = mem.rss / 1024 / 1024;

    // The backend runtime should easily stay under 50MB heap
    assert.ok(heapUsedMb < 50, `Heap used ${heapUsedMb.toFixed(2)}MB must remain lean (< 50MB)`);
    assert.ok(rssMb < 150, `RSS ${rssMb.toFixed(2)}MB must remain bounded (< 150MB)`);
  });
});
