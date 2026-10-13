import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildServer, type ServerInstance } from '../server.js';
import { GitService } from '../services/git.js';
import { parseGitDiff } from '../services/git-diff-parser.js';

describe('Git Engine & REST APIs', () => {
  let tmpRoot: string;
  let repo1Path: string;
  let repo2Path: string;
  let server: ServerInstance;
  let gitService: GitService;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-root-'));
    repo1Path = path.join(tmpRoot, 'repo-alpha');
    repo2Path = path.join(tmpRoot, 'subfolder', 'repo-beta');

    fs.mkdirSync(repo1Path, { recursive: true });
    fs.mkdirSync(repo2Path, { recursive: true });

    // Initialize repo 1
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo1Path });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: repo1Path });
    execFileSync('git', ['config', 'user.email', 'tester@test.local'], { cwd: repo1Path });

    fs.writeFileSync(path.join(repo1Path, 'README.md'), '# Repo Alpha\nInitial line\n');
    execFileSync('git', ['add', '.'], { cwd: repo1Path });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repo1Path });

    // Add a feature branch and merge in repo 1 to test DAG parent links
    execFileSync('git', ['checkout', '-b', 'feature-x'], { cwd: repo1Path });
    fs.writeFileSync(path.join(repo1Path, 'feature.txt'), 'Feature content\n');
    execFileSync('git', ['add', 'feature.txt'], { cwd: repo1Path });
    execFileSync('git', ['commit', '-m', 'Add feature-x'], { cwd: repo1Path });

    execFileSync('git', ['checkout', 'main'], { cwd: repo1Path });
    fs.writeFileSync(path.join(repo1Path, 'main-file.txt'), 'Main file\n');
    execFileSync('git', ['add', 'main-file.txt'], { cwd: repo1Path });
    execFileSync('git', ['commit', '-m', 'Main update'], { cwd: repo1Path });

    execFileSync('git', ['merge', '--no-ff', '-m', 'Merge branch feature-x', 'feature-x'], { cwd: repo1Path });
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repo1Path });

    // Initialize repo 2
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo2Path });
    execFileSync('git', ['config', 'user.name', 'Tester Beta'], { cwd: repo2Path });
    execFileSync('git', ['config', 'user.email', 'beta@test.local'], { cwd: repo2Path });

    fs.writeFileSync(path.join(repo2Path, 'file2.txt'), 'Hello Beta\n');
    execFileSync('git', ['add', '.'], { cwd: repo2Path });
    execFileSync('git', ['commit', '-m', 'Repo beta init'], { cwd: repo2Path });

    // Start Fastify server
    server = await buildServer({
      dataDir: path.join(tmpRoot, 'server-data'),
      disableScheduler: true,
    });
    await server.app.ready();
    gitService = server.gitService;
  });

  after(async () => {
    server.scheduler.stop();
    server.events.close();
    await server.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('GitService Core Capabilities', () => {
    it('scans multi-repo folder and discovers all repositories', async () => {
      const scanResult = await gitService.scanRepositories(tmpRoot, 4);
      assert.equal(scanResult.repositories.length, 2);

      const repoNames = scanResult.repositories.map((r) => r.name);
      assert.ok(repoNames.includes('repo-alpha'));
      assert.ok(repoNames.includes('repo-beta'));

      const alpha = scanResult.repositories.find((r) => r.name === 'repo-alpha');
      assert.ok(alpha);
      assert.equal(alpha.currentBranch, 'main');
      assert.equal(alpha.isClean, true);
      assert.ok(alpha.lastCommitHash);
      assert.equal(alpha.lastCommitMessage, 'Merge branch feature-x');
    });

    it('extracts commit history with topological parent links and refs for DAG rendering', async () => {
      const commits = await gitService.getCommitHistory(repo1Path, { limit: 10 });
      assert.ok(commits.length >= 4);

      // Top commit is the merge commit
      const mergeCommit = commits[0];
      assert.equal(mergeCommit.message, 'Merge branch feature-x');
      assert.equal(mergeCommit.parents.length, 2); // Two parents in merge commit!

      // Check ref tags and branches
      const hasMainRef = commits.some((c) => c.refs.some((r) => r.name === 'main'));
      const hasFeatureRef = commits.some((c) => c.refs.some((r) => r.name === 'feature-x'));
      const hasTagRef = commits.some((c) => c.refs.some((r) => r.name === 'v1.0.0' && r.type === 'tag'));

      assert.ok(hasMainRef, 'Should have main branch ref');
      assert.ok(hasFeatureRef, 'Should have feature-x branch ref');
      assert.ok(hasTagRef, 'Should have v1.0.0 tag ref');
    });

    it('accurately parses working tree status across staged, unstaged, and untracked', async () => {
      // Create staged, unstaged, and untracked modifications in repo 1
      fs.appendFileSync(path.join(repo1Path, 'README.md'), 'New uncommitted line\n');
      fs.writeFileSync(path.join(repo1Path, 'staged-file.txt'), 'Staged content\n');
      execFileSync('git', ['add', 'staged-file.txt'], { cwd: repo1Path });
      fs.writeFileSync(path.join(repo1Path, 'untracked.txt'), 'Untracked content\n');

      const status = await gitService.getWorkingTreeStatus(repo1Path);
      assert.equal(status.isClean, false);
      assert.equal(status.branch, 'main');

      const stagedPaths = status.staged.map((f) => f.path);
      const unstagedPaths = status.unstaged.map((f) => f.path);
      const untrackedPaths = status.untracked.map((f) => f.path);

      assert.ok(stagedPaths.includes('staged-file.txt'));
      assert.ok(unstagedPaths.includes('README.md'));
      assert.ok(untrackedPaths.includes('untracked.txt'));

      // Clean up changes for subsequent tests
      execFileSync('git', ['reset', 'HEAD'], { cwd: repo1Path });
      execFileSync('git', ['checkout', '--', '.'], { cwd: repo1Path });
      fs.unlinkSync(path.join(repo1Path, 'staged-file.txt'));
      fs.unlinkSync(path.join(repo1Path, 'untracked.txt'));
    });

    it('generates structured diffs for working tree modifications', async () => {
      fs.appendFileSync(path.join(repo1Path, 'README.md'), 'Diff addition test\n');

      const diffResult = await gitService.getDiff(repo1Path, { path: 'README.md' });
      assert.ok(diffResult.rawDiff.length > 0);
      assert.equal(diffResult.files.length, 1);

      const fileDiff = diffResult.files[0];
      assert.equal(fileDiff.newPath, 'README.md');
      assert.ok(fileDiff.additions >= 1);
      assert.ok(fileDiff.hunks.length >= 1);

      const hasAddedLine = fileDiff.hunks[0].lines.some(
        (l) => l.type === 'addition' && l.content.includes('Diff addition test')
      );
      assert.ok(hasAddedLine);

      // Revert
      execFileSync('git', ['checkout', '--', 'README.md'], { cwd: repo1Path });
    });

    it('supports stage, unstage, commit, branch create/switch, and stash operations', async () => {
      const testFile = path.join(repo2Path, 'lifecycle.txt');
      fs.writeFileSync(testFile, 'lifecycle line 1\n');

      // Stage
      await gitService.stage(repo2Path, ['lifecycle.txt']);
      let status = await gitService.getWorkingTreeStatus(repo2Path);
      assert.equal(status.staged.length, 1);
      assert.equal(status.staged[0].path, 'lifecycle.txt');

      // Unstage
      await gitService.unstage(repo2Path, ['lifecycle.txt']);
      status = await gitService.getWorkingTreeStatus(repo2Path);
      assert.equal(status.staged.length, 0);

      // Stage again and commit
      await gitService.stage(repo2Path, ['lifecycle.txt']);
      const commitRes = await gitService.commit(repo2Path, 'Add lifecycle file');
      assert.ok(commitRes.commitHash);

      // Branch create & switch
      await gitService.createBranch(repo2Path, 'test-branch', undefined, true);
      let branches = await gitService.getBranches(repo2Path);
      const current = branches.find((b) => b.current);
      assert.equal(current?.name, 'test-branch');

      // Switch back
      await gitService.switchBranch(repo2Path, 'main');
      branches = await gitService.getBranches(repo2Path);
      assert.equal(branches.find((b) => b.current)?.name, 'main');

      // Stash push & pop
      fs.writeFileSync(path.join(repo2Path, 'stash-test.txt'), 'stash me\n');
      await gitService.stage(repo2Path, ['stash-test.txt']);
      const stashRes = await gitService.stashPush(repo2Path, 'wip stash');
      assert.ok(stashRes.success);

      const stashes = await gitService.getStashes(repo2Path);
      assert.ok(stashes.length >= 1);
      assert.ok(stashes[0].message.includes('wip stash'));

      const popRes = await gitService.stashPop(repo2Path, 0);
      assert.ok(popRes.success);
      fs.unlinkSync(path.join(repo2Path, 'stash-test.txt'));
      execFileSync('git', ['reset', 'HEAD'], { cwd: repo2Path });
    });
  });

  describe('Fastify REST API Endpoints', () => {
    it('POST /api/git/scan returns scanned repositories', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/git/scan',
        payload: {
          rootPath: tmpRoot,
          maxDepth: 3,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.repositories.length, 2);
    });

    it('GET /api/git/repositories returns 400 when rootPath is missing', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/git/repositories',
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    });

    it('GET /api/git/status returns working tree status', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/git/status?repoPath=${encodeURIComponent(repo1Path)}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.branch, 'main');
      assert.equal(body.data.isClean, true);
    });

    it('GET /api/git/commits returns DAG commit list with parent references', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/git/commits?repoPath=${encodeURIComponent(repo1Path)}&limit=10`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.length >= 4);

      const top = body.data[0];
      assert.ok(top.hash);
      assert.ok(top.parents);
      assert.ok(top.authorName);
    });

    it('GET /api/git/diff returns unified diff hunks', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/git/diff?repoPath=${encodeURIComponent(repo1Path)}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.files));
    });

    it('GET /api/git/branches returns list of branches', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/api/git/branches?repoPath=${encodeURIComponent(repo1Path)}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.length >= 2);
      assert.ok(body.data.some((b: any) => b.name === 'main'));
      assert.ok(body.data.some((b: any) => b.name === 'feature-x'));
    });

    it('Stage and Commit flow via REST endpoints', async () => {
      const filePath = path.join(repo1Path, 'rest-flow.txt');
      fs.writeFileSync(filePath, 'testing rest endpoints\n');

      // Stage
      const stageRes = await server.app.inject({
        method: 'POST',
        url: '/api/git/stage',
        payload: {
          repoPath: repo1Path,
          paths: ['rest-flow.txt'],
        },
      });
      assert.equal(stageRes.statusCode, 200);
      assert.equal(stageRes.json().success, true);

      // Commit
      const commitRes = await server.app.inject({
        method: 'POST',
        url: '/api/git/commit',
        payload: {
          repoPath: repo1Path,
          message: 'REST API commit test',
        },
      });
      assert.equal(commitRes.statusCode, 200);
      assert.equal(commitRes.json().success, true);
      assert.ok(commitRes.json().data.commitHash);

      // Status check
      const statusRes = await server.app.inject({
        method: 'GET',
        url: `/api/git/status?repoPath=${encodeURIComponent(repo1Path)}`,
      });
      assert.equal(statusRes.statusCode, 200);
      assert.equal(statusRes.json().data.isClean, true);
    });

    it('returns 400 VALIDATION_ERROR when repoPath is omitted', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/git/status',
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    });
  });

  describe('Merge, remotes, and desktop integrations', () => {
    it('lists remote fetch and push URLs and converts origin to a credential-free web URL', async () => {
      execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:workspace/repository.git'], { cwd: repo2Path });
      execFileSync('git', ['remote', 'set-url', '--push', 'origin', 'git@github.com:team/repository.git'], { cwd: repo2Path });
      assert.deepEqual(await gitService.getRemotes(repo2Path), [{
        name: 'origin', url: 'git@bitbucket.org:workspace/repository.git', pushUrl: 'git@github.com:team/repository.git',
      }]);
      for (const [remote, expected] of [
        ['git@bitbucket.org:workspace/repository.git', 'https://bitbucket.org/workspace/repository'],
        ['ssh://git@github.com/team/repository.git', 'https://github.com/team/repository'],
        ['https://user:secret@github.com/team/repository.git?token=secret#fragment', 'https://github.com/team/repository'],
      ]) {
        execFileSync('git', ['remote', 'set-url', 'origin', remote], { cwd: repo2Path });
        assert.deepEqual(await gitService.getRemoteWebUrl(repo2Path), { url: expected });
      }
      execFileSync('git', ['remote', 'set-url', 'origin', '/tmp/local-repository'], { cwd: repo2Path });
      await assert.rejects(() => gitService.getRemoteWebUrl(repo2Path), /supported/i);
      execFileSync('git', ['remote', 'set-url', 'origin', 'git@bitbucket.org:workspace/repository.git'], { cwd: repo2Path });
      const remotes = await server.app.inject({ method: 'GET', url: `/api/git/remotes?repoPath=${encodeURIComponent(repo2Path)}` });
      assert.equal(remotes.statusCode, 200);
      assert.equal(remotes.json().data[0].name, 'origin');
      const web = await server.app.inject({ method: 'GET', url: `/api/git/remote-web-url?repoPath=${encodeURIComponent(repo2Path)}` });
      assert.equal(web.statusCode, 200);
      assert.equal(web.json().data.url, 'https://bitbucket.org/workspace/repository');
      await assert.rejects(() => gitService.getRemoteWebUrl(repo1Path), /origin/i);
    });

    it('merges a branch with a forced merge commit and custom message through REST', async () => {
      await gitService.createBranch(repo2Path, 'merge-test', undefined, true);
      fs.writeFileSync(path.join(repo2Path, 'merge-result.txt'), 'merged content\n');
      await gitService.stage(repo2Path, ['merge-result.txt']);
      await gitService.commit(repo2Path, 'Merge input');
      await gitService.switchBranch(repo2Path, 'main');
      const result = await server.app.inject({ method: 'POST', url: '/api/git/merge', payload: {
        repoPath: repo2Path, branch: 'merge-test', noFf: true, message: 'Custom merge message',
      } });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().data.success, true);
      const history = await gitService.getCommitHistory(repo2Path, { branch: 'HEAD', limit: 1 });
      assert.equal(history[0].parents.length, 2);
      assert.equal(history[0].message, 'Custom merge message');
      assert.equal(fs.readFileSync(path.join(repo2Path, 'merge-result.txt'), 'utf8'), 'merged content\n');
      await assert.rejects(() => gitService.merge(repo2Path, { branch: '--abort' }), /branch/i);
      const invalid = await server.app.inject({ method: 'POST', url: '/api/git/merge', payload: { repoPath: repo2Path, branch: 123 } });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
      const missing = await server.app.inject({ method: 'POST', url: '/api/git/merge', payload: { repoPath: repo2Path, branch: 'nonexistent-branch' } });
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.json().error.code, 'MERGE_FAILED');
    });

    it('preserves merge conflict state and reports a useful REST failure', async () => {
      await gitService.createBranch(repo2Path, 'conflict-test', undefined, true);
      fs.writeFileSync(path.join(repo2Path, 'file2.txt'), 'feature conflict\n');
      await gitService.stage(repo2Path, ['file2.txt']);
      await gitService.commit(repo2Path, 'Feature conflict');
      await gitService.switchBranch(repo2Path, 'main');
      fs.writeFileSync(path.join(repo2Path, 'file2.txt'), 'main conflict\n');
      await gitService.stage(repo2Path, ['file2.txt']);
      await gitService.commit(repo2Path, 'Main conflict');
      try {
        const result = await server.app.inject({ method: 'POST', url: '/api/git/merge', payload: { repoPath: repo2Path, branch: 'conflict-test' } });
        assert.equal(result.statusCode, 400);
        assert.equal(result.json().error.code, 'MERGE_FAILED');
        assert.match(result.json().error.message, /CONFLICT|Automatic merge failed/);
        const status = await gitService.getWorkingTreeStatus(repo2Path);
        assert.ok(status.unstaged.some((file) => file.path === 'file2.txt' && file.status === 'conflict'));
      } finally {
        execFileSync('git', ['merge', '--abort'], { cwd: repo2Path });
      }
    });

    it('validates repository paths before launching desktop applications', async () => {
      for (const action of ['open-in-finder', 'open-terminal']) {
        const missing = await server.app.inject({ method: 'POST', url: `/api/git/${action}`, payload: {} });
        assert.equal(missing.statusCode, 400);
        assert.equal(missing.json().error.code, 'VALIDATION_ERROR');
        const invalid = await server.app.inject({ method: 'POST', url: `/api/git/${action}`, payload: { repoPath: tmpRoot } });
        assert.equal(invalid.statusCode, 400);
        assert.equal(invalid.json().success, false);
      }
    });

    it('launches Finder and Terminal with an absolute repository argument without a shell', async () => {
      if (process.platform !== 'darwin') {
        await assert.rejects(() => gitService.openInFinder(repo2Path), /macOS/i);
        await assert.rejects(() => gitService.openTerminal(repo2Path), /macOS/i);
        return;
      }
      // Replace only the external OS launcher, never launch a real application during tests.
      const bin = path.join(tmpRoot, 'fake-bin');
      fs.mkdirSync(bin);
      const log = path.join(tmpRoot, 'open-arguments');
      fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$OPEN_TEST_LOG"\n', { mode: 0o755 });
      const oldPath = process.env.PATH;
      process.env.PATH = `${bin}:${oldPath}`;
      process.env.OPEN_TEST_LOG = log;
      try {
        assert.equal((await gitService.openInFinder(repo2Path)).success, true);
        assert.equal(fs.readFileSync(log, 'utf8'), `${repo2Path}\n`);
        const res = await server.app.inject({ method: 'POST', url: '/api/git/open-terminal', payload: { repoPath: repo2Path } });
        assert.equal(res.statusCode, 200);
        assert.equal(fs.readFileSync(log, 'utf8'), `-a\nTerminal\n${repo2Path}\n`);
      } finally {
        process.env.PATH = oldPath;
        delete process.env.OPEN_TEST_LOG;
      }
    });
  });

  describe('Diff Parser Unit Tests', () => {
    it('parses multi-hunk and multi-file unified diff correctly', () => {
      const sampleDiff = `diff --git a/file1.txt b/file1.txt
index 1234567..89abcdef 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,3 +1,4 @@
 line 1
+line 1.5
 line 2
-line 3
+line 3 modified
diff --git a/newfile.txt b/newfile.txt
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+new 1
+new 2
`;
      const files = parseGitDiff(sampleDiff);
      assert.equal(files.length, 2);

      assert.equal(files[0].newPath, 'file1.txt');
      assert.equal(files[0].additions, 2);
      assert.equal(files[0].deletions, 1);
      assert.equal(files[0].hunks.length, 1);
      assert.equal(files[0].hunks[0].lines.length, 5);

      assert.equal(files[1].newPath, 'newfile.txt');
      assert.equal(files[1].isNew, true);
      assert.equal(files[1].additions, 2);
      assert.equal(files[1].deletions, 0);
    });
  });
});
