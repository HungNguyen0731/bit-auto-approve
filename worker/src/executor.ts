import crypto from 'node:crypto';
import type {
  ExecutionLease,
  ExecutionResultSummary,
  PullRequest,
  BitbucketUserProfile,
  WorkerLogEntry,
} from '@bitbucket-pr-approver/shared';
import {
  BitbucketCloudClient,
  RuleFilteringEngine,
  matchesPattern,
  matchesRepository,
} from '@bitbucket-pr-approver/backend/runtime';

export interface WorkerExecutionResult {
  summary: ExecutionResultSummary;
  logs: WorkerLogEntry[];
}

// Space Bitbucket calls across scans, CI checks, approvals, and merge revalidation.
// The queue is process-wide in BitbucketCloudClient, so consecutive jobs on
// this Worker do not start a fresh burst.
const BITBUCKET_REQUEST_INTERVAL_MS = 1_000;

export class WorkerExecutor {
  constructor(private readonly verificationMode = false) {}

  private buildBitbucketConfig(lease: ExecutionLease, token: string) {
    let cookie = lease.bitbucketConfig.cookie;
    let csrfToken = lease.bitbucketConfig.csrfToken;
    let authType = lease.bitbucketConfig.authType || 'session';

    try {
      const parsed = JSON.parse(token);
      if (typeof parsed === 'object' && parsed !== null) {
        cookie = cookie || parsed.cookie;
        csrfToken = csrfToken || parsed.csrfToken;
        authType = 'session';
      }
    } catch {
      // Not JSON, pass as is
    }

    if (cookie || csrfToken) {
      authType = 'session';
    }

    return {
      ...lease.bitbucketConfig,
      authType,
      token,
      cookie,
      csrfToken,
    };
  }

  async probe(lease: ExecutionLease, token: string): Promise<void> {
    const config = this.buildBitbucketConfig(lease, token);
    const client = new BitbucketCloudClient(config, BITBUCKET_REQUEST_INTERVAL_MS);
    await client.getCurrentUser();
  }

