// Copyright 2025 LI.FI
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import {
  LifiProtocolError,
  LifiTimeoutError,
  LifiNetworkError,
  LifiRateLimitError,
  LifiSlippageError
} from './errors.js'
import {
  DEFAULT_TIMEOUT,
  DEFAULT_RETRIES,
  DEFAULT_RETRY_DELAY,
  MAX_RETRY_DELAY,
  MAX_RETRY_AFTER
} from './lifi-config.js'

/**
 * Options for a LI.FI API request.
 *
 * @typedef {Object} RequestOptions
 * @property {Record<string, string>} [headers] - HTTP headers to send, such as the integrator and API key headers.
 * @property {number} [timeout] - Timeout in ms per attempt (default: 30,000).
 * @property {number} [retries] - Extra attempts on transient failures (default: 1; 0 disables retries).
 * @property {number} [retryDelay] - Base backoff delay in ms, doubled per attempt and capped at 5,000 (default: 500).
 * @property {new (message: string) => Error} [errorClass] - Error constructor for non-transient endpoint failures (default: LifiProtocolError).
 * @property {string} [errorPrefix] - Prefix for endpoint failure messages (default: 'LI.FI request failed').
 * @property {string} [errorSuffix] - Hint appended to endpoint failure messages, e.g. a recovery suggestion.
 */

// Promise-based setTimeout, usable under both Node and Bare.
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Runs fetch with a timeout enforced by AbortController and Promise.race.
// The race is required in addition to the abort signal: Bare runtime fetch
// polyfills and test mocks may ignore the signal entirely.
async function fetchWithTimeout (url, init, timeout) {
  const controller = new AbortController()
  let timer
  const timedOut = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new LifiTimeoutError(`LI.FI request timed out after ${timeout}ms: ${url}`))
    }, timeout)
  })

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timedOut
    ])
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new LifiTimeoutError(`LI.FI request timed out after ${timeout}ms: ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Exponential backoff: baseDelay doubled per attempt, capped at MAX_RETRY_DELAY.
function backoffDelay (attempt, baseDelay) {
  return Math.min(baseDelay * 2 ** attempt, MAX_RETRY_DELAY)
}

// Delay before retrying a 429: honors the Retry-After header (seconds or
// HTTP-date) capped at MAX_RETRY_AFTER, falling back to exponential backoff.
function rateLimitDelay (attempt, baseDelay, response) {
  const retryAfter = response.headers?.get?.('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : new Date(retryAfter).getTime() - Date.now()
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER)
  }
  return backoffDelay(attempt, baseDelay)
}

/**
 * Central HTTP layer for all LI.FI API calls, modeled on the LI.FI SDK's
 * request() wrapper (packages/sdk/src/utils/request.ts) with the SDK's
 * status-to-error classification (packages/sdk/src/errors/httpError.ts).
 *
 * Transient failures — network errors, timeouts, 5xx, and 429 — are retried
 * with exponential backoff (Retry-After is honored for 429). All other
 * responses fail immediately with the endpoint's error class. A response
 * without a status code is treated as non-retryable.
 *
 * @param {string} url - Full request URL including query string.
 * @param {RequestOptions} [options] - Timeout, retry, and error-classification options.
 * @returns {Promise<any>} Parsed JSON response body.
 * @throws {LifiTimeoutError} If an attempt exceeds the timeout and retries are exhausted.
 * @throws {LifiNetworkError} If a network-level failure persists after retries.
 * @throws {LifiRateLimitError} If the API keeps returning 429 after retries.
 * @throws {LifiSlippageError} If the API returns 409 — the quote is stale and a new one is needed.
 */
export async function request (url, options = {}) {
  const {
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    errorClass: ErrorClass = LifiProtocolError,
    errorPrefix = 'LI.FI request failed',
    errorSuffix
  } = options

  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetchWithTimeout(url, { headers }, timeout)
    } catch (err) {
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, retryDelay))
        continue
      }
      if (err instanceof LifiProtocolError) throw err
      throw new LifiNetworkError(`${errorPrefix}: ${err.message}`, { cause: err })
    }

    if (response.ok) return response.json()

    let body = {}
    try {
      body = await response.json()
    } catch {}

    const message = body.message || response.statusText
    const status = response.status

    if (status === 429) {
      if (attempt < retries) {
        await sleep(rateLimitDelay(attempt, retryDelay, response))
        continue
      }
      throw new LifiRateLimitError(`${errorPrefix}: rate limit exceeded: ${message}`)
    }

    // A stale quote cannot succeed by retrying the same URL — a fresh quote is needed.
    if (status === 409) {
      throw new LifiSlippageError(
        `${errorPrefix}: ${message} ` +
        '(slippage is larger than the defined threshold — request a new quote)'
      )
    }

    if (status >= 500 && attempt < retries) {
      await sleep(backoffDelay(attempt, retryDelay))
      continue
    }

    throw new ErrorClass(`${errorPrefix}: ${message}${errorSuffix ? ` ${errorSuffix}` : ''}`)
  }
}
