/**
 * Shared Type Definitions for Bitbucket PR Approver
 * Used across Backend (Fastify), Frontend (React/Vite), and Test Suites
 */

// ==========================================
// 1. Bitbucket Server & Auth Types
// ==========================================

export type BitbucketServerType = 'cloud' | 'server'; // legacy storage compatibility; runtime schema permits Cloud only

export type BitbucketAuthType = 'basic' | 'bearer';

export interface BitbucketWorkspaceMeta {
  slug: string;
  name: string;
  uuid: string;
  avatarUrl?: string;
  isPersonal?: boolean;
}

export interface BitbucketConnectionConfig {
  serverType: BitbucketServerType;
  baseUrl: string; // e.g. "https://api.bitbucket.org/2.0"
  authType: BitbucketAuthType;
  token?: string; // Bitbucket Cloud App Password or OAuth Bearer Token
  username?: string; // Atlassian email / username
  workspace?: string; // Selected default workspace
  // Local network / VPN options
  skipSslVerification?: boolean;
  proxyUrl?: string; // Optional HTTP/HTTPS proxy
  timeoutMs?: number; // Request timeout in ms (default: 15000)
}

export interface MaskedConnectionConfig {
  serverType: BitbucketServerType;
  baseUrl: string;
  authType: BitbucketAuthType;
  username?: string;
  workspace?: string;
  hasToken: boolean;
  tokenPreview?: string; // e.g. "••••••••abcd"
  skipSslVerification: boolean;
  proxyUrl?: string;
  timeoutMs: number;
}

export interface BitbucketUserProfile {
  username: string; // login identifier / slug
  displayName: string;
  email?: string;
  avatarUrl?: string;
  serverType: BitbucketServerType;
  isAvailable: boolean;
  vpnConnected: boolean;
  verifiedAt: string; // ISO 8601 string
  serverEdition?: string;
  latencyMs?: number;
  accountId?: string;
  uuid?: string;
  selectedWorkspace?: string;
  workspaces?: BitbucketWorkspaceMeta[];
}

// ==========================================
// 2. Normalized Bitbucket Resource Types
// ==========================================

export interface RepositoryRef {
  projectOrWorkspace: string; // e.g., 'PROJ' in Server or 'team-workspace' in Cloud
  slug: string; // repository slug / name
}

export interface RepositoryInfo {
  projectOrWorkspace: string;
  slug: string;
  name: string;
  description?: string;
  isPrivate: boolean;
  cloneUrl?: string;
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
  name: string; // display branch name e.g. "feature/jira-123"
  refId: string; // full ref e.g. "refs/heads/feature/jira-123"
  commitHash?: string;
}

export interface PullRequest {
  id: number; // PR numeric identifier
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
  createdDate: string; // ISO 8601
  updatedDate: string; // ISO 8601
  htmlUrl: string; // Web browse URL
}

// ==========================================
// 3. Job & Rule Filtering Configuration Types
// ==========================================

export interface BranchPatternFilter {
  pattern: string; // Glob pattern e.g. "feature/*" or Regex e.g. "^(feature|bugfix)/.*"
  isRegex?: boolean; // Defaults to false (glob matching)
}

export interface JobFilterRules {
  // Target repositories
  repositories: string[]; // List of "project/repo" or globs e.g. ["CORE/*", "FRONTEND/web-app"]
  
  // Author rules
  authorWhitelist: string[]; // Users whose PRs can be approved (supports exact usernames or glob patterns)
  authorBlacklist?: string[]; // Users whose PRs should NEVER be approved
  excludeSelf: boolean; // Auto-exclude PRs authored by the logged-in user (default: true)
  
  // Branch rules
  targetBranches: string[]; // Target branch patterns e.g. ["main", "master", "develop", "release/*"]
  sourceBranches?: string[]; // Source branch patterns e.g. ["feature/*", "bugfix/*"]
  
  // Title / content rules
  titleKeywordsInclude?: string[]; // Optional keyword must be present in title
  titleKeywordsExclude?: string[]; // E.g. ["[WIP]", "DO NOT MERGE", "[HOLD]"]
  
  // Pre-condition toggles
  ignoreDrafts: boolean; // Skip PRs marked as draft (default: true)
  ignoreWithConflicts: boolean; // Skip PRs that have merge conflicts (default: true)
  requireSuccessfulBuild?: boolean; // Only approve if CI build status is green (default: false)
  minApprovalsNeeded?: number; // E.g. only approve if it has 0 approvals or already 1 approval
}

export interface ApprovalJob {
  id: string; // UUID v4
  name: string; // User-friendly job name e.g. "Auto Approve Core Team PRs"
  description?: string;
  enabled: boolean; // Whether the background runner will execute this job
  intervalSeconds: number; // Polling interval in seconds (default: 60s, min: 10s)
  dryRun: boolean; // When true, checks and logs matching PRs without actually sending approve API call
  executionMode?: 'local' | 'worker'; // Missing values remain local for backward compatibility
  workerId?: string; // Required when executionMode is worker
  revision?: string; // Immutable rules snapshot hash used by worker leases
  rules: JobFilterRules;
  lastRunAt?: string; // ISO 8601
  nextRunAt?: string; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ==========================================
// 4. Execution History & Action Log Types
// ==========================================

export type ApprovalActionStatus = 
  | 'APPROVED'      // Successfully sent approval API call
  | 'DRY_RUN'       // Matched rules, simulated approval
  | 'ALREADY_APPROVED' // Current user already approved this PR
  | 'SKIPPED'       // Did not match one or more filter rules
  | 'FAILED';       // API error during approval call

export interface ApprovalLogEntry {
  id: string; // UUID v4
  jobId: string;
  jobName: string;
  prId: number;
  prTitle: string;
  prUrl: string;
  repository: string; // "project/repo"
  author: string; // username
  sourceBranch: string;
  targetBranch: string;
  status: ApprovalActionStatus;
  reason: string; // E.g. "Matched author whitelist and branch pattern", "Author not in whitelist", "Network timeout"
  dryRun: boolean;
  timestamp: string; // ISO 8601
  durationMs: number;
  details?: Record<string, unknown>;
}

// ==========================================
// 5. System Status, Runner & SSE Events
// ==========================================

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

export type SseEventType = 
  | 'job_started'
  | 'job_completed'
  | 'pr_evaluated'
  | 'pr_approved'
  | 'status_changed'
  | 'worker_status_changed'
  | 'worker_log_batch'
  | 'execution_completed'
  | 'error';

export interface SseEventPayload<T = unknown> {
  type: SseEventType;
  timestamp: string;
  data: T;
}

// ==========================================
// 6. REST API DTOs (Request / Response)
// ==========================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface VerifyTokenRequest {
  serverType: BitbucketServerType;
  baseUrl: string;
  authType: BitbucketAuthType;
  token: string;
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

export interface PreviewRulesRequest {
  rules: JobFilterRules;
}

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


// ==========================================
// 7. Bitbucket Metadata Types (Dropdowns & Comboboxes)
// ==========================================

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
  fullName: string;
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

export interface BitbucketMetadataList<T> {
  items: T[];
  total: number;
}

export interface BitbucketApiErrorDetails {
  code: 'AUTH_INVALID_TOKEN' | 'RATE_LIMITED' | 'NETWORK_OFFLINE' | 'WORKSPACE_NOT_FOUND' | 'INSUFFICIENT_SCOPES' | 'GENERIC_API_ERROR' | 'CONFIG_MISSING' | 'VALIDATION_ERROR';
  message: string;
  httpStatus: number;
  rateLimitReset?: number | null;
  suggestion?: string;
  details?: unknown;
}
