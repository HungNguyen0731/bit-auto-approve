import type { WorkerState } from '@bitbucket-pr-approver/shared';

export interface ConnectivityTransition {
  state: WorkerState;
  event?: 'PAUSED_VPN' | 'RESUMED';
  nextProbeDelayMs: number;
}

export class ConnectivityStateMachine {
  private state: WorkerState = 'STARTING';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private backoffIndex = 0;
  private readonly backoff = [5_000, 10_000, 20_000, 40_000, 60_000];

  get currentState(): WorkerState {
    return this.state;
  }

  recordProbe(success: boolean, classification?: string): ConnectivityTransition {
    if (success) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses++;
      this.backoffIndex = 0;
      if (
        this.state === 'STARTING' ||
        this.state === 'ERROR_AUTH' ||
        this.state === 'OFFLINE_CONTROL_PLANE'
      ) {
        this.state = 'ONLINE';
        return { state: this.state, nextProbeDelayMs: 5_000 };
      }
      if (this.state === 'PAUSED_VPN' && this.consecutiveSuccesses >= 2) {
        this.state = 'ONLINE';
        return { state: this.state, event: 'RESUMED', nextProbeDelayMs: 5_000 };
      }
      return { state: this.state, nextProbeDelayMs: 5_000 };
    }

    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    const recoverable = ['VPN_REQUIRED', 'NETWORK_OFFLINE', 'IP_ALLOWLIST'].includes(
      classification || ''
    );
    if (recoverable && this.consecutiveFailures >= 2 && this.state !== 'PAUSED_VPN') {
      this.state = 'PAUSED_VPN';
      return {
        state: this.state,
        event: 'PAUSED_VPN',
        nextProbeDelayMs: this.nextBackoff(),
      };
    }
    if (!recoverable) this.state = 'ERROR_AUTH';
    return { state: this.state, nextProbeDelayMs: this.nextBackoff() };
  }

  markControlPlaneOffline(): WorkerState {
    this.state = 'OFFLINE_CONTROL_PLANE';
    return this.state;
  }

  private nextBackoff(): number {
    const base = this.backoff[Math.min(this.backoffIndex++, this.backoff.length - 1)];
    return Math.round(base * (1 + Math.random() * 0.2));
  }
}
