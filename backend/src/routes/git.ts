import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  GitBranchCreatePayload,
  GitBranchSwitchPayload,
  GitCommitPayload,
  GitDiscardPayload,
  GitFetchPayload,
  GitMergePayload,
  GitOpenPayload,
  GitPullPayload,
  GitPushPayload,
  GitScanReposRequest,
  GitStagePayload,
  GitStashPopPayload,
  GitStashPushPayload,
  GitUnstagePayload,
} from '@bitbucket-pr-approver/shared';
import { GitService } from '../services/git.js';

export async function registerGitRoutes(
  app: FastifyInstance,
  options: { gitService?: GitService } = {}
): Promise<void> {
  const gitService = options.gitService || new GitService();

  // Helper to validate and return repoPath
  const requireRepoPath = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const query = req.query as Record<string, any> | undefined;
    const body = req.body as Record<string, any> | undefined;
    const repoPath = (query?.repoPath || body?.repoPath)?.toString()?.trim();

    if (!repoPath) {
      reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required "repoPath" parameter',
        },
      });
      return null;
    }
    return repoPath;
  };

  /**
   * POST /api/git/scan
   * Discover git repositories recursively under rootPath
   */
  app.post<{ Body: GitScanReposRequest }>('/api/git/scan', async (req, reply) => {
    const rootPath = req.body?.rootPath?.trim();
    if (!rootPath) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing "rootPath" in request body',
        },
      });
    }

    try {
      const maxDepth = typeof req.body.maxDepth === 'number' ? req.body.maxDepth : 4;
      const result = await gitService.scanRepositories(rootPath, maxDepth);
      return reply.send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'SCAN_FAILED',
          message: err.message || 'Failed to scan repositories',
        },
      });
    }
  });

  /**
   * GET /api/git/repositories
   * Query-based discovery of repositories
   */
  app.get<{ Querystring: { rootPath: string; maxDepth?: string } }>(
    '/api/git/repositories',
    async (req, reply) => {
      const rootPath = req.query?.rootPath?.trim();
      if (!rootPath) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing "rootPath" query parameter',
          },
        });
      }

      try {
        const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth, 10) : 4;
        const result = await gitService.scanRepositories(rootPath, maxDepth);
        return reply.send({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'SCAN_FAILED',
            message: err.message || 'Failed to scan repositories',
          },
        });
      }
    }
  );

  /**
   * GET /api/git/status
   * Working tree status: staged, unstaged, untracked, ahead/behind
   */
  app.get<{ Querystring: { repoPath: string } }>('/api/git/status', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const status = await gitService.getWorkingTreeStatus(repoPath);
      return reply.send({
        success: true,
        data: status,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'STATUS_FAILED',
          message: err.message || 'Failed to get git status',
        },
      });
    }
  });

  /**
   * GET /api/git/commits
   * Commit DAG history extractor with topological parents, author, and branch/tag refs
   */
  app.get<{
    Querystring: { repoPath: string; limit?: string; branch?: string; skip?: string };
  }>('/api/git/commits', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const skip = req.query.skip ? parseInt(req.query.skip, 10) : 0;
      const branch = req.query.branch?.trim() || undefined;

      const commits = await gitService.getCommitHistory(repoPath, { limit, skip, branch });
      return reply.send({
        success: true,
        data: commits,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'COMMITS_FAILED',
          message: err.message || 'Failed to retrieve commit history',
        },
      });
    }
  });

  /**
   * GET /api/git/diff
   * Working tree or commit diff with structured hunks and lines
   */
  app.get<{
    Querystring: {
      repoPath: string;
      path?: string;
      staged?: string;
      commitHash?: string;
      compareCommitHash?: string;
    };
  }>('/api/git/diff', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const filePath = req.query.path?.trim() || undefined;
      const staged = req.query.staged === 'true' || req.query.staged === '1';
      const commitHash = req.query.commitHash?.trim() || undefined;
      const compareCommitHash = req.query.compareCommitHash?.trim() || undefined;

      const diff = await gitService.getDiff(repoPath, {
        path: filePath,
        staged,
        commitHash,
        compareCommitHash,
      });
      return reply.send({
        success: true,
        data: diff,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'DIFF_FAILED',
          message: err.message || 'Failed to get git diff',
        },
      });
    }
  });

  /**
   * GET /api/git/branches
   * List all local and remote branches
   */
  app.get<{ Querystring: { repoPath: string } }>('/api/git/branches', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const branches = await gitService.getBranches(repoPath);
      return reply.send({
        success: true,
        data: branches,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BRANCHES_FAILED',
          message: err.message || 'Failed to get git branches',
        },
      });
    }
  });

  app.get<{ Querystring: { repoPath: string } }>('/api/git/remotes', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;
    try {
      return reply.send({ success: true, data: await gitService.getRemotes(repoPath) });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: { code: 'REMOTES_FAILED', message: err.message || 'Failed to get remotes' } });
    }
  });

  app.get<{ Querystring: { repoPath: string } }>('/api/git/remote-web-url', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;
    try {
      return reply.send({ success: true, data: await gitService.getRemoteWebUrl(repoPath) });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: { code: 'REMOTE_WEB_URL_FAILED', message: err.message || 'Failed to get remote web URL' } });
    }
  });

  app.post<{ Body: GitMergePayload }>('/api/git/merge', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;
    const body = req.body;
    if (typeof body?.branch !== 'string' || !body.branch.trim() || body.branch.trim().startsWith('-') ||
        (body.noFf !== undefined && typeof body.noFf !== 'boolean') ||
        (body.message !== undefined && typeof body.message !== 'string')) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid branch, optional boolean noFf and string message are required' } });
    }
    try {
      const data = await gitService.merge(repoPath, { branch: body.branch, noFf: body.noFf, message: body.message });
      return reply.send({ success: true, data });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: { code: 'MERGE_FAILED', message: err.message || 'Failed to merge branch' } });
    }
  });

  for (const action of ['open-in-finder', 'open-terminal'] as const) {
    app.post<{ Body: GitOpenPayload }>(`/api/git/${action}`, async (req, reply) => {
      const repoPath = requireRepoPath(req, reply);
      if (!repoPath) return;
      try {
        const data = action === 'open-terminal' ? await gitService.openTerminal(repoPath) : await gitService.openInFinder(repoPath);
        return reply.send({ success: true, data });
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: {
          code: action === 'open-terminal' ? 'OPEN_TERMINAL_FAILED' : 'OPEN_FINDER_FAILED',
          message: err.message || 'Failed to open repository',
        } });
      }
    });
  }

  /**
   * POST /api/git/branches/create
   * Create a new branch
   */
  app.post<{ Body: GitBranchCreatePayload }>('/api/git/branches/create', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    const branchName = req.body?.branchName?.trim();
    if (!branchName) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing "branchName" in request body',
        },
      });
    }

    try {
      const res = await gitService.createBranch(
        repoPath,
        branchName,
        req.body.startPoint,
        req.body.checkout
      );
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BRANCH_CREATE_FAILED',
          message: err.message || 'Failed to create branch',
        },
      });
    }
  });

  /**
   * POST /api/git/branches/switch
   * Switch/checkout branch
   */
  app.post<{ Body: GitBranchSwitchPayload }>('/api/git/branches/switch', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    const branchName = req.body?.branchName?.trim();
    if (!branchName) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing "branchName" in request body',
        },
      });
    }

    try {
      const res = await gitService.switchBranch(repoPath, branchName, req.body.createNew);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BRANCH_SWITCH_FAILED',
          message: err.message || 'Failed to switch branch',
        },
      });
    }
  });

  /**
   * POST /api/git/stage
   * Stage files or all
   */
  app.post<{ Body: GitStagePayload }>('/api/git/stage', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.stage(repoPath, req.body.paths, req.body.all);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'STAGE_FAILED',
          message: err.message || 'Failed to stage files',
        },
      });
    }
  });

  /**
   * POST /api/git/unstage
   * Unstage files or all
   */
  app.post<{ Body: GitUnstagePayload }>('/api/git/unstage', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.unstage(repoPath, req.body.paths, req.body.all);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'UNSTAGE_FAILED',
          message: err.message || 'Failed to unstage files',
        },
      });
    }
  });

  /**
   * POST /api/git/discard
   * Discard modifications on files or all
   */
  app.post<{ Body: GitDiscardPayload }>('/api/git/discard', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.discard(repoPath, req.body.paths, req.body.all);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'DISCARD_FAILED',
          message: err.message || 'Failed to discard changes',
        },
      });
    }
  });

  /**
   * POST /api/git/commit
   * Commit staged changes
   */
  app.post<{ Body: GitCommitPayload }>('/api/git/commit', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    const message = req.body?.message?.trim();
    if (!message) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Commit message is required',
        },
      });
    }

    try {
      const res = await gitService.commit(repoPath, message, req.body.amend);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'COMMIT_FAILED',
          message: err.message || 'Failed to commit changes',
        },
      });
    }
  });

  /**
   * GET /api/git/stash
   * List stashes
   */
  app.get<{ Querystring: { repoPath: string } }>('/api/git/stash', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const stashes = await gitService.getStashes(repoPath);
      return reply.send({
        success: true,
        data: stashes,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'STASH_FAILED',
          message: err.message || 'Failed to get stashes',
        },
      });
    }
  });

  /**
   * POST /api/git/stash/push
   * Stash changes
   */
  app.post<{ Body: GitStashPushPayload }>('/api/git/stash/push', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.stashPush(
        repoPath,
        req.body.message,
        req.body.includeUntracked
      );
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'STASH_PUSH_FAILED',
          message: err.message || 'Failed to push stash',
        },
      });
    }
  });

  /**
   * POST /api/git/stash/pop
   * Pop stash
   */
  app.post<{ Body: GitStashPopPayload }>('/api/git/stash/pop', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.stashPop(repoPath, req.body.index);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'STASH_POP_FAILED',
          message: err.message || 'Failed to pop stash',
        },
      });
    }
  });

  /**
   * POST /api/git/fetch
   * Fetch from remote
   */
  app.post<{ Body: GitFetchPayload }>('/api/git/fetch', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.fetch(repoPath, req.body.remote, req.body.prune);
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: err.message || 'Failed to fetch from remote',
        },
      });
    }
  });

  /**
   * POST /api/git/pull
   * Pull from remote
   */
  app.post<{ Body: GitPullPayload }>('/api/git/pull', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.pull(
        repoPath,
        req.body.remote,
        req.body.branch,
        req.body.rebase
      );
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'PULL_FAILED',
          message: err.message || 'Failed to pull from remote',
        },
      });
    }
  });

  /**
   * POST /api/git/push
   * Push to remote
   */
  app.post<{ Body: GitPushPayload }>('/api/git/push', async (req, reply) => {
    const repoPath = requireRepoPath(req, reply);
    if (!repoPath) return;

    try {
      const res = await gitService.push(
        repoPath,
        req.body.remote,
        req.body.branch,
        req.body.setUpstream,
        req.body.force
      );
      return reply.send({
        success: true,
        data: res,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'PUSH_FAILED',
          message: err.message || 'Failed to push to remote',
        },
      });
    }
  });
}
