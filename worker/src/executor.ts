import crypto from 'node:crypto';
import type {
  ExecutionLease,
  ExecutionResultSummary,
  PullRequest,
  RepositoryRef,
  WorkerLogEntry,
} from '@bitbucket-pr-approver/shared';
import {
  BitbucketCloudClient,
  RuleFilteringEngine,
  matchesPattern,
} from '@bitbucket-pr-approver/backend/runtime';

export interface WorkerExecutionResult {
  summary: ExecutionResultSummary;
  logs: WorkerLogEntry[];
}

export class WorkerExecutor {
  constructor(private readonly verificationMode = false) {}

  async probe(lease: ExecutionLease, token: string): Promise<void> {
    const client = new BitbucketCloudClient({ ...lease.bitbucketConfig, token });
    await client.getCurrentUser();
  }

  async execute(lease: ExecutionLease, token: string): Promise<WorkerExecutionResult> {
    if (this.verificationMode && !lease.job.dryRun) {
      throw Object.assign(new Error('Verification mode rejects live approval jobs'), {
        code: 'VERIFICATION_MODE_LIVE_JOB',
      });
    }

    const startedAt = new Date();
    if (this.verificationMode && (lease.job.rules.repositories || []).length === 0) {
      const completedAt = new Date();
      return {
        logs: [],
        summary: {
          executionId: lease.executionId,
          workerId: lease.workerId,
          jobId: lease.jobId,
          status: 'COMPLETED',
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          repositoriesScanned: 0,
          pullRequestsScanned: 0,
          matched: 0,
          approved: 0,
          skipped: 0,
          failed: 0,
          alreadyApproved: 0,
        },
      };
    }
    const client = new BitbucketCloudClient({ ...lease.bitbucketConfig, token });
    const currentUser = await client.getCurrentUser();
    const repositories = await this.resolveRepositories(client, lease);
    const logs: WorkerLogEntry[] = [];
    let sequence = lease.lastSequence;
    let pullRequestsScanned = 0;
    let matched = 0;
    let approved = 0;
    let skipped = 0;
    let failed = 0;
    let alreadyApproved = 0;

    for (const repository of repositories) {
      const pullRequests = await client.listOpenPullRequests(repository);
      for (const pullRequest of pullRequests) {
        pullRequestsScanned++;
        const evaluation = RuleFilteringEngine.evaluate(pullRequest, lease.job.rules, currentUser);
        if (evaluation.matched) matched++;

        let status: WorkerLogEntry['status'] = 'SKIPPED';
        let providerErrorCode: string | undefined;
        let failureReason = evaluation.failureReason;

        if (evaluation.isAlreadyApproved) {
          status = 'ALREADY_APPROVED';
          alreadyApproved++;
        } else if (!evaluation.wouldApprove) {
          skipped++;
        } else if (lease.job.dryRun) {
          status = 'DRY_RUN';
          approved++;
        } else {
          try {
            await client.approvePullRequest(repository, pullRequest.id);
            status = 'APPROVED';
            approved++;
          } catch (error: any) {
            status = 'FAILED';
            failed++;
            providerErrorCode = error.code || 'APPROVAL_FAILED';
            failureReason = error.message;
          }
        }

        logs.push(
          this.toLog(
            lease,
            pullRequest,
            ++sequence,
            status,
            evaluation.reasons,
            failureReason,
            providerErrorCode
          )
        );
      }
    }

    const completedAt = new Date();
    return {
      logs,
      summary: {
        executionId: lease.executionId,
        workerId: lease.workerId,
        jobId: lease.jobId,
        status: failed > 0 ? 'FAILED' : 'COMPLETED',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        repositoriesScanned: repositories.length,
        pullRequestsScanned,
        matched,
        approved,
        skipped,
        failed,
        alreadyApproved,
      },
    };
  }

  private async resolveRepositories(
    client: BitbucketCloudClient,
    lease: ExecutionLease
  ): Promise<RepositoryRef[]> {
    const direct: RepositoryRef[] = [];
    const wildcards: string[] = [];
    for (const rule of lease.job.rules.repositories || []) {
      const value = rule.trim();
      if (!value) continue;
      if (value.includes('*') || value.includes('?')) {
        wildcards.push(value);
        continue;
      }
      const separator = value.indexOf('/');
      if (separator > 0) {
        direct.push({ projectOrWorkspace: value.slice(0, separator), slug: value.slice(separator + 1) });
      }
    }

    if (wildcards.length > 0) {
      const allRepositories = await client.listRepositories();
      for (const repository of allRepositories) {
        const fullName = `${repository.projectOrWorkspace}/${repository.slug}`;
        if (
          wildcards.some((pattern) => matchesPattern(fullName, pattern)) &&
          !direct.some(
            (item) =>
              item.projectOrWorkspace === repository.projectOrWorkspace &&
              item.slug === repository.slug
          )
        ) {
          direct.push({
            projectOrWorkspace: repository.projectOrWorkspace,
            slug: repository.slug,
          });
        }
      }
    }

    return direct;
  }

  private toLog(
    lease: ExecutionLease,
    pullRequest: PullRequest,
    sequence: number,
    status: WorkerLogEntry['status'],
    matchedConditions: string[],
    failureReason?: string,
    providerErrorCode?: string
  ): WorkerLogEntry {
    return {
      id: crypto.randomUUID(),
      workerId: lease.workerId,
      executionId: lease.executionId,
      jobId: lease.jobId,
      sequence,
      status,
      timestamp: new Date().toISOString(),
      repository: `${pullRequest.repository.projectOrWorkspace}/${pullRequest.repository.slug}`,
      prId: pullRequest.id,
      prTitle: pullRequest.title,
      author: pullRequest.author.username,
      sourceBranch: pullRequest.sourceBranch.name,
      targetBranch: pullRequest.targetBranch.name,
      matchedConditions,
      failureReason,
      providerErrorCode,
      retryable: providerErrorCode === 'VPN_REQUIRED',
    };
  }
}
