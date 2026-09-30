import { describe, expect, it } from 'vitest';
import { computeAgentVisualState } from '../components/generative-agents/visualStateMachine';
import type { WorkerLogEntry, WorkerRecord } from '../types';

describe('computeAgentVisualState', () => {
  const baseWorker: WorkerRecord = {
    id: 'worker-1',
    ownerId: 'owner-1',
    name: 'MacMini Worker',
    platform: 'darwin',
    architecture: 'arm64',
    version: '1.4.2',
    state: 'ONLINE',
    publicKey: {} as any,
    pairedAt: '2026-03-30T10:00:00Z',
    lastHeartbeatAt: '2026-03-30T10:05:00Z',
    queueDepth: 0,
  };

  it('1. Returns FAILED_OFF when worker state is OFFLINE or ERROR with canMove=false', () => {
    const offlineWorker: WorkerRecord = { ...baseWorker, state: 'OFFLINE' };
    const res = computeAgentVisualState(offlineWorker);

    expect(res.state).toBe('FAILED_OFF');
    expect(res.canMove).toBe(false);
    expect(res.thought).toContain('Worker offline');
    expect(res.errorReason).toContain('Worker offline');
  });

  it('2. Returns FAILED_OFF when worker state is ERROR_AUTH with authentication failure message', () => {
    const errorWorker: WorkerRecord = { ...baseWorker, state: 'ERROR_AUTH' };
    const res = computeAgentVisualState(errorWorker);

    expect(res.state).toBe('FAILED_OFF');
    expect(res.canMove).toBe(false);
    expect(res.thought).toContain('Authentication failed');
  });

  it('3. Returns FAILED_OFF when latestLog status is FAILED, preserving error reason and stopping movement', () => {
    const failedLog: WorkerLogEntry = {
      id: 'log-1',
      workerId: 'worker-1',
      executionId: 'exec-1',
      jobId: 'job-1',
      sequence: 3,
      status: 'FAILED',
      timestamp: '2026-03-30T10:05:30Z',
      prId: 42,
      prTitle: 'feat: new payment gateway',
      failureReason: 'Build failed on step npm run test (exit code 1)',
      matchedConditions: [],
    };

    const res = computeAgentVisualState(baseWorker, failedLog);

    expect(res.state).toBe('FAILED_OFF');
    expect(res.canMove).toBe(false);
    expect(res.thought).toContain('Job failed: Build failed on step npm run test');
    expect(res.errorReason).toBe('Build failed on step npm run test (exit code 1)');
    expect(res.currentPr?.id).toBe(42);
  });

  it('4. Returns PAUSED_VPN when worker state is PAUSED_VPN with canMove=false', () => {
    const vpnWorker: WorkerRecord = { ...baseWorker, state: 'PAUSED_VPN' };
    const res = computeAgentVisualState(vpnWorker);

    expect(res.state).toBe('PAUSED_VPN');
    expect(res.canMove).toBe(false);
    expect(res.thought).toContain('Waiting for VPN connection');
  });

  it('5. Returns ACTIVE_WORKING when worker has activeExecutionId or log is in progress', () => {
    const activeWorker: WorkerRecord = {
      ...baseWorker,
      activeExecutionId: 'exec-active-1',
    };
    const scanLog: WorkerLogEntry = {
      id: 'log-2',
      workerId: 'worker-1',
      executionId: 'exec-active-1',
      jobId: 'job-1',
      sequence: 1,
      status: 'SCANNING_REPO',
      timestamp: '2026-03-30T10:06:00Z',
      repository: 'DigiFactory/warehouse',
      matchedConditions: [],
    };

    const res = computeAgentVisualState(activeWorker, scanLog);

    expect(res.state).toBe('ACTIVE_WORKING');
    expect(res.canMove).toBe(true);
    expect(res.thought).toContain('Scanning repo DigiFactory/warehouse');
  });

  it('6. Returns ACTIVE_WORKING with PR evaluation details during MATCHING_PR or CHECKING_CI', () => {
    const matchLog: WorkerLogEntry = {
      id: 'log-3',
      workerId: 'worker-1',
      executionId: 'exec-active-1',
      jobId: 'job-1',
      sequence: 2,
      status: 'MATCHING_PR',
      timestamp: '2026-03-30T10:06:10Z',
      prId: 99,
      prTitle: 'fix(auth): update session cookie expiry',
      matchedConditions: ['author != bot'],
    };

    const res = computeAgentVisualState(baseWorker, matchLog, true);

    expect(res.state).toBe('ACTIVE_WORKING');
    expect(res.canMove).toBe(true);
    expect(res.thought).toContain('PR #99');
    expect(res.currentPr?.id).toBe(99);
  });

  it('7. Returns SUCCESS_PATROL with celebrations when latestLog is APPROVED or MERGED', () => {
    const approvedLog: WorkerLogEntry = {
      id: 'log-4',
      workerId: 'worker-1',
      executionId: 'exec-done-1',
      jobId: 'job-1',
      sequence: 5,
      status: 'APPROVED',
      timestamp: '2026-03-30T10:07:00Z',
      prId: 88,
      prTitle: 'refactor: simplify combobox',
      matchedConditions: ['All rules matched'],
    };

    const res = computeAgentVisualState(baseWorker, approvedLog);

    expect(res.state).toBe('SUCCESS_PATROL');
    expect(res.canMove).toBe(true);
    expect(res.thought).toContain('Approved PR #88! 🎉');
  });

  it('8. Returns SUCCESS_PATROL with auto-merge details when latestLog is MERGED', () => {
    const mergedLog: WorkerLogEntry = {
      id: 'log-5',
      workerId: 'worker-1',
      executionId: 'exec-done-2',
      jobId: 'job-1',
      sequence: 6,
      status: 'MERGED',
      timestamp: '2026-03-30T10:08:00Z',
      prId: 77,
      prTitle: 'chore: bump dependencies',
      matchedConditions: [],
    };

    const res = computeAgentVisualState(baseWorker, mergedLog);

    expect(res.state).toBe('SUCCESS_PATROL');
    expect(res.canMove).toBe(true);
    expect(res.thought).toContain('Auto-merged PR #77! 🚀');
  });

  it('9. Returns IDLE with queue depth when worker is ONLINE with no active jobs', () => {
    const idleWorker: WorkerRecord = { ...baseWorker, queueDepth: 4 };
    const res = computeAgentVisualState(idleWorker);

    expect(res.state).toBe('IDLE');
    expect(res.canMove).toBe(true);
    expect(res.thought).toContain('Ready for Bitbucket PR jobs (Queue: 4)');
  });
});
