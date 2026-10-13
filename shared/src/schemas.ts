/**
 * JSON Schemas for Runtime Validation & Fastify Route Serialization
 */

export const ConnectionConfigSchema = {
  type: 'object',
  required: ['serverType', 'baseUrl', 'authType'],
  properties: {
    serverType: { type: 'string', enum: ['cloud'] },
    baseUrl: { type: 'string', minLength: 1 },
    authType: { type: 'string', enum: ['bearer', 'basic', 'session'] },
    token: { type: 'string' },
    cookie: { type: 'string' },
    csrfToken: { type: 'string' },
    username: { type: 'string' },
    skipSslVerification: { type: 'boolean', default: false },
    proxyUrl: { type: 'string' },
    timeoutMs: { type: 'number', minimum: 1000, maximum: 60000, default: 15000 },
  },
  additionalProperties: false,
} as const;

export const JobFilterRulesSchema = {
  type: 'object',
  required: ['repositories', 'authorWhitelist', 'targetBranches'],
  properties: {
    repositories: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
    },
    authorWhitelist: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
    },
    authorBlacklist: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      default: [],
    },
    excludeSelf: { type: 'boolean', default: true },
    targetBranches: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
    },
    sourceBranches: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      default: [],
    },
    mergeTargetBranches: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      default: [],
    },
    titleKeywordsInclude: {
      type: 'array',
      items: { type: 'string' },
      default: [],
    },
    titleKeywordsExclude: {
      type: 'array',
      items: { type: 'string' },
      default: [],
    },
    ignoreDrafts: { type: 'boolean', default: true },
    ignoreWithConflicts: { type: 'boolean', default: true },
    requireSuccessfulBuild: { type: 'boolean', default: false },
    minApprovalsNeeded: { type: 'number', minimum: 0, default: 0 },
  },
  additionalProperties: false,
} as const;

export const CreateJobSchema = {
  type: 'object',
  required: ['name', 'rules'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    enabled: { type: 'boolean', default: true },
    intervalSeconds: { type: 'number', minimum: 10, maximum: 86400, default: 60 },
    dryRun: { type: 'boolean', default: false },
    autoMergeOnSuccessfulBuild: { type: 'boolean', default: false },
    rules: JobFilterRulesSchema,
  },
  additionalProperties: false,
} as const;

export const UpdateJobSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    enabled: { type: 'boolean' },
    intervalSeconds: { type: 'number', minimum: 10, maximum: 86400 },
    dryRun: { type: 'boolean' },
    autoMergeOnSuccessfulBuild: { type: 'boolean' },
    rules: JobFilterRulesSchema,
  },
  additionalProperties: false,
} as const;

export const GitScanReposSchema = {
  type: 'object',
  required: ['rootPath'],
  properties: {
    rootPath: { type: 'string', minLength: 1 },
    maxDepth: { type: 'number', minimum: 1, maximum: 10, default: 4 },
  },
  additionalProperties: false,
} as const;

export const GitStageSchema = {
  type: 'object',
  required: ['repoPath'],
  properties: {
    repoPath: { type: 'string', minLength: 1 },
    paths: {
      type: 'array',
      items: { type: 'string' },
    },
    all: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const GitCommitSchema = {
  type: 'object',
  required: ['repoPath', 'message'],
  properties: {
    repoPath: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    amend: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const GitBranchCreateSchema = {
  type: 'object',
  required: ['repoPath', 'branchName'],
  properties: {
    repoPath: { type: 'string', minLength: 1 },
    branchName: { type: 'string', minLength: 1 },
    startPoint: { type: 'string' },
    checkout: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const GitBranchSwitchSchema = {
  type: 'object',
  required: ['repoPath', 'branchName'],
  properties: {
    repoPath: { type: 'string', minLength: 1 },
    branchName: { type: 'string', minLength: 1 },
    createNew: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

export const GitStashPushSchema = {
  type: 'object',
  required: ['repoPath'],
  properties: {
    repoPath: { type: 'string', minLength: 1 },
    message: { type: 'string' },
    includeUntracked: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

