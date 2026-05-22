import { bscRpc, estimateBscGas, getBscGasPrice, getBscTransactionCount } from "@/services/defi/bsc-rpc";
import type { EvmTransactionPayload } from "@/types/intent";

export const PANCAKESWAP_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
export const PANCAKESWAP_SWAP_URL = "https://pancakeswap.finance/swap";

const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const GET_AMOUNTS_OUT_SELECTOR = "d06ca61f";
const SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR = "7ff36ab5";
const BALANCE_OF_SELECTOR = "70a08231";

export type PancakeOutputSymbol = "CAKE" | "USDC" | "USDT";

export type PancakeToken = {
  address: string;
  decimals: number;
  name: string;
  symbol: PancakeOutputSymbol;
};

export const PANCAKE_OUTPUT_TOKENS: Record<PancakeOutputSymbol, PancakeToken> = {
  CAKE: {
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    decimals: 18,
    name: "PancakeSwap Token",
    symbol: "CAKE",
  },
  USDC: {
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    name: "Binance-Peg USD Coin",
    symbol: "USDC",
  },
  USDT: {
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    name: "Binance-Peg Tether USD",
    symbol: "USDT",
  },
};

export type PancakeSwapQuote = {
  amountInBnb: string;
  amountInWei: string;
  amountOut: string;
  amountOutMin: string;
  deadline: number;
  outputToken: PancakeToken;
  path: string[];
  router: string;
  slippageBps: number;
};

export type PreparedPancakeSwap = {
  evmTx: EvmTransactionPayload;
  quote: PancakeSwapQuote;
};

export async function preparePancakeBnbToTokenSwap(input: {
  amountInBnb: string;
  fromAddress: string;
  outputSymbol: PancakeOutputSymbol;
  slippageBps?: number;
}): Promise<PreparedPancakeSwap> {
  assertAddress(input.fromAddress, "source wallet");

  const outputToken = PANCAKE_OUTPUT_TOKENS[input.outputSymbol];
  if (!outputToken) {
    throw new Error("Unsupported PancakeSwap output token.");
  }

  const amountInWei = parseUnits(input.amountInBnb, 18);
  if (amountInWei <= 0n) {
    throw new Error("Swap amount must be greater than zero.");
  }

  const slippageBps = normalizeSlippageBps(input.slippageBps ?? 100);
  const path = [WBNB_ADDRESS, outputToken.address];
  const amounts = await getAmountsOut(amountInWei, path);
  const amountOut = amounts[amounts.length - 1];
  if (!amountOut || amountOut <= 0n) {
    throw new Error("PancakeSwap returned no output quote for this pair.");
  }

  const amountOutMin = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const data = encodeSwapExactEthForTokens({
    amountOutMin,
    deadline,
    path,
    recipient: input.fromAddress,
  });

  const [nonce, gasPrice, gasEstimate] = await Promise.all([
    getBscTransactionCount(input.fromAddress),
    getBscGasPrice(),
    estimateBscGas({
      data,
      from: input.fromAddress,
      to: PANCAKESWAP_V2_ROUTER,
      value: amountInWei,
    }),
  ]);

  return {
    evmTx: {
      chainId: "56",
      data,
      gasLimit: addGasBuffer(gasEstimate).toString(),
      gasPrice: gasPrice.toString(),
      nonce: nonce.toString(),
      to: PANCAKESWAP_V2_ROUTER,
      txType: "00",
      value: amountInWei.toString(),
    },
    quote: {
      amountInBnb: input.amountInBnb,
      amountInWei: amountInWei.toString(),
      amountOut: formatUnits(amountOut, outputToken.decimals),
      amountOutMin: formatUnits(amountOutMin, outputToken.decimals),
      deadline,
      outputToken,
      path,
      router: PANCAKESWAP_V2_ROUTER,
      slippageBps,
    },
  };
}

export async function readBep20Balance(input: { address: string; token: PancakeToken }) {
  assertAddress(input.address, "wallet");
  const data = `0x${BALANCE_OF_SELECTOR}${encodeAddress(input.address)}`;
  const result = await bscRpc<string>("eth_call", [{ data, to: input.token.address }, "latest"]);
  return formatUnits(BigInt(result), input.token.decimals);
}

function addGasBuffer(gasEstimate: bigint) {
  return (gasEstimate * 120n) / 100n;
}

async function getAmountsOut(amountIn: bigint, path: string[]) {
  const data = `0x${GET_AMOUNTS_OUT_SELECTOR}${encodeUint(amountIn)}${encodeUint(64n)}${encodeAddressArray(path)}`;
  const result = await bscRpc<string>("eth_call", [{ data, to: PANCAKESWAP_V2_ROUTER }, "latest"]);
  return decodeUintArray(result);
}

function encodeSwapExactEthForTokens(input: {
  amountOutMin: bigint;
  deadline: number;
  path: string[];
  recipient: string;
}) {
  return `0x${SWAP_EXACT_ETH_FOR_TOKENS_SELECTOR}${[
    encodeUint(input.amountOutMin),
    encodeUint(128n),
    encodeAddress(input.recipient),
    encodeUint(BigInt(input.deadline)),
    encodeAddressArray(input.path),
  ].join("")}`;
}

function encodeAddressArray(addresses: string[]) {
  return [encodeUint(BigInt(addresses.length)), ...addresses.map(encodeAddress)].join("");
}

function encodeAddress(address: string) {
  assertAddress(address, "address");
  return strip0x(address).toLowerCase().padStart(64, "0");
}

function encodeUint(value: bigint) {
  if (value < 0n) {
    throw new Error("Cannot ABI encode a negative integer.");
  }
  return value.toString(16).padStart(64, "0");
}

function decodeUintArray(hex: string) {
  const data = strip0x(hex);
  if (data.length < 128) {
    throw new Error("Invalid PancakeSwap quote response.");
  }

  const offset = Number.parseInt(data.slice(0, 64), 16) * 2;
  const length = Number.parseInt(data.slice(offset, offset + 64), 16);
  const values: bigint[] = [];
  for (let index = 0; index < length; index += 1) {
    const start = offset + 64 + index * 64;
    values.push(BigInt(`0x${data.slice(start, start + 64)}`));
  }
  return values;
}

export function parseUnits(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a decimal number.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimals.`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export function formatUnits(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

export function isPancakeOutputSymbol(value: string): value is PancakeOutputSymbol {
  return value === "CAKE" || value === "USDC" || value === "USDT";
}

function normalizeSlippageBps(value: number) {
  if (!Number.isFinite(value) || value < 10 || value > 1_000) {
    throw new Error("Slippage must be between 0.10% and 10.00%.");
  }
  return Math.round(value);
}

function assertAddress(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${label} address.`);
  }
}

function strip0x(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}
