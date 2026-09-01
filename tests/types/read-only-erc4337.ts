import LifiSwidgeProtocol, { type LifiSwidgeCallConfig } from '../../types/index.js'
import { WalletAccountReadOnlyEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

declare const account: WalletAccountReadOnlyEvmErc4337
declare const config: LifiSwidgeCallConfig

new LifiSwidgeProtocol(account)
account.quoteSendTransaction([], config)
