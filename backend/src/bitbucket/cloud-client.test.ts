import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { BitbucketCloudClient } from './cloud-client.js';
import type { RepositoryRef, BitbucketConnectionConfig } from '@bitbucket-pr-approver/shared';

describe('BitbucketCloudClient HTTP method and endpoint tests', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: any;
  const dummyRepo: RepositoryRef = {
    projectOrWorkspace: 'my-workspace',
    slug: 'my-repo',
  };

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  describe('Standard REST API (authType: bearer)', () => {
    const tokenConfig: BitbucketConnectionConfig = {
      serverType: 'cloud',
      baseUrl: 'https://api.bitbucket.org/2.0',
      authType: 'bearer',
      token: 'fake-token',
    };

    it('approvePullRequest sends POST to /2.0/repositories/{ws}/{slug}/pullrequests/{id}/approve', async () => {
      const client = new BitbucketCloudClient(tokenConfig);
      let interceptedMethod = '';
      let interceptedHeaders: Record<string, string> = {};

      const pool = mockAgent.get('https://api.bitbucket.org');
      pool.intercept({
        path: '/2.0/repositories/my-workspace/my-repo/pullrequests/123/approve',
        method: 'POST',
      }).reply(200, (opts) => {
        interceptedMethod = opts.method;
        interceptedHeaders = opts.headers as Record<string, string>;
        return { status: 'APPROVED' };
      }, {
        headers: { 'content-type': 'application/json' },
      });

      const res = await client.approvePullRequest(dummyRepo, 123);
      assert.equal(res.success, true);
      assert.equal(interceptedMethod, 'POST');
      const authHeader = interceptedHeaders.Authorization || interceptedHeaders.authorization;
      assert.equal(authHeader, 'Bearer fake-token');
    });

    it('mergePullRequest sends POST to /2.0/repositories/{ws}/{slug}/pullrequests/{id}/merge', async () => {
      const client = new BitbucketCloudClient(tokenConfig);
      let interceptedMethod = '';
      let interceptedBody = '';

      const pool = mockAgent.get('https://api.bitbucket.org');
      pool.intercept({
        path: '/2.0/repositories/my-workspace/my-repo/pullrequests/123/merge',
        method: 'POST',
      }).reply(200, (opts) => {
        interceptedMethod = opts.method;
        interceptedBody = opts.body as string;
        return { state: 'MERGED' };
      }, {
        headers: { 'content-type': 'application/json' },
      });

      await client.mergePullRequest(dummyRepo, 123);
      assert.equal(interceptedMethod, 'POST');
      const body = JSON.parse(interceptedBody);
      assert.equal(body.close_source_branch, false);
    });

    it('getCommitBuildStatus queries /statuses endpoint (not /statuses/build) via GET', async () => {
      const client = new BitbucketCloudClient(tokenConfig);
      let interceptedMethod = '';
      let interceptedPath = '';

      const pool = mockAgent.get('https://api.bitbucket.org');
      pool.intercept({
        path: '/2.0/repositories/my-workspace/my-repo/commit/abcdef1234567/statuses?pagelen=100',
        method: 'GET',
      }).reply(200, (opts) => {
        interceptedMethod = opts.method;
        interceptedPath = opts.path;
        return {
          values: [
            {
              key: 'ci/test',
              state: 'SUCCESSFUL',
              updated_on: '2026-03-22T08:00:00Z',
            },
          ],
        };
      }, {
        headers: { 'content-type': 'application/json' },
      });

      const status = await client.getCommitBuildStatus(dummyRepo, 'abcdef1234567');
      assert.equal(status, 'SUCCESSFUL');
      assert.equal(interceptedMethod, 'GET');
      assert.ok(interceptedPath.includes('/commit/abcdef1234567/statuses?pagelen=100'));
      assert.ok(!interceptedPath.includes('/statuses/build'));
    });

    it('raises informative 405 error if an endpoint returns HTTP 405 Method Not Allowed', async () => {
      const client = new BitbucketCloudClient(tokenConfig);
      const pool = mockAgent.get('https://api.bitbucket.org');
      pool.intercept({
        path: '/2.0/repositories/my-workspace/my-repo/pullrequests/999/approve',
        method: 'POST',
      }).reply(405, 'Method Not Allowed', {
        headers: {
          Allow: 'GET, OPTIONS',
          'Content-Type': 'text/plain',
        },
      });

      await assert.rejects(
        () => client.approvePullRequest(dummyRepo, 999),
        (err: any) => {
          assert.equal(err.name, 'BitbucketError');
          assert.equal(err.statusCode, 405);
          assert.equal(err.code, 'GENERIC_API_ERROR');
          assert.ok(err.message.includes('405'));
          assert.ok(err.message.includes('Allowed methods: GET, OPTIONS'));
          return true;
        }
      );
    });
  });

  describe('Session auth API (authType: session)', () => {
    const sessionConfig: BitbucketConnectionConfig = {
      serverType: 'cloud',
      baseUrl: 'https://bitbucket.org/!api/2.0',
      authType: 'session',
      cookie: 'cloud.session.token=xyz123; bb_session=abc456',
      csrfToken: 'test-csrf-token',
    };

    it('approvePullRequest sends POST to https://bitbucket.org/!api/2.0/.../approve with csrf and cookie headers', async () => {
      const client = new BitbucketCloudClient(sessionConfig);
      let interceptedMethod = '';
      let interceptedHeaders: Record<string, string> = {};

      const pool = mockAgent.get('https://bitbucket.org');
      pool.intercept({
        path: '/!api/2.0/repositories/my-workspace/my-repo/pullrequests/456/approve',
        method: 'POST',
      }).reply(200, (opts) => {
        interceptedMethod = opts.method;
        interceptedHeaders = opts.headers as Record<string, string>;
        return { status: 'APPROVED' };
      }, {
        headers: { 'content-type': 'application/json' },
      });

      const res = await client.approvePullRequest(dummyRepo, 456);
      assert.equal(res.success, true);
      assert.equal(interceptedMethod, 'POST');
      assert.equal(interceptedHeaders['x-csrftoken'], 'test-csrf-token');
      assert.ok(interceptedHeaders['cookie'].includes('cloud.session.token=xyz123'));
      assert.equal(interceptedHeaders['origin'], 'https://bitbucket.org');
    });

    it('mergePullRequest sends POST to https://bitbucket.org/!api/2.0/.../merge?async=true with csrf and cookie headers', async () => {
      const client = new BitbucketCloudClient(sessionConfig);
      let interceptedMethod = '';
      let interceptedHeaders: Record<string, string> = {};
      let interceptedBody = '';

      const pool = mockAgent.get('https://bitbucket.org');
      pool.intercept({
        path: '/!api/2.0/repositories/my-workspace/my-repo/pullrequests/456/merge?async=true',
        method: 'POST',
      }).reply(200, (opts) => {
        interceptedMethod = opts.method;
        interceptedHeaders = opts.headers as Record<string, string>;
        interceptedBody = opts.body as string;
        return { state: 'MERGED' };
      }, {
        headers: { 'content-type': 'application/json' },
      });

      await client.mergePullRequest(dummyRepo, 456);
      assert.equal(interceptedMethod, 'POST');
      assert.equal(interceptedHeaders['x-csrftoken'], 'test-csrf-token');
      assert.ok(interceptedHeaders['cookie'].includes('cloud.session.token=xyz123'));
      const body = JSON.parse(interceptedBody);
      assert.equal(body.close_source_branch, false);
    });
  });
});
