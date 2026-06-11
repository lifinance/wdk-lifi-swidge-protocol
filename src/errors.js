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

/** Base class for all errors thrown by the LI.FI Swidge protocol. */
export class LifiProtocolError extends Error {
  constructor (message, options) {
    super(message, options)
    this.name = this.constructor.name
  }
}

/** Thrown when the module is misconfigured (missing provider, bad API key, etc.). */
export class LifiConfigurationError extends LifiProtocolError {}

/** Thrown when the LI.FI quote API returns an error or an unusable response. */
export class LifiQuoteError extends LifiProtocolError {}

/** Thrown when execution is rejected before any transaction is sent (fee cap exceeded, read-only account, etc.). */
export class LifiExecutionError extends LifiProtocolError {}

/** Thrown when the LI.FI status API returns an error or the id is unknown. */
export class LifiStatusError extends LifiProtocolError {}

/** Thrown when swidge() is called with a read-only or absent account. */
export class LifiReadOnlyAccountError extends LifiExecutionError {}

/** Thrown when a chain name is not found in the supported chains map. */
export class LifiUnsupportedChainError extends LifiProtocolError {}

/** Thrown when a LI.FI API request exceeds the configured timeout. */
export class LifiTimeoutError extends LifiProtocolError {}

/** Thrown when a network-level fetch failure persists after all retries. */
export class LifiNetworkError extends LifiProtocolError {}

/** Thrown when the LI.FI API returns 429 and retries are exhausted. */
export class LifiRateLimitError extends LifiProtocolError {}

/** Thrown on HTTP 409 from the quote API: slippage exceeded the threshold, a fresh quote is needed. */
export class LifiSlippageError extends LifiQuoteError {}

/** Thrown when user-supplied parameters or an API response fail validation before execution. */
export class LifiValidationError extends LifiProtocolError {}

/** Thrown when the quote's transaction target or approval address is not in the trusted contract allowlist. */
export class LifiUntrustedContractError extends LifiExecutionError {}
