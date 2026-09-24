import type { BitbucketConnectionConfig } from '@bitbucket-pr-approver/shared';
import type { IBitbucketClient } from './client.interface.js';
import { BitbucketCloudClient } from './cloud-client.js';

export function createBitbucketClient(config: BitbucketConnectionConfig): IBitbucketClient {
  return new BitbucketCloudClient(config);
}
