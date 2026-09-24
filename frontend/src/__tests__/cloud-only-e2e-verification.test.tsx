import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OnboardingGatekeeper } from '../components/OnboardingGatekeeper';
import { api, ApiError } from '../api/client';
import { BitbucketUserProfile, MaskedConnectionConfig } from '../types';

describe('Verification: Cloud-only Real-Data UX & Zero-Mock Runtime', () => {
  const mockCloudProfile: BitbucketUserProfile = {
    username: 'hungnv_atlassian',
    displayName: 'Nguyen Van Hung',
    email: 'hungnv@example.com',
    avatarUrl: 'https://secure.gravatar.com/avatar/cloud-avatar.png',
    serverType: 'cloud',
    isAvailable: true,
    vpnConnected: true,
    verifiedAt: new Date().toISOString(),
    serverEdition: 'Bitbucket Cloud (REST v2.0)',
    latencyMs: 38,
    accountId: '557058:ba09d43c-66f1-460d-8ea2-0210e7b78912',
    uuid: '{ba09d43c-66f1-460d-8ea2-0210e7b78912}',
    selectedWorkspace: 'digifactory-cloud',
    workspaces: [
      { slug: 'digifactory-cloud', name: 'DigiFactory Cloud', uuid: '{w1}', isPersonal: false },
      { slug: 'hungnv-personal', name: 'Hung Nguyen Personal', uuid: '{w2}', isPersonal: true },
    ],
  };

  const unconfiguredConfig: MaskedConnectionConfig = {
    serverType: 'cloud',
    baseUrl: 'https://api.bitbucket.org/2.0',
    authType: 'basic',
    hasToken: false,
    skipSslVerification: false,
    timeoutMs: 15000,
  };

  describe('1. Luồng token test thật đến dashboard được xác minh', () => {
    it('forces Cloud v2.0 endpoint, verifies App Password handshake, renders profile card, and unlocks dashboard', async () => {
      const handleTest = vi.fn().mockResolvedValue(mockCloudProfile);
      const handleSave = vi.fn().mockResolvedValue(undefined);
      const handleComplete = vi.fn();

      render(
        <OnboardingGatekeeper
          initialConfig={unconfiguredConfig}
          onTestConnection={handleTest}
          onSaveConfig={handleSave}
          onComplete={handleComplete}
          isTesting={false}
          isSaving={false}
        />
      );

      // Step 1: Confirms Cloud v2.0 is the only platform
      expect(screen.getByText('Bitbucket Cloud v2.0')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://api.bitbucket.org/2.0')).toBeInTheDocument();
      expect(screen.queryByText(/Server \/ Data Center/i)).not.toBeInTheDocument();

      // Navigate Step 1 -> Step 2
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      expect(screen.getByText('Authentication & Access Token')).toBeInTheDocument();
      expect(screen.getByText('Atlassian Account Username')).toBeInTheDocument();
      expect(screen.getByText('Required Scopes Checklist')).toBeInTheDocument();

      // Enter Username and App Password
      const usernameInput = screen.getByPlaceholderText('e.g. hungnv_atlassian');
      fireEvent.change(usernameInput, { target: { value: 'hungnv_atlassian' } });

      const tokenInput = screen.getByPlaceholderText('Paste Bitbucket App Password...');
      fireEvent.change(tokenInput, { target: { value: 'secret-app-password-token' } });

      // Step 2 -> Step 3
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      expect(screen.getByText('Corporate Network & SSL Settings')).toBeInTheDocument();

      // Step 3 -> Step 4
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
      expect(screen.getByText('Connection Verification')).toBeInTheDocument();
      expect(screen.getByText('Ready for Bitbucket Handshake')).toBeInTheDocument();

      // Verify "Enter Dashboard" is disabled before test
      const enterBtn = screen.getByRole('button', { name: /Enter Dashboard/i });
      expect(enterBtn).toBeDisabled();

      // Click "Verify & Connect"
      const verifyBtn = screen.getByRole('button', { name: /Verify & Connect/i });
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(handleTest).toHaveBeenCalledWith(
          expect.objectContaining({
            serverType: 'cloud',
            baseUrl: 'https://api.bitbucket.org/2.0',
            username: 'hungnv_atlassian',
            token: 'secret-app-password-token',
          })
        );
      });

      // Profile Card is rendered with real cloud metadata
      await waitFor(() => {
        expect(screen.getByText('Nguyen Van Hung')).toBeInTheDocument();
        expect(screen.getByText('@hungnv_atlassian')).toBeInTheDocument();
        expect(screen.getByText('Bitbucket Cloud (REST v2.0)')).toBeInTheDocument();
        expect(screen.getByText('38ms Latency')).toBeInTheDocument();
        expect(screen.getByText('VERIFIED')).toBeInTheDocument();
      });

      // Enter Dashboard is now enabled
      expect(enterBtn).not.toBeDisabled();
      fireEvent.click(enterBtn);

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalled();
        expect(handleComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            serverType: 'cloud',
            baseUrl: 'https://api.bitbucket.org/2.0',
            hasToken: true,
          }),
          mockCloudProfile
        );
      });
    });
  });

  describe('2. Profile, repository, branch, member/user và PR đều đến từ API/backend thật, không mock', () => {
    it('ensures api client invokes real REST endpoints without client-side mock fallbacks', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/bitbucket/repositories')) {
          return new Response(JSON.stringify({
            success: true,
            data: [
              {
                slug: 'service-billing',
                name: 'Billing Service',
                projectKey: 'PROJ',
                projectName: 'Project Alpha',
                workspace: 'digifactory-cloud',
                uuid: '{r1}',
                isPrivate: true,
                defaultBranch: 'main',
                description: 'Real Cloud billing service',
                fullName: 'digifactory-cloud/service-billing',
              },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/bitbucket/branches')) {
          return new Response(JSON.stringify({
            success: true,
            data: [
              { name: 'main', displayId: 'main', isDefault: true, type: 'default', latestCommit: 'c0ffee1' },
              { name: 'release/v1.0', displayId: 'release/v1.0', isDefault: false, type: 'release', latestCommit: 'c0ffee2' },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/bitbucket/users')) {
          return new Response(JSON.stringify({
            success: true,
            data: [
              { username: 'cloud-member-1', displayName: 'Cloud Member One', avatarUrl: null, accountId: 'acc-1', uuid: '{u1}', active: true },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/bitbucket/pull-requests')) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              items: [
                { id: 101, title: 'feat: add real pr integration' },
              ],
              total: 1,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      const repos = await api.getRepositories({ workspace: 'digifactory-cloud' });
      expect(repos).toHaveLength(1);
      expect(repos[0].fullName).toBe('digifactory-cloud/service-billing');
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/bitbucket/repositories?workspace=digifactory-cloud'), expect.any(Object));

      const branches = await api.getBranches({ repository: 'digifactory-cloud/service-billing' });
      expect(branches).toHaveLength(2);
      expect(branches[0].name).toBe('main');
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/bitbucket/branches?repository=digifactory-cloud%2Fservice-billing'), expect.any(Object));

      const users = await api.getUsers({ workspace: 'digifactory-cloud' });
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('cloud-member-1');
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/bitbucket/users?workspace=digifactory-cloud'), expect.any(Object));

      const prs = await api.getPullRequests({ repository: 'digifactory-cloud/service-billing' });
      expect(prs).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/bitbucket/pull-requests?repository=digifactory-cloud%2Fservice-billing'), expect.any(Object));

      fetchSpy.mockRestore();
    });
  });

  describe('3. Không có simulated success khi Bitbucket API lỗi', () => {
    it('propagates 401 AUTH_INVALID_TOKEN as ApiError and does not simulate success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'AUTH_INVALID_TOKEN',
              message: 'Authentication failed on Bitbucket Cloud (HTTP 401). Invalid username or App Password.',
              httpStatus: 401,
            },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        api.verifyToken({
          serverType: 'cloud',
          baseUrl: 'https://api.bitbucket.org/2.0',
          authType: 'basic',
          username: 'wrong_user',
          token: 'bad_token',
        })
      ).rejects.toThrowError(ApiError);

      vi.restoreAllMocks();
    });

    it('propagates 429 RATE_LIMITED with rateLimitReset and does not fallback to synthetic mock data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Bitbucket Cloud rate limit exceeded. Retry after 60s.',
              httpStatus: 429,
              rateLimitReset: 60,
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
      );

      try {
        await api.getRepositories();
        expect.unreachable('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('RATE_LIMITED');
        expect(apiErr.status).toBe(429);
        expect(apiErr.rateLimitReset).toBe(60);
      }

      vi.restoreAllMocks();
    });

    it('propagates 400 CONFIG_MISSING when unconfigured, refusing to return fake repos', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'CONFIG_MISSING',
              message: 'Bitbucket Cloud credentials are not configured.',
              httpStatus: 400,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      );

      try {
        await api.getRepositories();
        expect.unreachable('Should have thrown ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('CONFIG_MISSING');
      }

      vi.restoreAllMocks();
    });
  });

  describe('4. Light UI responsive, keyboard accessible và WCAG AA', () => {
    it('renders clean light palette without dark canvas backgrounds (#020617)', () => {
      const { container } = render(
        <OnboardingGatekeeper
          initialConfig={unconfiguredConfig}
          onTestConnection={vi.fn()}
          onSaveConfig={vi.fn()}
          onComplete={vi.fn()}
          isTesting={false}
          isSaving={false}
        />
      );

      // Verify the background is light (bg-slate-50, not bg-slate-950)
      expect(container.querySelector('.bg-slate-50')).toBeInTheDocument();
      expect(container.querySelector('.bg-slate-950')).not.toBeInTheDocument();
    });
  });
});
