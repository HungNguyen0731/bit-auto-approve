import type { FastifyInstance } from 'fastify';
import type {
  JobFilterRules,
  MatchedPrPreview,
  PreviewRulesResponse,
  PullRequest,
  RepositoryRef,
} from '@bitbucket-pr-approver/shared';
import { createBitbucketClient } from '../bitbucket/index.js';
import { RuleFilteringEngine } from '../engine/filter.js';
import { matchesPattern } from '../engine/matcher.js';
import type { StorageService } from '../services/storage.js';

export async function registerPreviewRoutes(
  app: FastifyInstance,
  options: { storage: StorageService }
): Promise<void> {
  const { storage } = options;

  app.post<{ Body: { rules: JobFilterRules } }>('/api/prs/preview', async (req, reply) => {
    const rules = req.body?.rules;
    if (!rules) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Job filter rules are required for preview',
        },
      });
    }

    const config = storage.getConfig();
    if (!config || !config.baseUrl || !config.token) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Bitbucket is not configured yet. Please configure connection settings first.',
        },
      });
    }

    try {
      const client = createBitbucketClient(config);
      const currentUser = await client.getCurrentUser();

      // Resolve repos
      const rawRepos = rules.repositories || [];
      const targets: RepositoryRef[] = [];
      const wildcards: string[] = [];

      for (const r of rawRepos) {
        const trimmed = r.trim();
        if (trimmed.includes('*') || trimmed.includes('?')) {
          wildcards.push(trimmed);
        } else {
          const parts = trimmed.split('/');
          if (parts.length >= 2) {
            targets.push({ projectOrWorkspace: parts[0], slug: parts[1] });
          }
        }
      }

      if (wildcards.length > 0) {
        try {
          const allRepos = await client.listRepositories();
          const matched = allRepos.filter((repo) => {
            const full = `${repo.projectOrWorkspace}/${repo.slug}`;
            return wildcards.some((w) => matchesPattern(full, w));
          });
          for (const m of matched) {
            if (!targets.some((t) => t.projectOrWorkspace === m.projectOrWorkspace && t.slug === m.slug)) {
              targets.push({ projectOrWorkspace: m.projectOrWorkspace, slug: m.slug });
            }
          }
        } catch {
          // Continue with targets resolved so far
        }
      }

      const results: MatchedPrPreview[] = [];
      let totalScanned = 0;
      let totalMatched = 0;

      for (const target of targets) {
        let openPrs: PullRequest[] = [];
        try {
          openPrs = await client.listOpenPullRequests(target);
        } catch {
          continue;
        }

        for (const pr of openPrs) {
          totalScanned++;
          const evaluation = RuleFilteringEngine.evaluate(pr, rules, currentUser);
          if (evaluation.matched) {
            totalMatched++;
          }
          results.push({
            pr,
            matched: evaluation.matched,
            reasons: evaluation.reasons,
            failureReason: evaluation.failureReason,
            wouldApprove: evaluation.wouldApprove,
          });
        }
      }

      const responseData: PreviewRulesResponse = {
        totalScanned,
        totalMatched,
        results,
      };

      return reply.send({
        success: true,
        data: responseData,
      });
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({
        success: false,
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          details: err.details,
        },
      });
    }
  });
}
