import type {
  BitbucketUserProfile,
  JobFilterRules,
  PullRequest,
} from '@bitbucket-pr-approver/shared';
import { matchesPattern, matchesRepository } from './matcher.js';

export interface RuleEvaluationResult {
  matched: boolean;
  wouldApprove: boolean;
  isAlreadyApproved: boolean;
  reasons: string[];
  failureReason?: string;
}

export class RuleFilteringEngine {
  /**
   * Evaluate a Pull Request against Job Filter Rules
   */
  static evaluate(
    pr: PullRequest,
    rules: JobFilterRules,
    currentUser?: BitbucketUserProfile
  ): RuleEvaluationResult {
    const reasons: string[] = [];

    // 1. Repository Match Check (if repository rules are specified)
    if (rules.repositories && rules.repositories.length > 0) {
      const repoRef = `${pr.repository.projectOrWorkspace}/${pr.repository.slug}`;
      const repoMatched = matchesRepository(repoRef, rules.repositories);
      if (!repoMatched) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Repository '${repoRef}' does not match repository patterns [${rules.repositories.join(', ')}]`,
        };
      }
      reasons.push(`Matched repository pattern '${repoRef}'`);
    }

    // 2. Self-Exclusion Check
    if (rules.excludeSelf && currentUser?.username) {
      const authorUser = (pr.author?.username || '').trim().toLowerCase();
      const currentLogin = (currentUser.username || '').trim().toLowerCase();
      if (authorUser && currentLogin && authorUser === currentLogin) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Author '${pr.author.username}' is the current user (self-exclusion enabled)`,
        };
      }
    }

    // 3. Author Blacklist Check
    if (rules.authorBlacklist && rules.authorBlacklist.length > 0) {
      const author = pr.author?.username || '';
      const isBlacklisted = rules.authorBlacklist.some((b) =>
        matchesPattern(author, b) || matchesPattern(pr.author?.displayName || '', b)
      );
      if (isBlacklisted) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Author '${author}' is in the blacklist`,
        };
      }
    }

    // 4. Author Whitelist Check
    if (rules.authorWhitelist && rules.authorWhitelist.length > 0) {
      const author = pr.author?.username || '';
      const isWhitelisted = rules.authorWhitelist.some((w) =>
        matchesPattern(author, w) || matchesPattern(pr.author?.displayName || '', w)
      );
      if (!isWhitelisted) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Author '${author}' is not in author whitelist`,
        };
      }
      reasons.push(`Matched author '${author}' in whitelist`);
    }

    // 5. Target Branch Check
    if (rules.targetBranches && rules.targetBranches.length > 0) {
      const target = pr.targetBranch?.name || '';
      const targetMatched = rules.targetBranches.some((tb) => matchesPattern(target, tb));
      if (!targetMatched) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Target branch '${target}' does not match target branches [${rules.targetBranches.join(', ')}]`,
        };
      }
      reasons.push(`Matched target branch '${target}'`);
    }

    // 6. Source Branch Check (optional)
    if (rules.sourceBranches && rules.sourceBranches.length > 0) {
      const source = pr.sourceBranch?.name || '';
      const sourceMatched = rules.sourceBranches.some((sb) => matchesPattern(source, sb));
      if (!sourceMatched) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Source branch '${source}' does not match source branches [${rules.sourceBranches.join(', ')}]`,
        };
      }
      reasons.push(`Matched source branch '${source}'`);
    }

    // 7. Draft PR Check
    if (rules.ignoreDrafts && pr.isDraft) {
      return {
        matched: false,
        wouldApprove: false,
        isAlreadyApproved: false,
        reasons,
        failureReason: 'PR is marked as draft or work-in-progress',
      };
    }

    // 8. Merge Conflicts Check
    if (rules.ignoreWithConflicts && pr.hasConflicts) {
      return {
        matched: false,
        wouldApprove: false,
        isAlreadyApproved: false,
        reasons,
        failureReason: 'PR has unresolved merge conflicts',
      };
    }

    // 9. Title Keywords Include Check (optional)
    if (rules.titleKeywordsInclude && rules.titleKeywordsInclude.length > 0) {
      const titleLower = (pr.title || '').toLowerCase();
      const hasRequiredKeyword = rules.titleKeywordsInclude.some((kw) =>
        titleLower.includes(kw.trim().toLowerCase())
      );
      if (!hasRequiredKeyword) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Title does not contain any of required keywords [${rules.titleKeywordsInclude.join(', ')}]`,
        };
      }
      reasons.push('Title contains required keyword');
    }

    // 10. Title Keywords Exclude Check (optional)
    if (rules.titleKeywordsExclude && rules.titleKeywordsExclude.length > 0) {
      const titleLower = (pr.title || '').toLowerCase();
      const excludedMatched = rules.titleKeywordsExclude.find((kw) =>
        titleLower.includes(kw.trim().toLowerCase())
      );
      if (excludedMatched) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `Title contains excluded keyword '${excludedMatched}'`,
        };
      }
    }

    // 11. Minimum Approvals Needed Check (optional)
    if (rules.minApprovalsNeeded && rules.minApprovalsNeeded > 0) {
      const otherApprovals = (pr.reviewers || []).filter(
        (rev) =>
          rev.isApproved &&
          rev.user?.username?.toLowerCase() !== currentUser?.username?.toLowerCase()
      ).length;
      if (otherApprovals < rules.minApprovalsNeeded) {
        return {
          matched: false,
          wouldApprove: false,
          isAlreadyApproved: false,
          reasons,
          failureReason: `PR has ${otherApprovals} existing approval(s), but requires at least ${rules.minApprovalsNeeded}`,
        };
      }
      reasons.push(`Has ${otherApprovals} approvals (threshold: ${rules.minApprovalsNeeded})`);
    }

    // 12. Check if current user has already approved
    let isAlreadyApproved = false;
    if (currentUser?.username) {
      const currentLogin = currentUser.username.trim().toLowerCase();
      isAlreadyApproved = (pr.reviewers || []).some(
        (rev) => rev.isApproved && rev.user?.username?.trim().toLowerCase() === currentLogin
      );
    }

    if (isAlreadyApproved) {
      reasons.push('PR is already approved by current user');
      return {
        matched: true,
        wouldApprove: false,
        isAlreadyApproved: true,
        reasons,
      };
    }

    reasons.push('All filter criteria passed successfully');
    return {
      matched: true,
      wouldApprove: true,
      isAlreadyApproved: false,
      reasons,
    };
  }
}
