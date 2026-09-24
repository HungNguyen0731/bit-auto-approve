import {
  APP_CONSTANTS,
  type ApprovalJob,
  type ApprovalLogEntry,
  type BitbucketConnectionConfig,
  type BitbucketUserProfile,
  type PullRequest,
  type RepositoryRef,
  type SchedulerStatus,
} from '@bitbucket-pr-approver/shared';
import { createBitbucketClient, type IBitbucketClient } from '../bitbucket/index.js';
import { RuleFilteringEngine } from '../engine/filter.js';
import { matchesPattern } from '../engine/matcher.js';
import type { EventHub } from './events.js';
import type { StorageService } from './storage.js';
import type { ExecutionDispatcher } from './execution-dispatcher.js';

interface ApprovedCacheEntry {
  approvedAt: number;
}

export class SchedulerService {
  private readonly storage: StorageService;
  private readonly events: EventHub;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private lastExecutionAt?: string;
  private vpnConnected: boolean = true;
  private bitbucketStatus: SchedulerStatus['bitbucketStatus'] = 'UNCONFIGURED';
  private cachedUser?: BitbucketUserProfile;
  private client?: IBitbucketClient;
  private configHash?: string;
  private executingJobIds: Set<string> = new Set();

  // In-memory idempotency cache: key = `${project}/${slug}/${prId}`
  private approvedCache: Map<string, ApprovedCacheEntry> = new Map();

  private isTestClient: boolean = false;

  constructor(
    storage: StorageService,
    events: EventHub,
    private readonly executionDispatcher?: ExecutionDispatcher
  ) {
    this.storage = storage;
    this.events = events;
    this.hydrateCacheFromLogs();
  }

  setTestClient(client?: IBitbucketClient): void {
    this.isTestClient = Boolean(client);
    this.client = client;
    this.cachedUser = undefined;
  }

  isApprovedCached(repo: string, prId: number): boolean {
    return this.approvedCache.has(`${repo}/${prId}`);
  }

  clearCache(): void {
    this.approvedCache.clear();
  }

  private updateStatus(vpnConnected: boolean, bitbucketStatus: SchedulerStatus['bitbucketStatus']): void {
    const changed = this.vpnConnected !== vpnConnected || this.bitbucketStatus !== bitbucketStatus;
    this.vpnConnected = vpnConnected;
    this.bitbucketStatus = bitbucketStatus;
    if (changed) {
      this.events.broadcast('status_changed', this.getStatus());
    }
  }

  /**
   * Hydrate idempotency cache from recent logs (within 24h) to survive app restarts
   */
  private hydrateCacheFromLogs(): void {
    const rawLogs = this.storage.getRawLogs();
    const now = Date.now();
    const ttl = APP_CONSTANTS.CACHE.APPROVED_PR_CACHE_TTL_MS;

    for (const log of rawLogs) {
      if (log.status === 'APPROVED' || log.status === 'ALREADY_APPROVED') {
        const logTime = new Date(log.timestamp).getTime();
        if (now - logTime < ttl) {
          const cacheKey = `${log.repository}/${log.prId}`;
          this.approvedCache.set(cacheKey, { approvedAt: logTime });
        }
      }
    }
  }

  private getClient(config: BitbucketConnectionConfig): IBitbucketClient {
    if (this.isTestClient && this.client) {
      return this.client;
    }
    const hash = `${config.serverType}:${config.baseUrl}:${config.token}:${config.username}:${config.skipSslVerification}`;
    if (!this.client || this.configHash !== hash) {
      this.client = createBitbucketClient(config);
      this.configHash = hash;
      this.cachedUser = undefined;
    }
    return this.client;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextTick();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(delayMs: number = 5000): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        // Scheduler loop guard
      } finally {
        this.scheduleNextTick();
      }
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    this.executionDispatcher?.markOfflineWorkers();
    const config = this.storage.getConfig();
    if (!config || !config.baseUrl || !config.token) {
      this.bitbucketStatus = 'UNCONFIGURED';
      return;
    }

    const jobs = this.storage.getJobs().filter((j) => j.enabled);
    const now = Date.now();

    for (const job of jobs) {
      if (this.executingJobIds.has(job.id)) {
        continue;
      }

      const nextRun = job.nextRunAt ? new Date(job.nextRunAt).getTime() : 0;
      if (now >= nextRun) {
        if ((job.executionMode ?? 'local') === 'worker') {
          this.executionDispatcher?.schedule(job, new Date(now));
          continue;
        }
        // Execute job in background
        this.executeJob(job.id).catch(() => {});
      }
    }

