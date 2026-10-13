import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import type { ControlPlaneAuth } from '../services/control-plane-auth.js';
import { ownerSessionId } from './session.js';

const VERSION = '0.1.0';
const FILE_NAME = `BitbucketPRWorker-${VERSION}-dev.pkg`;
const RELEASE_API = 'https://api.github.com/repos/HungNguyen0731/bit-auto-approve/releases/latest';
const RELEASE_MANIFEST = 'https://github.com/HungNguyen0731/bit-auto-approve/releases/latest/download/mac-app-update.json';
const RELEASE_ASSET_ORIGIN = 'https://github.com';
const RELEASE_CACHE_MS = 10 * 60 * 1000;
const RELEASE_STALE_MS = 60 * 60 * 1000;

type MacRelease = { version: string; downloadUrl: string; sha256: string; sizeBytes: number };
let cachedMacRelease: { value: MacRelease; fetchedAt: number } | undefined;
let cachedMacArchive: { sha256: string; data: Buffer } | undefined;

async function fetchGitHubResource(url: string, accept: string, timeoutMs: number): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects < 6; redirects += 1) {
    const response = await fetch(current, {
      headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'bitbucket-pr-approver' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('GitHub release redirect has no location');
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !['github.com', 'api.github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(next.hostname)) {
        throw new Error('GitHub release redirect is not trusted');
      }
      current = next.href;
      continue;
    }
    if (!response.ok) throw new Error(`GitHub release asset returned HTTP ${response.status}`);
    return response;
  }
  throw new Error('Too many GitHub release redirects');
}

async function readGitHubJson(url: string, accept: string, maxBytes: number): Promise<unknown> {
  const response = await fetchGitHubResource(url, accept, 8000);
  const encoded = Buffer.from(await response.arrayBuffer());
  if (encoded.length > maxBytes) throw new Error('GitHub release metadata is too large');
  const body = encoded[0] === 0x1f && encoded[1] === 0x8b
    ? gunzipSync(encoded, { maxOutputLength: maxBytes })
    : encoded;
  if (body.length > maxBytes) throw new Error('GitHub release metadata is too large');
  return JSON.parse(body.toString('utf8'));
}

async function verifiedMacArchive(url: string, release: MacRelease): Promise<Buffer> {
  const response = await fetchGitHubResource(url, 'application/zip', 60_000);
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength !== release.sizeBytes) throw new Error('Mac release ZIP size does not match the manifest');
  if (!response.body) throw new Error('Mac release ZIP has no body');
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > release.sizeBytes) throw new Error('Mac release ZIP exceeds the manifest size');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const archive = Buffer.concat(chunks, received);
  if (archive.length !== release.sizeBytes ||
      crypto.createHash('sha256').update(archive).digest('hex') !== release.sha256) {
    throw new Error('Mac release ZIP failed integrity verification');
  }
  return archive;
}

async function macReleaseArchive(release: MacRelease): Promise<Buffer> {
  if (cachedMacArchive?.sha256 === release.sha256) return cachedMacArchive.data;
  const fileName = `Bitbucket-PR-Approver-${release.version}-macOS.zip`;
  const rawUrl = `https://raw.githubusercontent.com/HungNguyen0731/bit-auto-approve/v${release.version}/macos-app/releases/${fileName}`;
  const archive = await verifiedMacArchive(rawUrl, release).catch(() => verifiedMacArchive(release.downloadUrl, release));
  cachedMacArchive = { sha256: release.sha256, data: archive };
  return archive;
}

function validatedMacRelease(tag: unknown, name: unknown, size: unknown, digest: unknown, url: unknown): MacRelease {
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid Mac release tag');
  const version = tag.slice(1);
  const expectedName = `Bitbucket-PR-Approver-${version}-macOS.zip`;
  const expectedUrl = `${RELEASE_ASSET_ORIGIN}/HungNguyen0731/bit-auto-approve/releases/download/${tag}/${expectedName}`;
  if (name !== expectedName || url !== expectedUrl ||
      typeof digest !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(digest) ||
      typeof size !== 'number' || !Number.isSafeInteger(size) || size < 100_000 || size > 100_000_000) {
    throw new Error('Mac release ZIP or integrity metadata is unavailable');
  }
  return { version, downloadUrl: expectedUrl, sha256: digest.slice(7).toLowerCase(), sizeBytes: size };
}

async function macReleaseFromManifest(): Promise<MacRelease> {
  const manifest = await readGitHubJson(RELEASE_MANIFEST, 'application/json', 4096) as {
    tag?: unknown; name?: unknown; size?: unknown; digest?: unknown; downloadUrl?: unknown;
  };
  return validatedMacRelease(manifest.tag, manifest.name, manifest.size, manifest.digest, manifest.downloadUrl);
}

