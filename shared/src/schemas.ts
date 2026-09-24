/**
 * JSON Schemas for Runtime Validation & Fastify Route Serialization
 */

export const ConnectionConfigSchema = {
  type: 'object',
  required: ['serverType', 'baseUrl', 'authType'],
  properties: {
    serverType: { type: 'string', enum: ['cloud'] },
    baseUrl: { type: 'string', minLength: 1 },
    authType: { type: 'string', enum: ['bearer', 'basic'] },
    token: { type: 'string' },
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
    rules: JobFilterRulesSchema,
  },
  additionalProperties: false,
} as const;
