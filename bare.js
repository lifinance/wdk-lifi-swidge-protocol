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

// Bare runtime entry point. Node.js polyfills are provided by bare-node-runtime.
import 'bare-node-runtime'

export { default, default as LifiSwidgeProtocol, NATIVE_VALUE_BRIDGE_DENY_LIST } from './src/lifi-swidge-protocol.js'

/** @typedef {import('./src/lifi-swidge-protocol.js').LifiSwidgeProtocolConfig} LifiSwidgeProtocolConfig */
/** @typedef {import('./src/lifi-swidge-protocol.js').LifiRouteOrder} LifiRouteOrder */
/** @typedef {import('./src/lifi-swidge-protocol.js').SwidgeStatusOptions} SwidgeStatusOptions */

export {
  LifiProtocolError,
  LifiConfigurationError,
  LifiQuoteError,
  LifiExecutionError,
  LifiStatusError,
  LifiReadOnlyAccountError,
  LifiUnsupportedChainError,
  LifiTimeoutError,
  LifiNetworkError,
  LifiRateLimitError,
  LifiSlippageError,
  LifiValidationError,
  LifiUntrustedContractError
} from './src/errors.js'