async function macReleaseFromApi(): Promise<MacRelease> {
  const release = await readGitHubJson(RELEASE_API, 'application/vnd.github+json', 1_000_000) as {
    tag_name?: unknown;
    assets?: Array<{ name?: unknown; size?: unknown; digest?: unknown; browser_download_url?: unknown }>;
  };
  const tag = release.tag_name;
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid Mac release tag');
  const name = `Bitbucket-PR-Approver-${tag.slice(1)}-macOS.zip`;
  const asset = release.assets?.find((candidate) => candidate.name === name);
  return validatedMacRelease(tag, asset?.name, asset?.size, asset?.digest, asset?.browser_download_url);
}

async function latestMacRelease(): Promise<MacRelease> {
  const now = Date.now();
  if (cachedMacRelease && now - cachedMacRelease.fetchedAt < RELEASE_CACHE_MS) return cachedMacRelease.value;
  try {
    const value = await macReleaseFromManifest().catch(async (manifestError: unknown) => {
      try {
        return await macReleaseFromApi();
      } catch (apiError) {
        const summary = (error: unknown) => error instanceof Error ? error.message : 'Unknown upstream error';
        throw new Error(`Release manifest: ${summary(manifestError)}; GitHub API: ${summary(apiError)}`);
      }
    });
    cachedMacRelease = { value, fetchedAt: now };
    return value;
  } catch (error) {
    if (cachedMacRelease && now - cachedMacRelease.fetchedAt < RELEASE_STALE_MS) return cachedMacRelease.value;
    throw error;
  }
}

function validatePairUrl(pairUrl: string, expectedOrigin: string): void {
  const parsed = new URL(pairUrl);
  const controlPlane = parsed.searchParams.get('controlPlane');
  const code = parsed.searchParams.get('code');
  if (parsed.protocol !== 'bitbucket-pr-worker:' || parsed.hostname !== 'pair') {
    throw Object.assign(new Error('Pairing URL is invalid'), {
      code: 'PAIRING_URL_INVALID',
      statusCode: 400,
    });
  }
  if (!controlPlane || new URL(controlPlane).origin !== expectedOrigin) {
    throw Object.assign(new Error('Pairing URL does not belong to this control plane'), {
      code: 'PAIRING_ORIGIN_MISMATCH',
      statusCode: 400,
    });
  }
  if (!code || !/^[A-Z0-9-]{6,64}$/.test(code)) {
    throw Object.assign(new Error('Pairing code is invalid'), {
      code: 'PAIRING_CODE_INVALID',
      statusCode: 400,
    });
  }
}

function terminalScript(): string {
  return `#!/bin/zsh
set -euo pipefail

script_dir="${'${0:A:h}'}"
runtime_dir="$script_dir/runtime"
pair_url_path="$script_dir/pair-url"
: "${'${BITBUCKET_WORKER_DATA_DIR:=$HOME/Library/Application Support/BitbucketPRWorker}'}"
export BITBUCKET_WORKER_DATA_DIR
export BITBUCKET_WORKER_KEYCHAIN_HELPER="$runtime_dir/keychain-helper"

mkdir -p "$BITBUCKET_WORKER_DATA_DIR"
chmod 700 "$BITBUCKET_WORKER_DATA_DIR"

echo "Bitbucket PR Worker ${VERSION}"
if [[ ! -f "$BITBUCKET_WORKER_DATA_DIR/config.json" ]]; then
  if [[ ! -f "$pair_url_path" ]]; then
    echo "Pairing request is missing or expired. Return to Local Workers and click Run in Terminal again."
    read -k 1 "?Press any key to close..."
    exit 1
  fi
  echo "Pairing this Mac with the control plane..."
  pair_url="$(<"$pair_url_path")"
  "$runtime_dir/node" "$runtime_dir/worker-bundle.mjs" --pair-url "$pair_url"
  rm -f "$pair_url_path"
  echo "Pairing completed."
else
  rm -f "$pair_url_path"
  echo "Existing Worker pairing found in Keychain and local configuration."
fi

echo "Worker is running. Keep this Terminal window open; press Control-C to stop."
exec "$runtime_dir/node" "$runtime_dir/worker-bundle.mjs"
`;
}

