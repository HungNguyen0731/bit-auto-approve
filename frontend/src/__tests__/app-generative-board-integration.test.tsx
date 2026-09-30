import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../App';

describe('App - Generative Agents Board Integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/auth/session')) {
        return new Response(
          JSON.stringify({ success: true, data: { authenticated: true, authEnabled: true } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              serverType: 'cloud',
              baseUrl: 'https://api.bitbucket.org/2.0',
              authType: 'basic',
              hasToken: true,
              workspace: 'test-workspace',
              skipSslVerification: false,
              timeoutMs: 15000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.endsWith('/api/status')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              isRunning: true,
              activeJobsCount: 1,
              totalJobsCount: 1,
              vpnConnected: true,
              bitbucketStatus: 'CONNECTED',
              totalApprovedCount: 5,
              uptimeSeconds: 3600,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('/api/config/test') || url.includes('/api/restore-session')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              valid: true,
              user: {
                username: 'hungnv',
                displayName: 'Hung Nguyen',
                serverType: 'cloud',
                isAvailable: true,
                vpnConnected: true,
                verifiedAt: new Date().toISOString(),
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.endsWith('/api/jobs')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'job-1',
                name: 'Auto Approve PRs',
                enabled: true,
                intervalSeconds: 60,
                dryRun: false,
                rules: {
                  repositories: ['repo-a'],
                  authorWhitelist: [],
                  excludeSelf: true,
                  targetBranches: ['main'],
                  ignoreDrafts: true,
                  ignoreWithConflicts: true,
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.endsWith('/api/workers')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'worker-real-1',
                ownerId: 'owner-1',
                name: 'Mac Mini Worker',
                platform: 'darwin',
                architecture: 'arm64',
                version: '1.4.2',
                state: 'ONLINE',
                publicKey: {} as any,
                pairedAt: new Date().toISOString(),
                lastHeartbeatAt: new Date().toISOString(),
                queueDepth: 0,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('/api/workers/logs')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'log-1',
                workerId: 'worker-real-1',
                executionId: 'exec-1',
                jobId: 'job-1',
                sequence: 1,
                status: 'APPROVED',
                prId: 101,
                prTitle: 'feat: add generative board',
                repository: 'repo-a',
                matchedConditions: ['author_ok'],
                timestamp: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('/api/logs')) {
        return new Response(
          JSON.stringify({ success: true, data: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }));
  });

  it('renders Generative Board tab and Dashboard preview card when authenticated', async () => {
    render(<App />);

    // Wait for session restore and dashboard load
    await waitFor(() => {
      expect(screen.getByTestId('tab-generative-board')).toBeInTheDocument();
    });

    // Check dashboard preview card
    expect(screen.getByText('Generative Agents Town Live Board')).toBeInTheDocument();
    expect(screen.getByText(/2D Realtime/i)).toBeInTheDocument();

    // Check canvas element inside board
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('navigates to the full 2D Generative Board tab and renders controls', async () => {
    render(<App />);

    const boardTabBtn = await screen.findByTestId('tab-generative-board');
    fireEvent.click(boardTabBtn);

    // Full board title
    await waitFor(() => {
      expect(screen.getByText(/Generative Agents Smallville Board/i)).toBeInTheDocument();
    });

    // Simulation & Visual controls
    expect(screen.getByText(/Làm mới dữ liệu/i)).toBeInTheDocument();
    expect(screen.getByText(/Cấu hình Mac Worker/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Smallville 2D/i).length).toBeGreaterThan(0);
  });
});
