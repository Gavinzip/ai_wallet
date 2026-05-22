import {
  BSC_CHAIN_ID,
  estimateBscGas,
  getBscGasPrice,
  getBscTransactionCount,
} from "@/services/defi/bsc-rpc";
import type { WalletIntent } from "@/types/intent";

const BNB_DECIMALS = 18;

export async function prepareBscNativeTransferIntent(input: {
  amountInBnb: string;
  fromAddress: string;
  toAddress: string;
}): Promise<WalletIntent> {
  const toAddress = normalizeEvmAddress(input.toAddress);
  const value = parseDecimalAmount(input.amountInBnb, BNB_DECIMALS);

  if (value <= 0n) {
    throw new Error("BNB amount must be greater than zero.");
  }

  const [nonce, gasPrice, gasLimit] = await Promise.all([
    getBscTransactionCount(input.fromAddress),
    getBscGasPrice(),
    estimateBscGas({
      data: "0x",
      from: input.fromAddress,
      to: toAddress,
      value,
    }),
  ]);

  return {
    actions: [
      {
        amount: `${input.amountInBnb.trim()} BNB`,
        chain: "BNB Smart Chain",
        data: "0x",
        dappUrl: null,
        evmTx: {
          chainId: String(BSC_CHAIN_ID),
          data: "0x",
          gasLimit: gasLimit.toString(),
          gasPrice: gasPrice.toString(),
          nonce: nonce.toString(),
          to: toAddress,
          value: value.toString(),
        },
        message: null,
        params: {
          gasLimit: gasLimit.toString(),
          gasPriceWei: gasPrice.toString(),
          nonce: nonce.toString(),
        },
        to: toAddress,
        token: "BNB",
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId("bsc-bnb-transfer"),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      "Recipient must be a full EVM address shown in this review.",
      "Nonce, gas price, gas limit, and value were read from real BSC RPC before signing.",
      "Server and AI can only prepare this intent.",
      "Final signing and broadcast must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Send ${input.amountInBnb.trim()} BNB on BNB Smart Chain after local safety review.`,
    title: "BSC BNB Transfer",
  };
}

function normalizeEvmAddress(value: string) {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error("Recipient must be a full 0x EVM address.");
  }
  return trimmed;
}

function parseDecimalAmount(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amount must be a decimal number.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

function makeIntentId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}