export async function registerWorkerInstallerRoutes(
  app: FastifyInstance,
  options: { auth: ControlPlaneAuth }
): Promise<void> {
  app.get('/api/mac-app/latest', async (_request, reply) => {
    try {
      const release = await latestMacRelease();
      reply.header('Cache-Control', 'no-store');
      return reply.send({ success: true, data: {
        version: release.version,
        downloadUrl: `/downloads/Bitbucket-PR-Approver-${release.version}-macOS.zip`,
        sha256: release.sha256,
        sizeBytes: release.sizeBytes,
      } });
    } catch (error) {
      app.log.warn({ error }, 'Mac app release metadata unavailable');
      return reply.status(503).send({ success: false, error: { code: 'MAC_APP_UNAVAILABLE', message: 'Mac app release metadata is temporarily unavailable' } });
    }
  });
  app.get('/downloads/mac-app/latest', async (_request, reply) => {
    try {
      const release = await latestMacRelease();
      return reply.header('Cache-Control', 'no-store').redirect(release.downloadUrl, 302);
    } catch {
      return reply.status(503).send({ success: false, error: { code: 'MAC_APP_UNAVAILABLE', message: 'Mac app download is temporarily unavailable' } });
    }
  });
  app.get<{ Params: { filename: string } }>('/downloads/:filename', async (request, reply) => {
    const match = /^(?:Bitbucket-PR-Approver|GitPulse)-(\d+\.\d+\.\d+)-macOS\.zip$/.exec(request.params.filename);
    if (!match) return reply.status(404).send();
    try {
      const release = await latestMacRelease();
      if (match[1] !== release.version) return reply.status(404).send();
      const archive = await macReleaseArchive(release);
      const fileSize = archive.length;
      let start = 0;
      let end = fileSize - 1;
      const range = request.headers.range;
      if (range) {
        const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!parts || (!parts[1] && !parts[2])) {
          return reply.status(416).header('Content-Range', `bytes */${fileSize}`).send();
        }
        if (parts[1]) {
          start = Number(parts[1]);
          end = parts[2] ? Math.min(Number(parts[2]), fileSize - 1) : end;
        } else {
          start = Math.max(fileSize - Number(parts[2]), 0);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
          return reply.status(416).header('Content-Range', `bytes */${fileSize}`).send();
        }
        reply.status(206).header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      }
      reply.header('Content-Disposition', `attachment; filename="${request.params.filename}"`);
      reply.header('Cache-Control', 'public, max-age=600');
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', end - start + 1);
      reply.type('application/zip');
      return reply.send(archive.subarray(start, end + 1));
    } catch (error) {
      app.log.warn({ error }, 'Mac app release download unavailable');
      return reply.status(503).send({ success: false, error: { code: 'MAC_APP_UNAVAILABLE', message: error instanceof Error ? error.message : 'Mac app download is temporarily unavailable' } });
    }
  });

  const packagePath = path.resolve(process.cwd(), '../worker/dist-packages', FILE_NAME);
  const portableResources = new Map([
    ['setup', { path: path.resolve(process.cwd(), '../worker/install/macos/portable-setup.sh'), type: 'text/plain' }],
    ['launcher', { path: path.resolve(process.cwd(), '../worker/install/macos/portable-launcher.sh'), type: 'text/plain' }],
    ['terminal', { path: path.resolve(process.cwd(), '../worker/install/macos/portable-terminal.command'), type: 'text/plain' }],
    ['applescript', { path: path.resolve(process.cwd(), '../worker/install/macos/portable-handler.applescript'), type: 'text/plain' }],
    ['bundle', { path: path.resolve(process.cwd(), '../worker/dist/worker-bundle.mjs'), type: 'application/javascript' }],
    ['keychain-source', { path: path.resolve(process.cwd(), '../worker/native/keychain-helper.swift'), type: 'text/plain' }],
  ]);

  app.get('/api/worker-installer/bootstrap/bundle-manifest', async (_request, reply) => {
    const bundlePath = path.resolve(process.cwd(), '../worker/dist/worker-bundle.mjs');
    if (!fs.existsSync(bundlePath)) {
      return reply.status(404).send({ success: false, error: { code: 'WORKER_BUNDLE_UNAVAILABLE', message: 'Worker bundle is unavailable' } });
    }
    const bundle = fs.readFileSync(bundlePath);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ success: true, data: {
      protocolVersion: 4,
      supportsAutoMerge: bundle.includes('supportsAutoMerge: true'),
      sha256: crypto.createHash('sha256').update(bundle).digest('hex'),
      sizeBytes: bundle.length,
    } });
  });

  app.get<{ Params: { resource: string } }>('/api/worker-installer/bootstrap/:resource', async (request, reply) => {
    const resource = portableResources.get(request.params.resource);
    if (!resource || !fs.existsSync(resource.path)) {
      return reply.status(404).send({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Portable Worker resource unavailable' } });
    }
    reply.header('Cache-Control', 'no-store');
    reply.type(resource.type);
    return reply.send(fs.createReadStream(resource.path));
  });

  app.get('/api/worker-installer/manifest', async (request, reply) => {
    try {
      options.auth.requireSession(ownerSessionId(request));
      const available = fs.existsSync(packagePath);
      const size = available ? fs.statSync(packagePath).size : 0;
      return reply.send({
        success: true,
        data: {
          platform: 'darwin',
          architecture: 'arm64',
          version: VERSION,
          available,
          signed: false,
          size,
          fileName: FILE_NAME,
          downloadUrl: '/api/worker-installer/macos',
          terminalRunAvailable:
            process.platform === 'darwin' &&
            fs.existsSync(path.resolve(process.cwd(), '../worker/dist/worker-bundle.mjs')) &&
            fs.existsSync(path.resolve(process.cwd(), '../worker/native/keychain-helper')),
          portableRunAvailable: [...portableResources.values()].every((resource) => fs.existsSync(resource.path)),
        },
      });
    } catch (error: any) {
      return reply.status(error.statusCode || 401).send({
        success: false,
        error: { code: error.code || 'SESSION_REQUIRED', message: error.message },
      });
    }
  });

  app.get('/api/worker-installer/macos', async (request, reply) => {
    try {
      options.auth.requireSession(ownerSessionId(request));
      if (!fs.existsSync(packagePath)) {
        return reply.status(404).send({
          success: false,
          error: { code: 'INSTALLER_NOT_BUILT', message: 'macOS worker package is unavailable' },
        });
      }
      reply.header('Content-Disposition', `attachment; filename="${FILE_NAME}"`);
      reply.type('application/vnd.apple.installer+xml');
      return reply.send(fs.createReadStream(packagePath));
    } catch (error: any) {
      return reply.status(error.statusCode || 401).send({
        success: false,
        error: { code: error.code || 'SESSION_REQUIRED', message: error.message },
      });
    }
  });

  app.post<{ Body: { pairUrl?: string } }>(
    '/api/worker-installer/terminal-run',
    async (request, reply) => {
      try {
        options.auth.requireSession(ownerSessionId(request));
        if (!request.body?.pairUrl) {
          return reply.status(400).send({
            success: false,
            error: { code: 'PAIRING_URL_REQUIRED', message: 'Pairing URL is required' },
          });
        }

        const forwardedProtocol = request.headers['x-forwarded-proto'];
        const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol : request.protocol;
        const expectedOrigin = `${protocol}://${request.headers.host || '127.0.0.1:3100'}`;
        validatePairUrl(request.body.pairUrl, expectedOrigin);
        if (
          process.platform !== 'darwin' ||
          !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(request.hostname)
        ) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'LOCAL_TERMINAL_REQUIRED',
              message: 'Run in Terminal is available only from a control plane running on this Mac',
            },
          });
        }

        const workerRoot = path.resolve(process.cwd(), '../worker');
        const workerBundle = path.join(workerRoot, 'dist/worker-bundle.mjs');
        const keychainHelper = path.join(workerRoot, 'native/keychain-helper');
        if (!fs.existsSync(workerBundle) || !fs.existsSync(keychainHelper)) {
          return reply.status(503).send({
            success: false,
            error: {
              code: 'TERMINAL_RUNTIME_NOT_BUILT',
              message: 'Terminal Worker runtime has not been built',
            },
          });
        }

        const bundleDirectory = path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'BitbucketPRWorker',
          'terminal-launcher'
        );
        const runtimeDirectory = path.join(bundleDirectory, 'runtime');
        fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });

        const commandPath = path.join(bundleDirectory, 'Start Bitbucket PR Worker.command');
        fs.writeFileSync(commandPath, terminalScript(), { mode: 0o755 });
        fs.writeFileSync(path.join(bundleDirectory, 'pair-url'), request.body.pairUrl, { mode: 0o600 });
        fs.copyFileSync(process.execPath, path.join(runtimeDirectory, 'node'));
        fs.copyFileSync(workerBundle, path.join(runtimeDirectory, 'worker-bundle.mjs'));
        fs.copyFileSync(keychainHelper, path.join(runtimeDirectory, 'keychain-helper'));
        fs.chmodSync(path.join(runtimeDirectory, 'node'), 0o755);
        fs.chmodSync(path.join(runtimeDirectory, 'keychain-helper'), 0o755);

        const opened = spawnSync('/usr/bin/open', ['-a', 'Terminal', commandPath], { encoding: 'utf8' });
        if (opened.status !== 0) {
          throw Object.assign(new Error(opened.stderr.trim() || 'Unable to open Terminal'), {
            code: 'TERMINAL_OPEN_FAILED',
            statusCode: 500,
          });
        }
        return reply.send({
          success: true,
          data: { started: true, launcherPath: commandPath },
        });
      } catch (error: any) {
        return reply.status(error.statusCode || 500).send({
          success: false,
          error: { code: error.code || 'TERMINAL_OPEN_FAILED', message: error.message },
        });
      }
    }
  );
}
