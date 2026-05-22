export const BSC_CHAIN_ID = 56;
export const BSC_EXPLORER_TX_URL = "https://bscscan.com/tx/";
export const BSC_PUBLIC_RPC_URL =
  process.env.EXPO_PUBLIC_BSC_RPC_URL ?? "https://bsc-dataseed-public.bnbchain.org";

type JsonRpcResponse<T> = {
  error?: { code: number; message: string };
  id: number;
  jsonrpc: "2.0";
  result?: T;
};

export async function bscRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(BSC_PUBLIC_RPC_URL, {
    body: JSON.stringify({
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
    throw new Error(payload.error?.message ?? `BSC RPC ${method} failed.`);
  }

  if (payload.result === undefined) {
    throw new Error(`BSC RPC ${method} returned no result.`);
  }

  return payload.result;
}

export async function getBscBalance(address: string) {
  return hexQuantityToBigInt(await bscRpc<string>("eth_getBalance", [address, "latest"]));
}

export async function getBscGasPrice() {
  return hexQuantityToBigInt(await bscRpc<string>("eth_gasPrice", []));
}

export async function getBscTransactionCount(address: string) {
  return hexQuantityToBigInt(await bscRpc<string>("eth_getTransactionCount", [address, "pending"]));
}

export async function estimateBscGas(input: {
  data: string;
  from: string;
  to: string;
  value?: bigint;
}) {
  return hexQuantityToBigInt(
    await bscRpc<string>("eth_estimateGas", [
      {
        data: input.data,
        from: input.from,
        to: input.to,
        value: quantityHex(input.value ?? 0n),
      },
    ]),
  );
}

export async function sendBscRawTransaction(rawTransaction: string) {
  const normalized = rawTransaction.startsWith("0x") ? rawTransaction : `0x${rawTransaction}`;
  return bscRpc<string>("eth_sendRawTransaction", [normalized]);
}

export function hexQuantityToBigInt(value: string) {
  return BigInt(value);
}

export function quantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}