    this.cleanupCache();
  }

  private cleanupCache(): void {
    const now = Date.now();
    const ttl = APP_CONSTANTS.CACHE.APPROVED_PR_CACHE_TTL_MS;
    for (const [key, entry] of this.approvedCache.entries()) {
      if (now - entry.approvedAt > ttl) {
        this.approvedCache.delete(key);
      }
    }
  }

  async runJobNow(jobId: string): Promise<void> {
    return this.executeJob(jobId, true);
  }

  async executeJob(jobId: string, force: boolean = false): Promise<void> {
    const job = this.storage.getJobById(jobId);
    if (!job) return;
    if (this.executingJobIds.has(jobId) && !force) return;

    this.executingJobIds.add(jobId);
    const startTime = Date.now();

    try {
      const config = this.storage.getConfig();
      if (!config) {
        this.bitbucketStatus = 'UNCONFIGURED';
        return;
      }

      const client = this.getClient(config);

      // Verify connection / current user
      if (!this.cachedUser) {
        try {
          this.cachedUser = await client.getCurrentUser();
          this.updateStatus(true, 'CONNECTED');
        } catch (err: any) {
          const isVpnErr = err.code === 'VPN_REQUIRED';
          this.updateStatus(!isVpnErr, isVpnErr ? 'DISCONNECTED' : 'ERROR');
          this.events.broadcast('error', {
            jobId,
            error: err.message,
            code: err.code,
          });
          return;
        }
      }

      this.events.broadcast('job_started', {
        jobId: job.id,
        jobName: job.name,
        timestamp: new Date().toISOString(),
      });

      // Resolve targets and fetch open PRs
      const repoRefs = await this.resolveJobRepositories(client, job);
      let scannedCount = 0;
      let approvedCount = 0;

      for (const repo of repoRefs) {
        let openPrs: PullRequest[] = [];
        try {
          openPrs = await client.listOpenPullRequests(repo);
        } catch (err: any) {
          const isVpnErr = err.code === 'VPN_REQUIRED';
          this.updateStatus(!isVpnErr, isVpnErr ? 'DISCONNECTED' : 'ERROR');
          this.events.broadcast('error', {
            jobId: job.id,
            repo: `${repo.projectOrWorkspace}/${repo.slug}`,
            error: err.message,
            code: err.code,
          });
          continue;
        }

        for (const pr of openPrs) {
          scannedCount++;
          const evalStart = Date.now();
          const evaluation = RuleFilteringEngine.evaluate(pr, job.rules, this.cachedUser);

          this.events.broadcast('pr_evaluated', {
            jobId: job.id,
            prId: pr.id,
            repo: `${repo.projectOrWorkspace}/${repo.slug}`,
            matched: evaluation.matched,
            wouldApprove: evaluation.wouldApprove,
            reasons: evaluation.reasons,
            failureReason: evaluation.failureReason,
          });

          const cacheKey = `${repo.projectOrWorkspace}/${repo.slug}/${pr.id}`;
          const isCachedApproved = this.approvedCache.has(cacheKey);

          if (evaluation.wouldApprove && !isCachedApproved) {
            if (job.dryRun) {
              // Dry Run Simulation
              this.storage.addLog({
                jobId: job.id,
                jobName: job.name,
                prId: pr.id,
                prTitle: pr.title,
                prUrl: pr.htmlUrl,
                repository: `${repo.projectOrWorkspace}/${repo.slug}`,
                author: pr.author.username,
                sourceBranch: pr.sourceBranch.name,
                targetBranch: pr.targetBranch.name,
                status: 'DRY_RUN',
                reason: evaluation.reasons.join('; '),
                dryRun: true,
                durationMs: Date.now() - evalStart,
              });

              this.events.broadcast('pr_approved', {
                jobId: job.id,
                prId: pr.id,
                title: pr.title,
                author: pr.author.username,
                dryRun: true,
              });
              approvedCount++;
            } else {
              // Actual Approval via API
              try {
                const approveRes = await client.approvePullRequest(repo, pr.id);
                this.approvedCache.set(cacheKey, { approvedAt: Date.now() });

                this.storage.addLog({
                  jobId: job.id,
                  jobName: job.name,
                  prId: pr.id,
                  prTitle: pr.title,
                  prUrl: pr.htmlUrl,
                  repository: `${repo.projectOrWorkspace}/${repo.slug}`,
                  author: pr.author.username,
                  sourceBranch: pr.sourceBranch.name,
                  targetBranch: pr.targetBranch.name,
                  status: 'APPROVED',
                  reason: approveRes.message || evaluation.reasons.join('; '),
                  dryRun: false,
                  durationMs: Date.now() - evalStart,
                });

                this.events.broadcast('pr_approved', {
                  jobId: job.id,
                  prId: pr.id,
                  title: pr.title,
                  author: pr.author.username,
                  dryRun: false,
                });
                approvedCount++;
              } catch (err: any) {
                this.storage.addLog({
                  jobId: job.id,
                  jobName: job.name,
                  prId: pr.id,
                  prTitle: pr.title,
                  prUrl: pr.htmlUrl,
                  repository: `${repo.projectOrWorkspace}/${repo.slug}`,
                  author: pr.author.username,
                  sourceBranch: pr.sourceBranch.name,
                  targetBranch: pr.targetBranch.name,
                  status: 'FAILED',
                  reason: err.message,
                  dryRun: false,
                  durationMs: Date.now() - evalStart,
                });

                this.events.broadcast('error', {
                  jobId: job.id,
                  prId: pr.id,
                  error: err.message,
                });
              }
            }
          } else if (evaluation.isAlreadyApproved || isCachedApproved) {
            if (!isCachedApproved) {
              this.approvedCache.set(cacheKey, { approvedAt: Date.now() });
            }
            this.storage.addLog({
              jobId: job.id,
              jobName: job.name,
              prId: pr.id,
              prTitle: pr.title,
              prUrl: pr.htmlUrl,
              repository: `${repo.projectOrWorkspace}/${repo.slug}`,
              author: pr.author.username,
              sourceBranch: pr.sourceBranch.name,
              targetBranch: pr.targetBranch.name,
              status: 'ALREADY_APPROVED',
              reason: isCachedApproved
                ? 'Approval already recorded in the local idempotency cache'
                : evaluation.reasons.join('; '),
              dryRun: job.dryRun,
              durationMs: Date.now() - evalStart,
              details: {
                matchedConditions: evaluation.reasons,
                failureReason: evaluation.failureReason,
              },
            });
          } else {
            this.storage.addLog({
              jobId: job.id,
              jobName: job.name,
              prId: pr.id,
              prTitle: pr.title,
              prUrl: pr.htmlUrl,
              repository: `${repo.projectOrWorkspace}/${repo.slug}`,
              author: pr.author.username,
              sourceBranch: pr.sourceBranch.name,
              targetBranch: pr.targetBranch.name,
              status: 'SKIPPED',
              reason: evaluation.failureReason || 'Pull request did not match the configured rules',
              dryRun: job.dryRun,
              durationMs: Date.now() - evalStart,
              details: {
                matchedConditions: evaluation.reasons,
                failureReason: evaluation.failureReason,
              },
            });
          }
        }
      }

      // Update job execution timestamps
      const nowIso = new Date().toISOString();
      const nextRunIso = new Date(Date.now() + job.intervalSeconds * 1000).toISOString();
      this.storage.updateJob(job.id, {
        ...job,
      });

      // Update directly in stored jobs
      const allJobs = this.storage.getJobs();
      const jobIdx = allJobs.findIndex((j) => j.id === job.id);
      if (jobIdx !== -1) {
        allJobs[jobIdx].lastRunAt = nowIso;
        allJobs[jobIdx].nextRunAt = nextRunIso;
        this.storage.saveJobs(allJobs);
      }

      this.lastExecutionAt = nowIso;

      this.events.broadcast('job_completed', {
        jobId: job.id,
        jobName: job.name,
        scanned: scannedCount,
        approved: approvedCount,
        durationMs: Date.now() - startTime,
        timestamp: nowIso,
      });
    } finally {
      this.executingJobIds.delete(jobId);
    }
  }

  private async resolveJobRepositories(
    client: IBitbucketClient,
    job: ApprovalJob
  ): Promise<RepositoryRef[]> {
    const rawPatterns = job.rules.repositories || [];
    const directRepos: RepositoryRef[] = [];
    const wildcards: string[] = [];

    for (const pat of rawPatterns) {
      const trimmed = pat.trim();
      if (trimmed.includes('*') || trimmed.includes('?')) {
        wildcards.push(trimmed);
      } else {
        const parts = trimmed.split('/');
        if (parts.length >= 2) {
          directRepos.push({
            projectOrWorkspace: parts[0],
            slug: parts[1],
          });
        }
      }
    }

    if (wildcards.length === 0) {
      return directRepos;
    }

    // Wildcards present: discover repositories from Bitbucket
    try {
      const allRepos = await client.listRepositories();
      const matched = allRepos.filter((r) => {
        const full = `${r.projectOrWorkspace}/${r.slug}`;
        return wildcards.some((w) => matchesPattern(full, w));
      });

      const combined = [...directRepos];
      for (const m of matched) {
        if (!combined.some((c) => c.projectOrWorkspace === m.projectOrWorkspace && c.slug === m.slug)) {
          combined.push({
            projectOrWorkspace: m.projectOrWorkspace,
            slug: m.slug,
          });
        }
      }
      return combined;
    } catch {
      return directRepos;
    }
  }

  getStatus(): SchedulerStatus {
    const allJobs = this.storage.getJobs();
    const activeJobs = allJobs.filter((j) => j.enabled);
    const totalApproved = this.storage.getTotalApprovedCount();

    return {
      isRunning: this.isRunning,
      activeJobsCount: activeJobs.length,
      totalJobsCount: allJobs.length,
      lastExecutionAt: this.lastExecutionAt,
      vpnConnected: this.vpnConnected,
      bitbucketStatus: this.bitbucketStatus,
      totalApprovedCount: totalApproved,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
