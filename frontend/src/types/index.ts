export type BitbucketServerType = 'cloud' | 'server'; // 'server' deprecated in v2 Cloud-only standard
export type BitbucketAuthType = 'basic' | 'bearer'; // 'basic' for App Passwords (recommended for Cloud), 'bearer' for access tokens

export interface BitbucketWorkspaceMeta {
  slug: string;
  name: string;
  uuid: string;
  avatarUrl?: string;
  isPersonal?: boolean;
}

export interface BitbucketConnectionConfig {
  serverType: BitbucketServerType;
  baseUrl: string; // Defaults to https://api.bitbucket.org/2.0
  authType: BitbucketAuthType;
  token?: string; // Bitbucket Cloud App Password
  username?: string; // Atlassian account email / username
  workspace?: string; // Active Bitbucket Cloud workspace slug
  skipSslVerification?: boolean; // Deprecated, kept for backward compatibility
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface MaskedConnectionConfig {
  serverType: BitbucketServerType;
  baseUrl: string;
  authType: BitbucketAuthType;
  username?: string;
  workspace?: string;
  hasToken: boolean;
  tokenPreview?: string;
  skipSslVerification: boolean;
  proxyUrl?: string;
  timeoutMs: number;
}

export interface BitbucketUserProfile {
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  serverType: BitbucketServerType;
  isAvailable: boolean;
  vpnConnected: boolean;
  verifiedAt: string;
  serverEdition?: string;
  latencyMs?: number;
  accountId?: string;
  uuid?: string;
  selectedWorkspace?: string;
  workspaces?: BitbucketWorkspaceMeta[];
}

export interface RepositoryRef {
  projectOrWorkspace: string;
  slug: string;
}

export interface PullRequestUser {
  username: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
}

export interface PullRequestReviewer {
  user: PullRequestUser;
  status: 'APPROVED' | 'UNAPPROVED' | 'NEEDS_WORK';
  isApproved: boolean;
}

export interface PullRequestBranch {
  name: string;
  refId: string;
  commitHash?: string;
}

export interface PullRequest {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED';
  author: PullRequestUser;
  repository: RepositoryRef;
  sourceBranch: PullRequestBranch;
  targetBranch: PullRequestBranch;
  reviewers: PullRequestReviewer[];
  isDraft: boolean;
  hasConflicts?: boolean;
  buildStatus?: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'UNKNOWN';
  createdDate: string;
  updatedDate: string;
  htmlUrl: string;
}

export interface JobFilterRules {
  repositories: string[];
  authorWhitelist: string[];
  authorBlacklist?: string[];
  excludeSelf: boolean;
  targetBranches: string[];
  sourceBranches?: string[];
  titleKeywordsInclude?: string[];
  titleKeywordsExclude?: string[];
  ignoreDrafts: boolean;
  ignoreWithConflicts: boolean;
  requireSuccessfulBuild?: boolean;
  minApprovalsNeeded?: number;
}

export interface ApprovalJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  intervalSeconds: number;
  dryRun: boolean;
  executionMode?: 'local' | 'worker';
  workerId?: string;
  revision?: string;
  rules: JobFilterRules;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalActionStatus = 
  | 'APPROVED'
  | 'DRY_RUN'
  | 'ALREADY_APPROVED'
  | 'SKIPPED'
  | 'FAILED';

export interface ApprovalLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  prId: number;
  prTitle: string;
  prUrl: string;
  repository: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  status: ApprovalActionStatus;
  reason: string;
  dryRun: boolean;
  timestamp: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface SchedulerStatus {
  isRunning: boolean;
  activeJobsCount: number;
  totalJobsCount: number;
  lastExecutionAt?: string;
  vpnConnected: boolean;
  bitbucketStatus: 'CONNECTED' | 'DISCONNECTED' | 'UNCONFIGURED' | 'ERROR';
  totalApprovedCount: number;
  uptimeSeconds: number;
}

export interface VerifyTokenRequest {
  serverType: BitbucketServerType;
  baseUrl?: string;
  authType?: BitbucketAuthType;
  token?: string;
  username?: string;
  workspace?: string;
  skipSslVerification?: boolean;
  proxyUrl?: string;
  timeoutMs?: number;
}

export interface VerifyTokenResponse {
  valid: boolean;
  user: BitbucketUserProfile;
}

export interface CreateJobDto {
  name: string;
  description?: string;
  enabled?: boolean;
  intervalSeconds?: number;
  dryRun?: boolean;
  executionMode?: 'local' | 'worker';
  workerId?: string;
  rules: JobFilterRules;
}

export interface UpdateJobDto extends Partial<CreateJobDto> {}

export interface MatchedPrPreview {
  pr: PullRequest;
  matched: boolean;
  reasons: string[];
  failureReason?: string;
  wouldApprove: boolean;
}

export interface PreviewRulesResponse {
  totalScanned: number;
  totalMatched: number;
  results: MatchedPrPreview[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

export interface BitbucketRepositoryMeta {
  slug: string;
  name: string;
  projectKey: string;
  projectName?: string;
  workspace?: string;
  uuid?: string;
  isPrivate: boolean;
  defaultBranch?: string;
  description?: string;
  fullName: string; // e.g. "workspace-slug/repo-name"
  updatedOn?: string;
}

export interface BitbucketBranchMeta {
  name: string;
  displayId: string;
  isDefault: boolean;
  latestCommit?: string;
  type?: 'default' | 'release' | 'feature' | 'hotfix' | 'custom';
}

export interface BitbucketUserMeta {
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string | null;
  accountId?: string;
  uuid?: string;
  active: boolean;
}

export interface BitbucketApiErrorDetails {
  code: 'AUTH_INVALID_TOKEN' | 'RATE_LIMITED' | 'NETWORK_OFFLINE' | 'WORKSPACE_NOT_FOUND' | 'INSUFFICIENT_SCOPES' | 'GENERIC_API_ERROR';
  message: string;
  status: number;
  rateLimitReset?: number;
  suggestion?: string;
  details?: unknown;
}

export type WorkerState =
  | 'STARTING'
  | 'ONLINE'
  | 'PAUSED_VPN'
  | 'OFFLINE_CONTROL_PLANE'
  | 'OFFLINE'
  | 'UPDATING'
  | 'ERROR_AUTH'
  | 'ERROR';

export interface WorkerRecord {
  id: string;
  ownerId: string;
  name: string;
  platform: 'darwin' | 'win32' | 'linux';
  architecture: string;
  hostname?: string;
  version: string;
  state: WorkerState;
  publicKey: JsonWebKey;
  pairedAt: string;
  lastHeartbeatAt?: string;
  lastBitbucketProbeAt?: string;
  activeExecutionId?: string;
  queueDepth: number;
  revokedAt?: string;
}

export interface PairingSessionView {
  id: string;
  code: string;
  expiresAt: string;
  pairUrl: string;
}

export interface WorkerInstallerManifest {
  platform: 'darwin';
  architecture: string;
  version: string;
  available: boolean;
  signed: boolean;
  size: number;
  fileName: string;
  downloadUrl: string;
  terminalRunAvailable: boolean;
}

export type WorkerLogStatus =
  | 'APPROVED'
  | 'SKIPPED'
  | 'DRY_RUN'
  | 'ALREADY_APPROVED'
  | 'FAILED'
  | 'PAUSED_VPN'
  | 'RESUMED';

export interface WorkerLogEntry {
  id: string;
  workerId: string;
  executionId: string;
  jobId: string;
  sequence: number;
  status: WorkerLogStatus;
  timestamp: string;
  repository?: string;
  prId?: number;
  prTitle?: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  matchedConditions: string[];
  failureReason?: string;
  providerErrorCode?: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface OwnerSession {
  authenticated: boolean;
  authEnabled: boolean;
  csrfToken?: string;
  expiresAt?: string;
}
