import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SmallvilleBoard } from '../components/generative-agents/SmallvilleBoard';
import { computeAgentVisualState } from '../components/generative-agents/visualStateMachine';
import type { WorkerRecord, WorkerLogEntry } from '../types';

describe('Verification: Job Success / Failure Scenarios & Canvas Runtime Lifecycle', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
      createImageData: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      fillText: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 85 }),
      transform: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      ellipse: vi.fn(),
      roundRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
    }) as any;

    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 600,
      width: 1200,
      height: 600,
      x: 0,
      y: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseWorker: WorkerRecord = {
    id: 'worker-qa-1',
    ownerId: 'owner-1',
    name: 'Worker QA Alpha',
    platform: 'darwin',
    architecture: 'arm64',
    version: '1.4.2',
    state: 'ONLINE',
    publicKey: {} as any,
    pairedAt: '2026-03-30T10:00:00Z',
    lastHeartbeatAt: '2026-03-30T10:05:00Z',
    queueDepth: 0,
  };

  it('Scenario 1: Job Fails -> Worker immediately halts (OFF state), speed=0, movements stop, failure reason rendered', async () => {
    // 1. Initial State: Worker is running an active job
    const runningWorker: WorkerRecord = {
      ...baseWorker,
      activeExecutionId: 'exec-fail-test',
    };

    const activeLog: WorkerLogEntry = {
      id: 'log-active',
      workerId: baseWorker.id,
      executionId: 'exec-fail-test',
      jobId: 'job-1',
      sequence: 1,
      status: 'MATCHING_PR',
      timestamp: '2026-03-30T10:06:00Z',
      prId: 501,
      prTitle: 'feat: dangerous refactoring',
      matchedConditions: [],
    };

    const visualActive = computeAgentVisualState(runningWorker, activeLog, true);
    expect(visualActive.state).toBe('ACTIVE_WORKING');
    expect(visualActive.canMove).toBe(true);

    // 2. Failure Event: Job fails due to CI / API error
    const failedLog: WorkerLogEntry = {
      id: 'log-failed',
      workerId: baseWorker.id,
      executionId: 'exec-fail-test',
      jobId: 'job-1',
      sequence: 2,
      status: 'FAILED',
      timestamp: '2026-03-30T10:06:30Z',
      prId: 501,
      prTitle: 'feat: dangerous refactoring',
      failureReason: 'CI build failed on step: test-integration (exit code 1)',
      matchedConditions: [],
    };

    const visualFailed = computeAgentVisualState(runningWorker, failedLog, false);
    expect(visualFailed.state).toBe('FAILED_OFF');
    expect(visualFailed.canMove).toBe(false);
    expect(visualFailed.errorReason).toBe('CI build failed on step: test-integration (exit code 1)');
    expect(visualFailed.thought).toContain('Job failed: CI build failed on step: test-integration');

    // 3. Render in SmallvilleBoard: Ensure UI reflects FAILED (OFF) state and inspector details
    const onSelectWorker = vi.fn();
    const { rerender } = render(
      <SmallvilleBoard
        workers={[runningWorker]}
        logs={[activeLog]}
        latestLog={activeLog}
        activeExecutionId="exec-fail-test"
        onSelectWorker={onSelectWorker}
      />
    );

    expect(screen.getByText(/Active: 1/)).toBeInTheDocument();

    // Rerender with failed state
    rerender(
      <SmallvilleBoard
        workers={[runningWorker]}
        logs={[activeLog, failedLog]}
        latestLog={failedLog}
        activeExecutionId={null}
        onSelectWorker={onSelectWorker}
      />
    );

    expect(screen.getByText(/Failed \(OFF\): 1/)).toBeInTheDocument();

    // Click on worker in roster to inspect details
    const workerBtn = screen.getByText('Worker QA Alpha');
    await act(async () => {
      fireEvent.click(workerBtn);
    });

    expect(screen.getByText('Lỗi khiến Worker Dừng (OFF)')).toBeInTheDocument();
    expect(
      screen.getByText('CI build failed on step: test-integration (exit code 1)')
    ).toBeInTheDocument();
  });

  it('Scenario 2: Job Succeeds -> Worker continues moving in celebration patrol, canMove=true, celebratory thought rendered', async () => {
    const successWorker: WorkerRecord = { ...baseWorker };

    const approvedLog: WorkerLogEntry = {
      id: 'log-approved',
      workerId: baseWorker.id,
      executionId: 'exec-success-test',
      jobId: 'job-1',
      sequence: 3,
      status: 'APPROVED',
      timestamp: '2026-03-30T10:07:00Z',
      prId: 777,
      prTitle: 'fix: optimize database indexing',
      matchedConditions: ['All criteria met'],
    };

    const visualSuccess = computeAgentVisualState(successWorker, approvedLog, false);
    expect(visualSuccess.state).toBe('SUCCESS_PATROL');
    expect(visualSuccess.canMove).toBe(true);
    expect(visualSuccess.thought).toContain('Approved PR #777! 🎉');

    const mergedLog: WorkerLogEntry = {
      id: 'log-merged',
      workerId: baseWorker.id,
      executionId: 'exec-success-test',
      jobId: 'job-1',
      sequence: 4,
      status: 'MERGED',
      timestamp: '2026-03-30T10:07:30Z',
      prId: 777,
      prTitle: 'fix: optimize database indexing',
      matchedConditions: [],
    };

    const visualMerged = computeAgentVisualState(successWorker, mergedLog, false);
    expect(visualMerged.state).toBe('SUCCESS_PATROL');
    expect(visualMerged.canMove).toBe(true);
    expect(visualMerged.thought).toContain('Auto-merged PR #777! 🚀');

    render(
      <SmallvilleBoard
        workers={[successWorker]}
        logs={[approvedLog, mergedLog]}
        latestLog={mergedLog}
      />
    );

    expect(screen.getByText(/Success: 1/)).toBeInTheDocument();

    const workerBtn = screen.getByText('Worker QA Alpha');
    await act(async () => {
      fireEvent.click(workerBtn);
    });

    expect(screen.getByText('SUCCESS_PATROL')).toBeInTheDocument();
    expect(screen.getByText('Thought Bubble')).toBeInTheDocument();
    expect(screen.getByText(/"Auto-merged PR #777! 🚀"/)).toBeInTheDocument();
    expect(screen.getByText(/fix: optimize database indexing/)).toBeInTheDocument();
  });

  it('Scenario 3: Canvas Performance & Memory Safety -> requestAnimationFrame properly cleaned up on unmount without leak', () => {
    const requestSpy = vi.spyOn(window, 'requestAnimationFrame');
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const { unmount } = render(
      <SmallvilleBoard
        workers={[baseWorker]}
        logs={[]}
      />
    );

    expect(requestSpy).toHaveBeenCalled();
    const callsBeforeUnmount = cancelSpy.mock.calls.length;

    unmount();

    expect(cancelSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });
});
