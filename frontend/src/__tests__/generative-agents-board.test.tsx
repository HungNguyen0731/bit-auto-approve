import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SmallvilleBoard } from '../components/generative-agents/SmallvilleBoard';
import type { WorkerLogEntry, WorkerRecord } from '../types';

describe('SmallvilleBoard Component', () => {
  beforeEach(() => {
    // Mock Canvas 2D context for jsdom
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
      measureText: vi.fn().mockReturnValue({ width: 80 }),
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

  const mockWorkers: WorkerRecord[] = [
    {
      id: 'worker-1',
      ownerId: 'owner-1',
      name: 'Agent Alpha (John Lin)',
      platform: 'darwin',
      architecture: 'arm64',
      version: '1.4.2',
      state: 'ONLINE',
      publicKey: {} as any,
      pairedAt: '2026-03-30T10:00:00Z',
      lastHeartbeatAt: '2026-03-30T10:05:00Z',
      activeExecutionId: 'exec-1',
      queueDepth: 2,
    },
    {
      id: 'worker-2',
      ownerId: 'owner-1',
      name: 'Agent Beta (Mei Lin)',
      platform: 'darwin',
      architecture: 'arm64',
      version: '1.4.2',
      state: 'ONLINE',
      publicKey: {} as any,
      pairedAt: '2026-03-30T10:00:00Z',
      lastHeartbeatAt: '2026-03-30T10:05:00Z',
      queueDepth: 0,
    },
    {
      id: 'worker-3',
      ownerId: 'owner-1',
      name: 'Agent Gamma (Klaus)',
      platform: 'linux',
      architecture: 'x64',
      version: '1.4.0',
      state: 'ERROR',
      publicKey: {} as any,
      pairedAt: '2026-03-30T10:00:00Z',
      queueDepth: 1,
    },
  ];

  const mockLogs: WorkerLogEntry[] = [
    {
      id: 'log-1',
      workerId: 'worker-1',
      executionId: 'exec-1',
      jobId: 'job-1',
      sequence: 2,
      status: 'MATCHING_PR',
      timestamp: '2026-03-30T10:05:10Z',
      repository: 'DigiFactory/scheduler',
      prId: 201,
      prTitle: 'feat: add shift pattern algorithm',
      matchedConditions: ['author != bot'],
    },
    {
      id: 'log-2',
      workerId: 'worker-2',
      executionId: 'exec-2',
      jobId: 'job-2',
      sequence: 5,
      status: 'APPROVED',
      timestamp: '2026-03-30T10:05:20Z',
      repository: 'DigiFactory/warehouse',
      prId: 199,
      prTitle: 'fix: barcode scanner calibration',
      matchedConditions: ['All checks passed'],
    },
    {
      id: 'log-3',
      workerId: 'worker-3',
      executionId: 'exec-3',
      jobId: 'job-3',
      sequence: 1,
      status: 'FAILED',
      timestamp: '2026-03-30T10:05:30Z',
      repository: 'DigiFactory/core-auth',
      prId: 155,
      prTitle: 'security: update token secret key',
      failureReason: 'Rate limit exceeded on Bitbucket Cloud API',
      matchedConditions: [],
    },
  ];

  it('1. Renders the Generative Agents Smallville Board header and controls', () => {
    render(<SmallvilleBoard workers={mockWorkers} logs={mockLogs} />);

    expect(screen.getByText('Generative Agents Town Board')).toBeInTheDocument();
    expect(screen.getByText('Smallville 2D')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    expect(screen.getByLabelText('Reset view')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle thought bubbles')).toBeInTheDocument();
  });

  it('2. Correctly counts active, success, and failed workers', () => {
    render(
      <SmallvilleBoard
        workers={mockWorkers}
        logs={mockLogs}
        latestLog={mockLogs[0]}
      />
    );

    // Active button count
    expect(screen.getByText(/Active: 1/)).toBeInTheDocument();
    // Success button count
    expect(screen.getByText(/Success: 1/)).toBeInTheDocument();
    // Failed (OFF) button count
    expect(screen.getByText(/Failed \(OFF\): 1/)).toBeInTheDocument();
  });

  it('3. Renders the agent roster at the bottom bar with worker names', () => {
    render(<SmallvilleBoard workers={mockWorkers} logs={mockLogs} />);

    expect(screen.getByText('Agent Alpha (John Lin)')).toBeInTheDocument();
    expect(screen.getByText('Agent Beta (Mei Lin)')).toBeInTheDocument();
    expect(screen.getByText('Agent Gamma (Klaus)')).toBeInTheDocument();
  });

  it('4. Clicking a worker in the roster opens the Worker Inspector Drawer', async () => {
    const onSelectWorker = vi.fn();
    render(
      <SmallvilleBoard
        workers={mockWorkers}
        logs={mockLogs}
        onSelectWorker={onSelectWorker}
      />
    );

    const alphaButton = screen.getByText('Agent Alpha (John Lin)');
    await act(async () => {
      fireEvent.click(alphaButton);
    });

    expect(onSelectWorker).toHaveBeenCalledWith('worker-1');
    expect(screen.getByText('Thought Bubble')).toBeInTheDocument();
    expect(screen.getByText(/Đang duyệt Pull Request/)).toBeInTheDocument();
    expect(screen.getAllByText(/shift pattern algorithm/).length).toBeGreaterThanOrEqual(1);
  });

  it('5. Failed worker inspector displays failure reason and OFF state details', async () => {
    render(<SmallvilleBoard workers={mockWorkers} logs={mockLogs} />);

    const gammaButton = screen.getByText('Agent Gamma (Klaus)');
    await act(async () => {
      fireEvent.click(gammaButton);
    });

    expect(screen.getByText('Lỗi khiến Worker Dừng (OFF)')).toBeInTheDocument();
    expect(
      screen.getByText('Rate limit exceeded on Bitbucket Cloud API')
    ).toBeInTheDocument();
  });

  it('6. Allows toggling display controls (thought bubbles, landmark labels)', () => {
    render(<SmallvilleBoard workers={mockWorkers} logs={mockLogs} />);

    const thoughtBtn = screen.getByLabelText('Toggle thought bubbles');
    fireEvent.click(thoughtBtn);
    expect(thoughtBtn).toBeInTheDocument();

    const labelBtn = screen.getByLabelText('Toggle landmark labels');
    fireEvent.click(labelBtn);
    expect(labelBtn).toBeInTheDocument();
  });

  it('7. Automatically enables Demo Simulation Mode when workers list is empty', async () => {
    render(<SmallvilleBoard workers={[]} logs={[]} />);

    const demoBtn = screen.getByTitle('Chuyển chế độ hiển thị mẫu với đủ 5 trạng thái');
    expect(demoBtn).toBeInTheDocument();
    expect(screen.getByText('Worker Alpha (John Lin)')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(demoBtn);
    });
    expect(screen.getByText('Simulation Active')).toBeInTheDocument();
  });

  it('8. Properly cleans up requestAnimationFrame when unmounted', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<SmallvilleBoard workers={mockWorkers} />);

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
