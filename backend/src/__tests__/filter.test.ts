import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BitbucketUserProfile, JobFilterRules, PullRequest } from '@bitbucket-pr-approver/shared';
import { RuleFilteringEngine } from '../engine/filter.js';

function createMockPr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 101,
    title: 'feat(core): add cache layer',
    state: 'OPEN',
    author: {
      username: 'developer-alex',
      displayName: 'Alex Developer',
    },
    repository: {
      projectOrWorkspace: 'CORE',
      slug: 'backend-api',
    },
    sourceBranch: {
      name: 'feature/cache-layer',
      refId: 'refs/heads/feature/cache-layer',
    },
    targetBranch: {
      name: 'develop',
      refId: 'refs/heads/develop',
    },
    reviewers: [],
    isDraft: false,
    hasConflicts: false,
    createdDate: new Date().toISOString(),
    updatedDate: new Date().toISOString(),
    htmlUrl: 'https://bitbucket.internal/projects/CORE/repos/backend-api/pull-requests/101',
    ...overrides,
  };
}

const mockCurrentUser: BitbucketUserProfile = {
  username: 'hungnv',
  displayName: 'Nguyen Van Hung',
  serverType: 'server',
  isAvailable: true,
  vpnConnected: true,
  verifiedAt: new Date().toISOString(),
};

const baseRules: JobFilterRules = {
  repositories: ['CORE/*'],
  authorWhitelist: ['developer-alex', 'sarahc'],
  authorBlacklist: ['banned-dev'],
  excludeSelf: true,
  targetBranches: ['develop', 'release/*'],
  sourceBranches: ['feature/*', 'bugfix/*'],
  ignoreDrafts: true,
  ignoreWithConflicts: true,
};

describe('Rule Filtering Engine', () => {
  it('passes valid PR meeting all criteria', () => {
    const pr = createMockPr();
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, true);
    assert.equal(res.wouldApprove, true);
    assert.equal(res.isAlreadyApproved, false);
    assert.ok(res.reasons.length >= 3);
  });

  it('rejects self-authored PR when excludeSelf is true', () => {
    const pr = createMockPr({
      author: { username: 'hungnv', displayName: 'Nguyen Van Hung' },
    });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.equal(res.wouldApprove, false);
    assert.match(res.failureReason || '', /self-exclusion/);
  });

  it('rejects author not in whitelist', () => {
    const pr = createMockPr({
      author: { username: 'stranger', displayName: 'Stranger' },
    });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.equal(res.wouldApprove, false);
    assert.match(res.failureReason || '', /not in author whitelist/);
  });

  it('rejects author in blacklist even if matching wildcard', () => {
    const rulesWithWildcard: JobFilterRules = {
      ...baseRules,
      authorWhitelist: ['*'],
      authorBlacklist: ['banned-dev'],
    };
    const pr = createMockPr({
      author: { username: 'banned-dev', displayName: 'Banned Dev' },
    });
    const res = RuleFilteringEngine.evaluate(pr, rulesWithWildcard, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.match(res.failureReason || '', /in the blacklist/);
  });

  it('rejects non-matching target branch', () => {
    const pr = createMockPr({
      targetBranch: { name: 'unapproved-branch', refId: 'refs/heads/unapproved-branch' },
    });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.match(res.failureReason || '', /target branches/);
  });

  it('rejects non-matching source branch', () => {
    const pr = createMockPr({
      sourceBranch: { name: 'experiment/crazy-idea', refId: 'refs/heads/experiment/crazy-idea' },
    });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.match(res.failureReason || '', /source branches/);
  });

  it('rejects draft PRs when ignoreDrafts is true', () => {
    const pr = createMockPr({ isDraft: true });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.match(res.failureReason || '', /draft/);
  });

  it('rejects PRs with merge conflicts when ignoreWithConflicts is true', () => {
    const pr = createMockPr({ hasConflicts: true });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, false);
    assert.match(res.failureReason || '', /conflicts/);
  });

  it('checks title include and exclude keywords', () => {
    const rulesWithTitle: JobFilterRules = {
      ...baseRules,
      titleKeywordsInclude: ['[AUTO]', 'JIRA-'],
      titleKeywordsExclude: ['[DO NOT MERGE]', '[WIP]'],
    };

    // Missing required keyword
    const pr1 = createMockPr({ title: 'just a normal title' });
    const res1 = RuleFilteringEngine.evaluate(pr1, rulesWithTitle, mockCurrentUser);
    assert.equal(res1.matched, false);
    assert.match(res1.failureReason || '', /required keywords/);

    // Has required keyword
    const pr2 = createMockPr({ title: 'feat: JIRA-1234 add feature' });
    const res2 = RuleFilteringEngine.evaluate(pr2, rulesWithTitle, mockCurrentUser);
    assert.equal(res2.matched, true);

    // Has excluded keyword
    const pr3 = createMockPr({ title: 'feat: JIRA-1234 [DO NOT MERGE] test' });
    const res3 = RuleFilteringEngine.evaluate(pr3, rulesWithTitle, mockCurrentUser);
    assert.equal(res3.matched, false);
    assert.match(res3.failureReason || '', /excluded keyword/);
  });

  it('detects already approved PR by current user', () => {
    const pr = createMockPr({
      reviewers: [
        {
          user: { username: 'hungnv', displayName: 'Nguyen Van Hung' },
          status: 'APPROVED',
          isApproved: true,
        },
      ],
    });
    const res = RuleFilteringEngine.evaluate(pr, baseRules, mockCurrentUser);

    assert.equal(res.matched, true);
    assert.equal(res.isAlreadyApproved, true);
    assert.equal(res.wouldApprove, false);
  });
});
