import type { BscDefiProtocol } from "@/types/defi";
import type { WalletIntent } from "@/types/intent";
import {
  PANCAKESWAP_SWAP_URL,
  PANCAKESWAP_V2_ROUTER,
  type PreparedPancakeSwap,
  type PancakeOutputSymbol,
} from "@/services/defi/pancakeswap-v2";

export function createBscDefiDappIntent(protocol: BscDefiProtocol): WalletIntent {
  return {
    actions: [
      {
        amount: null,
        chain: protocol.chain,
        dappUrl: protocol.dappUrl,
        data: null,
        message: null,
        to: null,
        token: null,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId(protocol.id),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: protocol.riskLevel,
    safetyChecks: [
      ...protocol.safetyChecks,
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Prepare a ${protocol.category.toLowerCase()} interaction with ${protocol.name} on ${protocol.chain}.`,
    title: `${protocol.name} ${protocol.category} Intent`,
  };
}

export function createPancakeBnbSwapIntent(input: {
  amountInBnb: string;
  outputSymbol: PancakeOutputSymbol;
  slippageBps: number;
}): WalletIntent {
  return {
    actions: [
      {
        amount: input.amountInBnb,
        chain: "BNB Smart Chain",
        dappUrl: PANCAKESWAP_SWAP_URL,
        data: null,
        message: null,
        params: {
          inputToken: "BNB",
          outputToken: input.outputSymbol,
          protocol: "PancakeSwap V2",
          router: PANCAKESWAP_V2_ROUTER,
          slippageBps: input.slippageBps,
        },
        to: PANCAKESWAP_V2_ROUTER,
        token: input.outputSymbol,
        type: "swap",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId("pancakeswap-bnb-swap"),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Uses PancakeSwap V2 router on BNB Smart Chain.",
      "Uses BNB as input, so no unlimited token approval is needed for this swap path.",
      "Quote, nonce, gas, calldata, and broadcast are resolved on this device through real BSC RPC.",
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Swap ${input.amountInBnb} BNB to ${input.outputSymbol} through PancakeSwap V2 after local safety review.`,
    title: `PancakeSwap BNB to ${input.outputSymbol}`,
  };
}

export function createPreparedPancakeBnbSwapIntent(input: {
  prepared: PreparedPancakeSwap;
}): WalletIntent {
  const { prepared } = input;

  return {
    actions: [
      {
        amount: prepared.quote.amountInBnb,
        chain: "BNB Smart Chain",
        dappUrl: PANCAKESWAP_SWAP_URL,
        data: prepared.evmTx.data,
        evmTx: prepared.evmTx,
        message: null,
        params: {
          amountInWei: prepared.quote.amountInWei,
          amountOut: prepared.quote.amountOut,
          amountOutMin: prepared.quote.amountOutMin,
          deadline: prepared.quote.deadline,
          inputToken: "BNB",
          outputToken: prepared.quote.outputToken.symbol,
          path: prepared.quote.path.join(" -> "),
          protocol: "PancakeSwap V2",
          router: prepared.quote.router,
          slippageBps: prepared.quote.slippageBps,
        },
        to: prepared.quote.router,
        token: prepared.quote.outputToken.symbol,
        type: "swap",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId("pancakeswap-bnb-swap-prepared"),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Uses PancakeSwap V2 router on BNB Smart Chain.",
      "Quote, nonce, gas, calldata, deadline, and minimum receive are shown before signing.",
      "Uses BNB as input, so no unlimited token approval is needed for this swap path.",
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Swap ${prepared.quote.amountInBnb} BNB to ${prepared.quote.outputToken.symbol}. Minimum receive: ${prepared.quote.amountOutMin} ${prepared.quote.outputToken.symbol}.`,
    title: `PancakeSwap BNB to ${prepared.quote.outputToken.symbol}`,
  };
}

function makeIntentId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}
