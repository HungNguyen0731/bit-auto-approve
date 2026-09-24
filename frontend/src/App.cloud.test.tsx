import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { App } from './App';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = url.endsWith('/config')
      ? { serverType: 'cloud', baseUrl: 'https://api.bitbucket.org/2.0', authType: 'basic', hasToken: false, skipSslVerification: false, timeoutMs: 15000 }
      : url.endsWith('/status')
      ? { isRunning: false, activeJobsCount: 0, totalJobsCount: 0, vpnConnected: false, bitbucketStatus: 'UNCONFIGURED', totalApprovedCount: 0, uptimeSeconds: 0 }
      : [];
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

describe('Cloud-only application gate', () => {
  it('keeps dashboard locked until a live Cloud profile is verified', async () => {
    render(<App />);
    expect(await screen.findByText('Bitbucket PR Auto-Approver')).toBeInTheDocument();
    expect(screen.getByText('Bitbucket Cloud v2.0')).toBeInTheDocument();
    expect(screen.queryByText('Overview & Realtime Logs')).not.toBeInTheDocument();
  });

  it('loads configuration from the backend without offline sample data', async () => {
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/config'), expect.any(Object)));
    expect(screen.queryByText(/Demo Mode/i)).not.toBeInTheDocument();
  });
});
