export const LIFI_API_URL: "https://li.quest/v1";
/** Default timeout in ms per HTTP attempt. */
export const DEFAULT_TIMEOUT: 30000;
/** Default extra attempts on transient failures; mirrors the LI.FI SDK's requestSettings.retries. */
export const DEFAULT_RETRIES: 1;
/** Default base backoff in ms, doubled per attempt. */
export const DEFAULT_RETRY_DELAY: 500;
/** Cap in ms on the exponential backoff between retries. */
export const MAX_RETRY_DELAY: 5000;
/** Cap in ms on honored Retry-After header values. */
export const MAX_RETRY_AFTER: 60000;
/**
 * LI.FI Diamond contract addresses (lowercased), keyed by chain ID.
 * 'default' is the canonical CREATE2 deployment shared by most EVM chains.
 * Chains where CREATE2 derivation differs get explicit entries.
 * Source: https://github.com/lifinance/contracts/tree/main/deployments
 */
export const LIFI_DIAMOND_ADDRESSES: {
    default: string;
    324: string;
};
/** Uniswap Permit2 — appears as estimate.approvalAddress on permit-based routes. */
export const PERMIT2_ADDRESS: "0x000000000022d473030f116ddee9f6b43ac78ba3";
export namespace CHAINS {
    let ethereum: number;
    let arbitrum: number;
    let arbitrum_nova: number;
    let avalanche: number;
    let base: number;
    let blast: number;
    let bsc: number;
    let celo: number;
    let gnosis: number;
    let linea: number;
    let mantle: number;
    let mode: number;
    let optimism: number;
    let polygon: number;
    let scroll: number;
    let unichain: number;
    let zksync: number;
    let abstract: number;
    let apechain: number;
    let berachain: number;
    let bob: number;
    let boba: number;
    let cronos: number;
    let corn: number;
    let etherlink: number;
    let flare: number;
    let flow: number;
    let fraxtal: number;
    let fuse: number;
    let gravity: number;
    let hemi: number;
    let hyper_evm: number;
    let immutable_zkevm: number;
    let ink: number;
    let kaia: number;
    let katana: number;
    let lens: number;
    let lisk: number;
    let megaeth: number;
    let metis: number;
    let monad: number;
    let moonbeam: number;
    let morph: number;
    let opbnb: number;
    let plasma: number;
    let plume: number;
    let ronin: number;
    let rootstock: number;
    let sei: number;
    let soneium: number;
    let sonic: number;
    let sophon: number;
    let stable: number;
    let superposition: number;
    let swellchain: number;
    let taiko: number;
    let telos: number;
    let vana: number;
    let viction: number;
    let world_chain: number;
    let xdc: number;
    let xlayer: number;
    let solana: number;
    let bitcoin: number;
    let sui: number;
    let tron: number;
}
