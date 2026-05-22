import { getAgentApiBaseUrl } from "@/services/api-base-url";
import type { EvmTransactionPayload } from "@/types/intent";

export const ETHEREUM_CHAIN_ID = 1;
export const ETHEREUM_EXPLORER_TX_URL = "https://etherscan.io/tx/";
export const HOLESKY_CHAIN_ID = 17000;
export const HOLESKY_EXPLORER_TX_URL = "https://holesky.etherscan.io/tx/";
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER_TX_URL = "https://sepolia.etherscan.io/tx/";
export const ETHEREUM_PUBLIC_RPC_URL =
  process.env.EXPO_PUBLIC_ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
export const HOLESKY_PUBLIC_RPC_URL =
  process.env.EXPO_PUBLIC_HOLESKY_RPC_URL ?? "https://holesky.drpc.org";
export const SEPOLIA_PUBLIC_RPC_URL =
  process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

export type EthereumRpcNetwork = {
  chainId?: string | number | null;
};

type JsonRpcResponse<T> = {
  error?: { code: number; message: string };
  id: number;
  jsonrpc: "2.0";
  result?: T;
};

export async function ethereumRpc<T>(
  method: string,
  params: unknown[],
  network: EthereumRpcNetwork = {},
): Promise<T> {
  const response = await fetch(getEthereumRpcUrl(network), {
    body: JSON.stringify({
      chainId: network.chainId ? String(network.chainId) : undefined,
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `Ethereum RPC ${method} failed.`);
  }

  if (payload.result === undefined) {
    throw new Error(`Ethereum RPC ${method} returned no result.`);
  }

  return payload.result;
}

function getEthereumRpcUrl(network: EthereumRpcNetwork = {}) {
  if (process.env.EXPO_OS === "web" || process.env.EXPO_PUBLIC_AGENT_API_URL) {
    return `${getAgentApiBaseUrl("Ethereum RPC proxy")}/api/ethereum/rpc`;
  }
  if (String(network.chainId) === String(HOLESKY_CHAIN_ID)) return HOLESKY_PUBLIC_RPC_URL;
  if (String(network.chainId) === String(SEPOLIA_CHAIN_ID)) return SEPOLIA_PUBLIC_RPC_URL;
  return ETHEREUM_PUBLIC_RPC_URL;
}

export async function getEthereumGasPrice(network: EthereumRpcNetwork = {}) {
  return hexQuantityToBigInt(await ethereumRpc<string>("eth_gasPrice", [], network));
}

export async function getEthereumTransactionCount(address: string, network: EthereumRpcNetwork = {}) {
  return hexQuantityToBigInt(await ethereumRpc<string>("eth_getTransactionCount", [address, "pending"], network));
}

export async function estimateEthereumGas(input: {
  data: string;
  from: string;
  to: string;
  value?: bigint;
}, network: EthereumRpcNetwork = {}) {
  return hexQuantityToBigInt(
    await ethereumRpc<string>("eth_estimateGas", [
      {
        data: input.data,
        from: input.from,
        to: input.to,
        value: quantityHex(input.value ?? 0n),
      },
    ], network),
  );
}

export async function sendEthereumRawTransaction(rawTransaction: string, network: EthereumRpcNetwork = {}) {
  const normalized = rawTransaction.startsWith("0x") ? rawTransaction : `0x${rawTransaction}`;
  return ethereumRpc<string>("eth_sendRawTransaction", [normalized], network);
}

export function isEthereumMainnetChain(chain: string | null | undefined) {
  if (!chain) return false;
  const normalized = chain.toLowerCase();
  return normalized === "ethereum" || normalized === "ethereum mainnet" || normalized === "mainnet";
}

export function isEthereumHoleskyChain(chain: string | null | undefined) {
  if (!chain) return false;
  const normalized = chain.toLowerCase();
  return normalized === "ethereum holesky" || normalized === "holesky" || normalized === "testnet";
}

export function isEthereumSepoliaChain(chain: string | null | undefined) {
  if (!chain) return false;
  const normalized = chain.toLowerCase();
  return normalized === "ethereum sepolia" || normalized === "sepolia";
}

export function isSupportedEthereumChain(chain: string | null | undefined) {
  return isEthereumMainnetChain(chain) || isEthereumHoleskyChain(chain) || isEthereumSepoliaChain(chain);
}

export function isBscChain(chain: string | null | undefined) {
  if (!chain) return false;
  return chain === "BNB Smart Chain" || chain === "BSC";
}

export function getEvmExplorerTxUrl(chain: string, txHash: string) {
  if (isEthereumMainnetChain(chain)) {
    return `${ETHEREUM_EXPLORER_TX_URL}${txHash}`;
  }
  if (isEthereumHoleskyChain(chain)) {
    return `${HOLESKY_EXPLORER_TX_URL}${txHash}`;
  }
  if (isEthereumSepoliaChain(chain)) {
    return `${SEPOLIA_EXPLORER_TX_URL}${txHash}`;
  }
  return `https://bscscan.com/tx/${txHash}`;
}

export function normalizeEvmTxForChain(chain: string, tx: EvmTransactionPayload): EvmTransactionPayload {
  if (isEthereumMainnetChain(chain)) {
    return {
      ...tx,
      chainId: String(ETHEREUM_CHAIN_ID),
    };
  }
  if (isEthereumHoleskyChain(chain)) {
    return {
      ...tx,
      chainId: String(HOLESKY_CHAIN_ID),
    };
  }
  if (isEthereumSepoliaChain(chain)) {
    return {
      ...tx,
      chainId: String(SEPOLIA_CHAIN_ID),
    };
  }
  return tx;
}

export function hexQuantityToBigInt(value: string) {
  return BigInt(value);
}

export function quantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}
