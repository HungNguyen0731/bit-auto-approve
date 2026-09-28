import crypto from 'node:crypto';
import type { BitbucketAccount, AccountStore } from './account-store.js';

interface OAuthTokens { access_token: string; refresh_token?: string; expires_in: number }
interface OAuthFlow { sessionHash: string; accountId?: string; expiresAt: number; status: 'pending' | 'exchanging' | 'complete' | 'failed'; error?: string; account?: BitbucketAccount }

const FLOW_TTL_MS = 10 * 60_000;
const REFRESH_LEEWAY_MS = 2 * 60_000;

export class BitbucketOAuth {
  private readonly flows = new Map<string, OAuthFlow>();
  private readonly refreshes = new Map<string, Promise<void>>();
  private readonly clientId = process.env.BITBUCKET_OAUTH_CLIENT_ID;
  private readonly clientSecret = process.env.BITBUCKET_OAUTH_CLIENT_SECRET;
  private readonly origin = process.env.CONTROL_PLANE_ORIGIN;

  constructor(private readonly accounts: AccountStore) {}

  get configured(): boolean { return Boolean(this.clientId && this.clientSecret && this.origin?.startsWith('https://')); }

  get redirectUri(): string {
    if (!this.configured) throw this.error('Bitbucket OAuth is not configured on the server', 'OAUTH_NOT_CONFIGURED', 503);
    return `${this.origin!.replace(/\/$/, '')}/api/accounts/oauth/callback`;
  }

  start(sessionHash: string, accountId?: string): { flowId: string; authorizeUrl: string } {
    if (!this.configured) throw this.error('Bitbucket OAuth is not configured on the server', 'OAUTH_NOT_CONFIGURED', 503);
    if (accountId && this.accounts.get(accountId)?.credentialSource !== 'oauth') {
      throw this.error('OAuth account not found', 'ACCOUNT_NOT_FOUND', 404);
    }
    for (const [key, flow] of this.flows) if (flow.expiresAt <= Date.now()) this.flows.delete(key);
    const flowId = crypto.randomBytes(32).toString('base64url');
    this.flows.set(flowId, { sessionHash, accountId, expiresAt: Date.now() + FLOW_TTL_MS, status: 'pending' });
    const url = new URL('https://bitbucket.org/site/oauth2/authorize');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('state', flowId);
    return { flowId, authorizeUrl: url.toString() };
  }

  status(flowId: string, sessionHash: string): { status: OAuthFlow['status']; error?: string; account?: BitbucketAccount } {
    const flow = this.flows.get(flowId);
    if (!flow || flow.sessionHash !== sessionHash || flow.expiresAt <= Date.now()) {
      throw this.error('OAuth connection expired. Try again.', 'OAUTH_FLOW_EXPIRED', 404);
    }
    return { status: flow.status, error: flow.error, account: flow.account };
  }

  async callback(state: string, isSessionActive: (hash: string) => boolean, code?: string, denied?: string): Promise<boolean> {
    const flow = this.flows.get(state);
    if (!flow || flow.status !== 'pending' || flow.expiresAt <= Date.now() || !isSessionActive(flow.sessionHash)) {
      throw this.error('OAuth connection expired or was already used', 'OAUTH_FLOW_EXPIRED', 400);
    }
    flow.status = 'exchanging'; // Consume state before any network request.
    if (denied || !code) { flow.status = 'failed'; flow.error = 'Bitbucket authorization was cancelled'; return false; }
    try {
      const tokens = await this.requestTokens({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
      const profileResponse = await fetch('https://api.bitbucket.org/2.0/user', {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!profileResponse.ok) throw this.error('Unable to verify Bitbucket identity', 'OAUTH_IDENTITY_FAILED', 502);
      const profile = await profileResponse.json() as { uuid?: string; display_name?: string; nickname?: string };
      if (!profile.uuid || !tokens.refresh_token) throw this.error('Bitbucket did not return an identity or refresh token', 'OAUTH_RESPONSE_INVALID', 502);
      const account = this.accounts.saveOAuth({
        id: flow.accountId, name: profile.display_name || profile.nickname || 'Bitbucket account',
        bitbucketUuid: profile.uuid, accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token, expiresAt: this.expiry(tokens.expires_in),
      });
      flow.account = account;
      flow.status = 'complete';
      return true;
    } catch (error) {
      flow.status = 'failed';
      flow.error = error instanceof Error ? error.message : 'Bitbucket connection failed';
      return false;
    }
  }

  async getWorkerCredential(id: string): Promise<{ account: BitbucketAccount; token: string }> {
    const account = this.accounts.get(id);
    if (!account) throw this.error('Bitbucket account not found', 'ACCOUNT_NOT_FOUND', 404);
    if (account.credentialSource !== 'oauth') return this.accounts.getCredential(id);
    if (!account.expiresAt || Date.parse(account.expiresAt) <= Date.now() + REFRESH_LEEWAY_MS) {
      let pending = this.refreshes.get(id);
      if (!pending) {
        pending = this.refresh(id).finally(() => this.refreshes.delete(id));
        this.refreshes.set(id, pending);
      }
      await pending;
    }
    return this.accounts.getCredential(id);
  }

  private async refresh(id: string): Promise<void> {
    try {
      const tokens = await this.requestTokens({ grant_type: 'refresh_token', refresh_token: this.accounts.getOAuthRefreshToken(id) });
      if (!tokens.refresh_token) throw this.error('Bitbucket did not rotate the refresh token', 'OAUTH_RESPONSE_INVALID', 502);
      this.accounts.rotateOAuthTokens(id, tokens.access_token, tokens.refresh_token, this.expiry(tokens.expires_in));
    } catch {
      throw this.error('Bitbucket session expired. Reconnect this account before running its jobs.', 'OAUTH_RECONNECT_REQUIRED', 409);
    }
  }

  private async requestTokens(fields: Record<string, string>): Promise<OAuthTokens> {
    const response = await fetch('https://bitbucket.org/site/oauth2/access_token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw this.error('Bitbucket OAuth token exchange failed', 'OAUTH_TOKEN_FAILED', 502);
    const tokens = await response.json() as OAuthTokens;
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
      throw this.error('Bitbucket OAuth response is incomplete', 'OAUTH_RESPONSE_INVALID', 502);
    }
    return tokens;
  }

  private expiry(seconds: number): string { return new Date(Date.now() + seconds * 1000).toISOString(); }
  private error(message: string, code: string, statusCode: number): Error {
    return Object.assign(new Error(message), { code, statusCode });
  }
}
