import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPattern, matchesRepository } from '../engine/matcher.js';

describe('Matcher Engine', () => {
  it('matches exact strings', () => {
    assert.equal(matchesPattern('main', 'main'), true);
    assert.equal(matchesPattern('MAIN', 'main'), true); // case-insensitive by default
    assert.equal(matchesPattern('develop', 'main'), false);
  });

  it('matches single wildcard * within branch or path segment', () => {
    assert.equal(matchesPattern('feature/auth', 'feature/*'), true);
    assert.equal(matchesPattern('feature/user-profile', 'feature/*'), true);
    // single star should not cross slash
    assert.equal(matchesPattern('feature/auth/login', 'feature/*'), false);
  });

  it('matches double wildcard ** across segments', () => {
    assert.equal(matchesPattern('feature/auth/login', 'feature/**'), true);
    assert.equal(matchesPattern('feature/a/b/c/d', 'feature/**'), true);
    assert.equal(matchesPattern('bugfix/login', 'feature/**'), false);
  });

  it('matches pure regex patterns with regex: prefix', () => {
    assert.equal(matchesPattern('release/v1.0.4', 'regex:^release\\/v\\d+\\.\\d+\\.\\d+$'), true);
    assert.equal(matchesPattern('release/beta', 'regex:^release\\/v\\d+\\.\\d+\\.\\d+$'), false);
    assert.equal(matchesPattern('PROJ-1234', 'regex:^[A-Z]+-\\d+$'), true);
  });

  it('matches repository patterns with matchesRepository', () => {
    const rules = ['CORE/*', 'FRONTEND/web-app', 'INFRA/**'];

    assert.equal(matchesRepository('CORE/backend-api', rules), true);
    assert.equal(matchesRepository('CORE/auth-service', rules), true);
    assert.equal(matchesRepository('FRONTEND/web-app', rules), true);
    assert.equal(matchesRepository('FRONTEND/mobile-app', rules), false);
    assert.equal(matchesRepository('INFRA/terraform/modules', rules), true);
    assert.equal(matchesRepository('OTHER/repo', rules), false);
  });
});
