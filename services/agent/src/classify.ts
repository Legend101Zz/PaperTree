/**
 * contracts.md §3.3: the agent's OWN error classification — never Pi's retry regex, which matches
 * "500" anywhere in a message (spike §7 c5: a 400 `max_tokens must be <= 500000` was retried).
 *
 * Input is the last assistant message's `stopReason` plus a leading `^(\d{3}) ` in its
 * `errorMessage`, and the reason the host itself aborted, when it did. Output is a code from §2.9's
 * second list and short, user-safe text. The raw `errorMessage` never leaves this module except to a
 * debug log line.
 */
export type RunErrorCode =
  | 'provider_auth'
  | 'rate_limited'
  | 'quota'
  | 'upstream_unavailable'
  | 'timeout'
  | 'aborted'
  | 'bad_request'
  | 'tool_failed'
  | 'tool_budget_exhausted'
  | 'output_truncated'
  | 'agent_unavailable'
  | 'internal';

export interface RunError {
  readonly code: RunErrorCode;
  readonly retryable: boolean;
  readonly message: string;
}

/** Why the host called `session.abort()`, when it did. */
export type HostAbort = 'tool_budget' | 'idle' | 'deadline' | 'client' | 'tool_failed';

const QUOTA = /insufficient_quota|quota|billing|balance/i;
/**
 * Transport failures with no status line. "timed out" and "fetch failed" are the table's; the
 * Anthropic SDK renders a failed fetch as `Connection error.` (APIConnectionError) and a timeout as
 * `Request timed out.`, so both reach this. A body cut mid-stream surfaces from undici as
 * `terminated`.
 */
const TRANSPORT = /timed out|fetch failed|connection error|ECONNREFUSED|ECONNRESET|terminated/i;

/** Classify a provider failure (`stopReason: "error"`) by its message. */
export function classifyProviderError(errorMessage: string | undefined): {
  readonly code: RunErrorCode;
  readonly retryable: boolean;
} {
  const text = errorMessage ?? '';
  const status = /^(\d{3}) /.exec(text);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return { code: 'provider_auth', retryable: false };
    if (code === 429) {
      return QUOTA.test(text)
        ? { code: 'quota', retryable: false }
        : { code: 'rate_limited', retryable: true };
    }
    if (code >= 500 && code <= 599) return { code: 'upstream_unavailable', retryable: true };
    if (code === 400) return { code: 'bad_request', retryable: false };
    return { code: 'internal', retryable: false };
  }
  if (TRANSPORT.test(text)) return { code: 'upstream_unavailable', retryable: true };
  return { code: 'internal', retryable: false };
}

/**
 * Whether Pi's own auto-retry may go ahead for this failed attempt. Only a transient provider
 * failure, and only while no text has reached the caller: a retry after text would stream a second
 * answer after the first one's opening (§3.4 has the same rule one level up).
 */
export function mayRetry(code: RunErrorCode, textSent: boolean): boolean {
  return !textSent && (code === 'upstream_unavailable' || code === 'rate_limited');
}

const MESSAGES: Record<RunErrorCode, string> = {
  provider_auth: "The AI provider rejected this service's API key.",
  rate_limited: 'The AI provider is limiting requests right now. Try again in a moment.',
  quota: "The AI provider's quota for this service is used up.",
  upstream_unavailable: 'The AI provider did not respond. Try again in a moment.',
  timeout: 'The model took too long to answer.',
  aborted: 'The answer was stopped.',
  bad_request: 'The AI provider refused this request.',
  tool_failed: 'The paper could not be read while answering. Try again.',
  tool_budget_exhausted:
    'The question needed more of the paper than one answer may read. Try a narrower question.',
  output_truncated: 'The answer reached its length limit, so it is incomplete.',
  agent_unavailable: 'The AI service is not available.',
  internal: 'Something went wrong while answering.',
};

/** The fixed, user-safe sentence for a code. `partial` changes the timeout wording only. */
export function runError(
  code: RunErrorCode,
  retryable: boolean,
  options: { readonly partial?: boolean; readonly idle?: boolean } = {},
): RunError {
  let message = MESSAGES[code];
  if (code === 'timeout') {
    if (options.idle)
      message = options.partial
        ? 'The model stopped responding, so this answer is incomplete.'
        : 'The model stopped responding.';
    else if (options.partial) message = 'The answer took longer than allowed, so it is incomplete.';
  }
  return { code, retryable, message };
}

/** The code a host-triggered abort maps to (§3.3 table). */
export function classifyHostAbort(reason: HostAbort): {
  readonly code: RunErrorCode;
  readonly retryable: boolean;
} {
  switch (reason) {
    case 'tool_budget':
      return { code: 'tool_budget_exhausted', retryable: false };
    case 'idle':
    case 'deadline':
      return { code: 'timeout', retryable: true };
    case 'client':
      return { code: 'aborted', retryable: true };
    case 'tool_failed':
      return { code: 'tool_failed', retryable: true };
  }
}
