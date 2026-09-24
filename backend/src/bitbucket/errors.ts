import { ERROR_CODES } from '@bitbucket-pr-approver/shared';

export type BitbucketErrorCode = keyof typeof ERROR_CODES;

export class BitbucketError extends Error {
  public readonly code: BitbucketErrorCode;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, code: BitbucketErrorCode = 'BITBUCKET_UNREACHABLE', statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'BitbucketError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function classifyNetworkError(err: unknown, baseUrl: string): BitbucketError {
  if (err instanceof BitbucketError) {
    return err;
  }

  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorCode = (err as { code?: string })?.code;

  // DNS failure or connection timeout -> typically corporate VPN not connected
  if (errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' || errorCode === 'EHOSTUNREACH' || errorCode === 'ECONNREFUSED' || errorCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return new BitbucketError(
      `Cannot connect to Bitbucket host at ${baseUrl}. Please check if your corporate VPN is connected (${errorCode || 'Timeout'}).`,
      'VPN_REQUIRED',
      undefined,
      { originalCode: errorCode, originalMessage: errorMessage }
    );
  }

  // SSL Certificate errors
  if (
    errorCode === 'CERT_HAS_EXPIRED' ||
    errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    errorCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    errorCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    errorMessage.includes('self-signed certificate') ||
    errorMessage.includes('certificate')
  ) {
    return new BitbucketError(
      `SSL certificate verification failed for ${baseUrl}. Enable "Skip SSL Verification" in Settings if this is an internal corporate host.`,
      'SSL_CERTIFICATE_ERROR',
      undefined,
      { originalCode: errorCode, originalMessage: errorMessage }
    );
  }

  return new BitbucketError(
    `Failed to communicate with Bitbucket: ${errorMessage}`,
    'BITBUCKET_UNREACHABLE',
    undefined,
    { originalCode: errorCode, originalMessage: errorMessage }
  );
}
