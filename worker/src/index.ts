import os from 'node:os';
import path from 'node:path';
import { ControlPlaneClient } from './control-plane-client.js';
import { DEFAULT_CONFIG_DIRECTORY, loadConfig, saveConfig } from './config.js';
import { KeychainStore } from './keychain.js';
import { WorkerIdentityStore } from './identity.js';
import { WorkerOutbox } from './outbox.js';
import { ConnectivityStateMachine } from './vpn-state.js';
import { WorkerExecutor } from './executor.js';
import type { ExecutionLease, WorkerLogEntry } from '@bitbucket-pr-approver/shared';
import crypto from 'node:crypto';
import { WorkerUpdater } from './updater.js';

async function pair(pairUrl: string): Promise<void> {
  const url = new URL(pairUrl);
  const controlPlaneUrl = url.searchParams.get('controlPlane');
  const code = url.searchParams.get('code');
  if (!controlPlaneUrl || !code) throw new Error('Pair URL is incomplete');

  const keychain = new KeychainStore();
  const identityStore = new WorkerIdentityStore(keychain);
  const identity = await identityStore.getOrCreateIdentity();
  const metadata = {
    name: os.hostname(),
    platform: 'darwin' as const,
    architecture: os.arch(),
    hostname: os.hostname(),
    version: '0.1.0',
  };
  const result = await new ControlPlaneClient(controlPlaneUrl).pair(
    identityStore.pairingRequest(code, metadata, identity.publicKey)
  );
  await identityStore.storePairing(result);
  saveConfig({
    workerId: result.worker.id,
    controlPlaneUrl,
    heartbeatIntervalMs: 10_000,
    claimIntervalMs: 5_000,
    version: metadata.version,
  });
}