  async execute(
    lease: ExecutionLease,
    token: string,
    onProgress?: (entry: WorkerLogEntry) => Promise<void> | void
  ): Promise<WorkerExecutionResult> {
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
    const config = this.buildBitbucketConfig(lease, token);
    const client = new BitbucketCloudClient(config, BITBUCKET_REQUEST_INTERVAL_MS);
    const currentUser = await client.getCurrentUser();
    const workspaces = this.resolveWorkspaces(currentUser, lease);
    const logs: WorkerLogEntry[] = [];
    let sequence = lease.lastSequence;
    let pullRequestsScanned = 0;
    let matched = 0;
    let approved = 0;
    let merged = 0;
    let wouldApprove = 0;
    let skipped = 0;
    let failed = 0;
    let alreadyApproved = 0;
    const repositoriesSeen = new Set<string>();
    let rateLimitReason: string | undefined;
    let rateLimitRetryAfterSeconds: number | undefined;

    for (const workspace of workspaces) {
      const scanLog: WorkerLogEntry = {
        id: crypto.randomUUID(),
        workerId: lease.workerId,
        executionId: lease.executionId,
        jobId: lease.jobId,
        sequence: ++sequence,
        status: 'SCANNING_REPO',
        flowStep: 'SCAN_REPO',
        timestamp: new Date().toISOString(),
        repository: workspace,
        matchedConditions: [`Loading open pull requests in workspace ${workspace}`],
      };
      logs.push(scanLog);
      if (onProgress) await onProgress(scanLog);

      let pullRequests: PullRequest[];
      try {
        pullRequests = await client.listWorkspaceOpenPullRequests(workspace, currentUser.uuid);
      } catch (error: any) {
        if (error.code !== 'RATE_LIMITED') throw error;
        rateLimitReason = error.message;
        rateLimitRetryAfterSeconds = error.details?.rateLimitReset;
        failed++;
        break;
      }
      for (const pullRequest of pullRequests) {
        const repository = pullRequest.repository;
        const repoFullName = `${repository.projectOrWorkspace}/${repository.slug}`;
        if (!matchesRepository(repoFullName, lease.job.rules.repositories || [])) continue;
        repositoriesSeen.add(repoFullName);
        pullRequestsScanned++;
        const evaluation = RuleFilteringEngine.evaluate(pullRequest, lease.job.rules, currentUser);
        if (evaluation.matched) matched++;

        let status: WorkerLogEntry['status'] = 'SKIPPED';
        let flowStep: import('@bitbucket-pr-approver/shared').FlowStep = 'MATCH_PR';
        let providerErrorCode: string | undefined;
        let failureReason = evaluation.failureReason;

        if (!evaluation.matched) {
          skipped++;
          flowStep = 'MATCH_PR';
        } else if (lease.job.dryRun) {
          status = evaluation.isAlreadyApproved ? 'ALREADY_APPROVED' : 'DRY_RUN';
          flowStep = 'APPROVE';
          if (evaluation.isAlreadyApproved) alreadyApproved++;
          else wouldApprove++;
        } else {
          // Emit MATCH_PR event
          const matchLog = this.toLog(
            lease,
            pullRequest,
            ++sequence,
            'MATCHING_PR',
            evaluation.reasons,
            undefined,
            undefined,
            'MATCH_PR'
          );
          logs.push(matchLog);
          if (onProgress) await onProgress(matchLog);

          try {
            const commitHash = pullRequest.sourceBranch.commitHash;
            // Emit CHECKING_CI event
            const checkingCiLog = this.toLog(
              lease,
              pullRequest,
              ++sequence,
              'CHECKING_CI',
              [`Checking CI build status for commit ${commitHash ? commitHash.slice(0, 10) : 'unknown'}`],
              undefined,
              undefined,
              'CHECK_CI'
            );
            logs.push(checkingCiLog);
            if (onProgress) await onProgress(checkingCiLog);

            const build = commitHash
              ? await client.getCommitBuildStatus(repository, commitHash) : 'PENDING';
            if (build !== 'SUCCESSFUL') {
              status = 'SKIPPED';
              flowStep = 'CHECK_CI';
              skipped++;
              failureReason = `Source commit CI is ${build.toLowerCase()}; approval and merge require success`;
            } else if (evaluation.isAlreadyApproved) {
              status = 'ALREADY_APPROVED';
              flowStep = 'APPROVE';
              alreadyApproved++;
            } else {
              await client.approvePullRequest(repository, pullRequest.id);
              status = 'APPROVED';
              flowStep = 'APPROVE';
              approved++;

              const approveLog = this.toLog(
                lease,
                pullRequest,
                ++sequence,
                'APPROVED',
                [`Approved pull request #${pullRequest.id}`],
                undefined,
                undefined,
                'APPROVE'
              );
              logs.push(approveLog);
              if (onProgress) await onProgress(approveLog);
            }

            if (lease.job.autoMergeOnSuccessfulBuild && build === 'SUCCESSFUL') {
              const mergeBranches = lease.job.rules.mergeTargetBranches || [];
              if (!mergeBranches.some((branch) => matchesPattern(pullRequest.targetBranch.name, branch))) {
                failureReason = `Merge not allowed for target branch '${pullRequest.targetBranch.name}'`;
              } else {
                const fresh = await client.getPullRequest(repository, pullRequest.id);
                const freshEvaluation = RuleFilteringEngine.evaluate(fresh, lease.job.rules, currentUser);
                if (fresh.state !== 'OPEN' || fresh.sourceBranch.commitHash !== commitHash ||
                    !freshEvaluation.matched || !freshEvaluation.isAlreadyApproved ||
                    !mergeBranches.some((branch) => matchesPattern(fresh.targetBranch.name, branch))) {
                  failureReason = 'Merge deferred: PR, source commit, rules, or Bitbucket approval changed after the scan';
                } else {
                  // Duplicate CI re-check removed: commitHash is validated identical and CI build was already confirmed SUCCESSFUL
                  await client.mergePullRequest(repository, pullRequest.id);
                  status = 'MERGED';
                  flowStep = 'MERGE';
                  merged++;
                  failureReason = undefined;
                }
              }
            }
          } catch (error: any) {
            status = 'FAILED';
            failed++;
            providerErrorCode = error.code || 'APPROVAL_OR_MERGE_FAILED';
            failureReason = error.message;
            if (providerErrorCode === 'RATE_LIMITED') {
              rateLimitReason = error.message;
              rateLimitRetryAfterSeconds = error.details?.rateLimitReset;
            }
          }
        }

        const terminalLog = this.toLog(
          lease,
          pullRequest,
          ++sequence,
          status,
          evaluation.reasons,
          failureReason,
          providerErrorCode,
          flowStep
        );
        logs.push(terminalLog);
        if (onProgress) await onProgress(terminalLog);
        if (rateLimitReason) break;
      }
      if (rateLimitReason) break;
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
        repositoriesScanned: repositoriesSeen.size,
        pullRequestsScanned,
        matched,
        approved,
        merged,
        wouldApprove,
        skipped,
        failed,
        alreadyApproved,
        failureReason: rateLimitReason,
        failureCode: rateLimitReason ? 'RATE_LIMITED' : undefined,
        rateLimitRetryAfterSeconds,
      },
    };
  }

  private resolveWorkspaces(currentUser: BitbucketUserProfile, lease: ExecutionLease): string[] {
    const rules = lease.job.rules.repositories || [];
    const available = currentUser.workspaces?.map((workspace) => workspace.slug) || [];
    const workspaces = new Set<string>();
    for (const rule of rules) {
      const separator = rule.indexOf('/');
      if (separator < 1) continue;
      const pattern = rule.slice(0, separator).trim();
      if (!pattern) continue;
      if (!pattern.includes('*') && !pattern.includes('?') && !pattern.startsWith('regex:')) {
        workspaces.add(pattern);
      } else {
        for (const workspace of available) {
          if (matchesPattern(workspace, pattern)) workspaces.add(workspace);
        }
      }
    }
    return [...workspaces];
  }

  private toLog(
    lease: ExecutionLease,
    pullRequest: PullRequest,
    sequence: number,
    status: WorkerLogEntry['status'],
    matchedConditions: string[],
    failureReason?: string,
    providerErrorCode?: string,
    flowStep?: import('@bitbucket-pr-approver/shared').FlowStep
  ): WorkerLogEntry {
    return {
      id: crypto.randomUUID(),
      workerId: lease.workerId,
      executionId: lease.executionId,
      jobId: lease.jobId,
      sequence,
      status,
      flowStep,
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
