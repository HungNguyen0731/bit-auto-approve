import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { ControlPlaneAuth } from '../services/control-plane-auth.js';
import { ownerSessionId } from './session.js';

const VERSION = '0.1.0';
const FILE_NAME = `BitbucketPRWorker-${VERSION}-dev.pkg`;

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
  const packagePath = path.resolve(process.cwd(), '../worker/dist-packages', FILE_NAME);

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