async function run(): Promise<void> {
  const config = loadConfig();
  const identityStore = new WorkerIdentityStore(new KeychainStore());
  const credential = await identityStore.getCredential();
  if (!credential) throw new Error('Worker credential is unavailable');

  const client = new ControlPlaneClient(config.controlPlaneUrl, config.workerId, credential);
  const stateMachine = new ConnectivityStateMachine();
  const outbox = new WorkerOutbox(path.join(DEFAULT_CONFIG_DIRECTORY, 'outbox.json'));
  const executor = new WorkerExecutor(process.argv.includes('--verification-mode'));
  const updater = new WorkerUpdater(
    client,
    config.version,
    DEFAULT_CONFIG_DIRECTORY,
    process.env.BITBUCKET_WORKER_UPDATE_PUBLIC_KEY
  );
  updater.recoverOrBeginHealthWindow();
  let activeExecutionId: string | undefined;
  let lastLease: ExecutionLease | null = null;
  let stopped = false;
  let workTimer: ReturnType<typeof setTimeout> | undefined;
  let lastControlPlaneFailure: string | undefined;

  const reportControlPlaneFailure = (stage: string, error: any) => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : error?.name || 'REQUEST_FAILED';
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : undefined;
    const signature = `${stage}:${code}:${status || ''}`;
    if (signature !== lastControlPlaneFailure) {
      const frame = typeof error?.stack === 'string'
        ? error.stack.match(/worker-bundle\.mjs:\d+:\d+/)?.[0] : undefined;
      const endpoint = typeof error?.endpoint === 'string' ? ` ${error.endpoint}` : '';
      const response = typeof error?.responseType === 'string'
        ? `; response ${error.responseType}/${error.responseKind || 'unknown'} ${error.responseBytes ?? '?'} bytes at ${error.responsePath || 'unknown'}` : '';
      console.error(`Control plane ${stage}${endpoint} failed: ${code}${status ? ` (HTTP ${status})` : ''}${response}${frame ? ` at ${frame}` : ''}`);
      lastControlPlaneFailure = signature;
    }
  };

  const synchronizeToken = async () => {
    const envelope = await client.claimTokenEnvelope();
    if (!envelope) return;
    const token = await identityStore.decryptEnvelope(envelope.ciphertext);
    await identityStore.storeBitbucketToken(token);
    await client.acknowledgeTokenEnvelope(envelope.id);
  };

  await synchronizeToken();
  let bitbucketToken = await identityStore.getBitbucketToken();
  if (bitbucketToken) stateMachine.recordProbe(true);

  const appendTransitionLog = (status: 'PAUSED_VPN' | 'RESUMED') => {
    const executionId = 'system-vpn';
    const log: WorkerLogEntry = {
      id: crypto.randomUUID(),
      workerId: config.workerId,
      executionId,
      jobId: 'system',
      sequence: outbox.nextSequence(executionId),
      status,
      timestamp: new Date().toISOString(),
      matchedConditions: [],
      failureReason:
        status === 'PAUSED_VPN'
          ? 'Worker paused because the Bitbucket VPN or IP allowlist route is unavailable'
          : 'Worker resumed after Bitbucket connectivity recovered',
    };
    outbox.append([log]);
  };

  const recordProbe = (success: boolean, classification?: string) => {
    const transition = stateMachine.recordProbe(success, classification);
    if (transition.event) appendTransitionLog(transition.event);
    return transition;
  };

  const flushOutbox = async () => {
    while (outbox.size() > 0) {
      const item = outbox.peek(1)[0];
      const accepted = await client.sendLogs(item.executionId, {
        sequence: item.sequence,
        items: [item],
      });
      outbox.acknowledge(item.executionId, accepted.acceptedThrough);
    }
  };

  const heartbeat = async () => {
    try {
      const request = {
        state: stateMachine.currentState,
        version: config.version,
        platform: 'darwin',
        architecture: os.arch(),
        activeExecutionId,
        queueDepth: outbox.size(),
        hasLegacyToken: Boolean(bitbucketToken),
        supportsAccountLeases: true,
      } as const;
      await client.heartbeat(request);
      // Account-bound Workers do not have a legacy Bitbucket token. A healthy
      // control-plane heartbeat must still move them out of STARTING/OFFLINE.
      if (!bitbucketToken && ['STARTING', 'OFFLINE_CONTROL_PLANE'].includes(stateMachine.currentState)) {
        recordProbe(true);
        // Publish the recovered state before the next claim; otherwise a claim
        // can receive WORKER_NOT_ONLINE and send this Worker offline again.
        await client.heartbeat({ ...request, state: stateMachine.currentState });
      }
      if (lastControlPlaneFailure) console.info('Control plane connection restored');
      lastControlPlaneFailure = undefined;
      updater.markHealthy();
    } catch (error: any) {
      reportControlPlaneFailure('heartbeat', error);
      stateMachine.markControlPlaneOffline();
    }
  };

  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, config.heartbeatIntervalMs);
  const updateTimer = setInterval(async () => {
    try {
      if (await updater.checkAndApply()) process.kill(process.pid, 'SIGTERM');
    } catch {
      // The current healthy version keeps running when an update cannot be verified.
    }
  }, 24 * 60 * 60 * 1000);

  const workLoop = async () => {
    if (stopped) return;
    let delay = config.claimIntervalMs;
    try {
      await synchronizeToken();
      const hadToken = Boolean(bitbucketToken);
      bitbucketToken = bitbucketToken || (await identityStore.getBitbucketToken());
      if (
        bitbucketToken &&
        (stateMachine.currentState === 'OFFLINE_CONTROL_PLANE' ||
          (!hadToken && ['STARTING', 'ERROR_AUTH'].includes(stateMachine.currentState)))
      ) {
        recordProbe(true);
        await heartbeat();
      }
      if (stateMachine.currentState === 'PAUSED_VPN' && lastLease) {
        try {
          const encryptedToken = lastLease.accountTokenCiphertext || lastLease.manualTokenCiphertext;
          const probeToken = encryptedToken
            ? await identityStore.decryptEnvelope(encryptedToken)
            : bitbucketToken;
          if (!probeToken) throw Object.assign(new Error('Missing token'), { code: 'AUTH_INVALID_TOKEN' });
          await executor.probe(lastLease, probeToken);
          delay = recordProbe(true).nextProbeDelayMs;
        } catch (error: any) {
          delay = recordProbe(false, error.code || 'NETWORK_OFFLINE').nextProbeDelayMs;
        }
      } else if (['ONLINE', 'STARTING', 'ERROR_AUTH'].includes(stateMachine.currentState)) {
        await flushOutbox();
        const claim = await client.claim(!bitbucketToken);
        if (claim.lease) {
          lastLease = claim.lease;
          activeExecutionId = claim.lease.executionId;
          await client.renew(claim.lease.executionId);
          try {
            const encryptedToken = claim.lease.accountTokenCiphertext || claim.lease.manualTokenCiphertext;
            const executionToken = encryptedToken
              ? await identityStore.decryptEnvelope(encryptedToken)
              : bitbucketToken;
            if (!executionToken) throw Object.assign(new Error('Missing token'), { code: 'AUTH_INVALID_TOKEN' });
            const result = await executor.execute(claim.lease, executionToken);
            outbox.append(result.logs);
            await flushOutbox();
            await client.complete(claim.lease.executionId, result.summary);
            lastLease = null;
            recordProbe(true);
          } catch (error: any) {
            const classification = error.code || 'WORKER_EXECUTION_FAILED';
            const networkFailure = ['VPN_REQUIRED', 'NETWORK_OFFLINE', 'IP_ALLOWLIST'].includes(classification);
            const transition = (claim.lease.manualTokenCiphertext || claim.lease.accountTokenCiphertext) && !networkFailure
              ? { state: stateMachine.currentState, nextProbeDelayMs: config.claimIntervalMs }
              : recordProbe(false, classification);
            await client.complete(claim.lease.executionId, {
              executionId: claim.lease.executionId,
              workerId: config.workerId,
              jobId: claim.lease.jobId,
              status: networkFailure ? 'RETRYABLE' : 'FAILED',
              startedAt: claim.lease.startedAt || new Date().toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: 0,
              repositoriesScanned: 0,
              pullRequestsScanned: 0,
              matched: 0,
              approved: 0,
              skipped: 0,
              failed: 1,
              alreadyApproved: 0,
              failureReason: error.message,
            });
            if (!networkFailure) lastLease = null;
            delay = transition.nextProbeDelayMs;
          } finally {
            activeExecutionId = undefined;
          }
        }
      }
    } catch (error: any) {
      reportControlPlaneFailure('work loop', error);
      stateMachine.markControlPlaneOffline();
      delay = Math.min(Math.max(delay * 2, 10_000), 60_000);
    }
    workTimer = setTimeout(workLoop, delay);
  };

  await workLoop();
  await new Promise<void>((resolve) => {
    const stop = () => {
      stopped = true;
      clearInterval(heartbeatTimer);
      clearInterval(updateTimer);
      if (workTimer) clearTimeout(workTimer);
      resolve();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}

const pairArgumentIndex = process.argv.indexOf('--pair-url');
if (pairArgumentIndex >= 0) {
  const value = process.argv[pairArgumentIndex + 1];
  if (!value) throw new Error('--pair-url requires a value');
  await pair(value);
} else {
  await run();
}
