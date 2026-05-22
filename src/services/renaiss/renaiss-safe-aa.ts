import {
  concatHex,
  createPublicClient,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hashTypedData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { toAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { createSmartAccountClient } from "permissionless";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";

import type {
  TokenCoreAgentWallet,
  TokenCoreWalletAdapter,
} from "@/services/token-core/token-core-wallet-adapter";

type SafeCall = {
  data: string;
  to: string;
  value?: string | bigint | number | null;
};

type TokenCoreSafeInput = {
  adapter: TokenCoreWalletAdapter;
  ownerAddress: string;
  password: string;
  safeAddress: string;
};

type ExecuteSafeCallsInput = TokenCoreSafeInput & {
  calls: SafeCall[];
};

type SignSafeTypedDataInput = TokenCoreSafeInput & {
  typedData: unknown;
};

const RENAISS_SAFE_ENTRY_POINT = {
  address: entryPoint07Address,
  version: "0.7" as const,
};
const RENAISS_SAFE_VERSION = "1.4.1";
const SAFE_SALT_NONCE = BigInt(process.env.EXPO_PUBLIC_RENAISS_SAFE_SALT_NONCE ?? "0");
const BSC_RPC_URL =
  process.env.EXPO_PUBLIC_BSC_RPC_URL ??
  "https://bsc-mainnet.core.chainstack.com/49d2a7b830a6491783cb6bd0bde2285d";
const BUNDLER_URL =
  process.env.EXPO_PUBLIC_RENAISS_4337_BUNDLER_URL ??
  "https://api.pimlico.io/v2/56/rpc?apikey=pim_bUiUVv5RPeKY2JXksc5ReD";
const PAYMASTER_URL =
  process.env.EXPO_PUBLIC_RENAISS_4337_PAYMASTER_URL ??
  "https://api.pimlico.io/v2/56/rpc?apikey=pim_bUiUVv5RPeKY2JXksc5ReD";
const SPONSORSHIP_POLICY_ID =
  process.env.EXPO_PUBLIC_RENAISS_4337_SPONSORSHIP_POLICY_ID ?? "sp_cultured_jackal";

const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);

export async function executeRenaissSafeCalls(input: ExecuteSafeCallsInput) {
  const context = await createSafeContext(input);
  const txHash = await context.smartAccountClient.sendTransaction({
    calls: input.calls.map((call) => ({
      data: normalizeHex(call.data, "safe call data"),
      to: normalizeAddress(call.to, "safe call to"),
      value: normalizeValue(call.value),
    })),
  });
  await assertSafeOwner({
    ownerAddress: input.ownerAddress,
    publicClient: context.publicClient,
    safeAddress: input.safeAddress,
  });

  return {
    ownerAddress: context.ownerWallet.address,
    safeAddress: context.safeAddress,
    safeDeployedBefore: context.safeDeployedBefore,
    txHash,
  };
}

export async function ensureRenaissSafeDeployed(input: TokenCoreSafeInput) {
  const publicClient = createRenaissPublicClient();
  const safeAddress = normalizeAddress(input.safeAddress, "safeAddress");
  if (await isSafeDeployed(publicClient, safeAddress)) {
    await assertSafeOwner({
      ownerAddress: input.ownerAddress,
      publicClient,
      safeAddress,
    });
    return { deployed: true, safeAddress, txHash: null };
  }

  const result = await executeRenaissSafeCalls({
    ...input,
    calls: [
      {
        data: "0x",
        to: input.ownerAddress,
        value: "0",
      },
    ],
  });

  return { deployed: true, safeAddress, txHash: result.txHash };
}

export async function signRenaissSafeTypedData(input: SignSafeTypedDataInput) {
  const deployment = await ensureRenaissSafeDeployed(input);
  const ownerWallet = await loadMatchingOwnerWallet(input);
  const account = createTokenCoreOwnerAccount({
    adapter: input.adapter,
    ownerWallet,
    password: input.password,
  });
  const typedData = normalizeTypedData(input.typedData);
  const wrappedTypedData = {
    domain: {
      chainId: 56,
      verifyingContract: normalizeAddress(input.safeAddress, "safeAddress"),
    },
    message: {
      message: hashTypedData(typedData),
    },
    primaryType: "SafeMessage",
    types: {
      SafeMessage: [{ name: "message", type: "bytes" }],
    },
  } as const;
  const signature = normalizeSafeSignature(await account.signTypedData(wrappedTypedData));

  return {
    deploymentTxHash: deployment.txHash,
    messageHash: hashTypedData(typedData),
    safeMessageHash: hashTypedData(wrappedTypedData),
    signature,
  };
}

async function createSafeContext(input: TokenCoreSafeInput) {
  const safeAddress = normalizeAddress(input.safeAddress, "safeAddress");
  const publicClient = createRenaissPublicClient();
  const safeDeployedBefore = await isSafeDeployed(publicClient, safeAddress);
  const ownerWallet = await loadMatchingOwnerWallet(input);
  const ownerAccount = createTokenCoreOwnerAccount({
    adapter: input.adapter,
    ownerWallet,
    password: input.password,
  });
  const safeAccount = await toSafeSmartAccount({
    client: publicClient,
    entryPoint: RENAISS_SAFE_ENTRY_POINT,
    owners: [ownerAccount],
    saltNonce: SAFE_SALT_NONCE,
    version: RENAISS_SAFE_VERSION,
    ...(safeDeployedBefore ? { address: safeAddress } : {}),
  });

  if (safeAccount.address.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error(
      `Resolved Safe ${safeAccount.address} does not match RENAISS session wallet ${safeAddress}.`,
    );
  }

  const pimlicoBundlerClient = createPimlicoClient({
    chain: bsc,
    entryPoint: RENAISS_SAFE_ENTRY_POINT,
    transport: http(BUNDLER_URL),
  });
  const pimlicoPaymasterClient = createPimlicoClient({
    chain: bsc,
    entryPoint: RENAISS_SAFE_ENTRY_POINT,
    transport: http(PAYMASTER_URL),
  });
  const smartAccountClient = createSmartAccountClient({
    account: safeAccount,
    bundlerTransport: http(BUNDLER_URL),
    chain: bsc,
    client: publicClient,
    paymaster: pimlicoPaymasterClient,
    paymasterContext: SPONSORSHIP_POLICY_ID
      ? {
          sponsorshipPolicyId: SPONSORSHIP_POLICY_ID,
        }
      : undefined,
    userOperation: {
      estimateFeesPerGas: async () => {
        const prices = await pimlicoBundlerClient.getUserOperationGasPrice();
        return prices.fast ?? prices.standard ?? prices.slow;
      },
    },
  });

  return {
    ownerWallet,
    publicClient,
    safeAddress,
    safeDeployedBefore,
    smartAccountClient,
  };
}

function createRenaissPublicClient() {
  return createPublicClient({
    chain: bsc,
    transport: http(BSC_RPC_URL),
  });
}

async function loadMatchingOwnerWallet(input: TokenCoreSafeInput) {
  const ownerAddress = normalizeAddress(input.ownerAddress, "ownerAddress");
  const ownerWallet = await input.adapter.createAgentIdentityWallet({ password: input.password });
  if (ownerWallet.address.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error(
      `Token Core wallet ${ownerWallet.address} does not match RENAISS owner ${ownerAddress}.`,
    );
  }
  return ownerWallet;
}

function createTokenCoreOwnerAccount(input: {
  adapter: TokenCoreWalletAdapter;
  ownerWallet: TokenCoreAgentWallet;
  password: string;
}) {
  return toAccount({
    address: normalizeAddress(input.ownerWallet.address, "owner wallet"),
    async signMessage({ message }) {
      const payload = typeof message === "string" ? message : stringifyRawMessage(message);
      if (/^0x[0-9a-fA-F]+$/.test(payload)) {
        return (await input.adapter.signEthereumEcMessage({ messageHex: payload, password: input.password }))
          .signature as Hex;
      }
      return (await input.adapter.signPersonalMessage({ message: payload, password: input.password }))
        .signature as Hex;
    },
    async signTransaction() {
      throw new Error("RENAISS Safe account operations do not require owner raw transaction signing.");
    },
    async signTypedData(typedData) {
      const preimage = buildTypedDataPreimage(typedData as unknown as Parameters<typeof hashTypedData>[0]);
      return (await input.adapter.signEthereumEcMessage({ messageHex: preimage, password: input.password }))
        .signature as Hex;
    },
  });
}

function buildTypedDataPreimage(typedData: Parameters<typeof hashTypedData>[0]) {
  const domain = typedData.domain ?? {};
  const types = {
    EIP712Domain: getTypesForEIP712Domain({ domain }),
    ...typedData.types,
  };
  const parts: Hex[] = [
    "0x1901",
    hashDomain({
      domain,
      types,
    }),
  ];
  if (typedData.primaryType !== "EIP712Domain") {
    parts.push(
      hashStruct({
        data: typedData.message,
        primaryType: typedData.primaryType,
        types,
      }),
    );
  }
  return concatHex(parts);
}

async function isSafeDeployed(publicClient: ReturnType<typeof createRenaissPublicClient>, safeAddress: Address) {
  const code = await publicClient.getBytecode({ address: safeAddress });
  return typeof code === "string" && code !== "0x";
}

async function assertSafeOwner(input: {
  ownerAddress: string;
  publicClient: ReturnType<typeof createRenaissPublicClient>;
  safeAddress: string;
}) {
  const safeAddress = normalizeAddress(input.safeAddress, "safeAddress");
  const ownerAddress = normalizeAddress(input.ownerAddress, "ownerAddress");
  const [owners, threshold] = await Promise.all([
    input.publicClient.readContract({
      abi: SAFE_ABI,
      address: safeAddress,
      functionName: "getOwners",
    }),
    input.publicClient.readContract({
      abi: SAFE_ABI,
      address: safeAddress,
      functionName: "getThreshold",
    }),
  ]);
  if (!owners.some((owner) => owner.toLowerCase() === ownerAddress.toLowerCase())) {
    throw new Error(`Token Core owner ${ownerAddress} is not an owner of RENAISS Safe ${safeAddress}.`);
  }
  if (threshold > 1n) {
    throw new Error(`RENAISS Safe ${safeAddress} has threshold ${threshold}; only threshold-1 Safe wallets are supported.`);
  }
}

function normalizeTypedData(value: unknown): Parameters<typeof hashTypedData>[0] {
  if (!value || typeof value !== "object") {
    throw new Error("RENAISS buyNow typedData is missing.");
  }
  const typedData = value as Record<string, unknown>;
  if (!typedData.domain || !typedData.types || !typedData.primaryType || !typedData.message) {
    throw new Error("RENAISS buyNow typedData is incomplete.");
  }
  return typedData as Parameters<typeof hashTypedData>[0];
}

function normalizeSafeSignature(signature: string): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("Safe owner signature must be a 65-byte EVM signature.");
  }
  const v = Number.parseInt(signature.slice(-2), 16);
  if (v === 27 || v === 28) return signature as Hex;
  if (v === 0 || v === 1) {
    return `${signature.slice(0, -2)}${(v + 27).toString(16).padStart(2, "0")}` as Hex;
  }
  throw new Error(`Unsupported EVM signature v value: ${v}.`);
}

function normalizeAddress(value: string, label: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full EVM address.`);
  }
  return value as Address;
}

function normalizeHex(value: string, label: string): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be hex.`);
  }
  return value as Hex;
}

function normalizeValue(value: SafeCall["value"]) {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (/^\d+$/.test(value)) return BigInt(value);
  if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  throw new Error("Safe call value must be a decimal or hex integer.");
}

function stringifyRawMessage(message: unknown) {
  if (
    message &&
    typeof message === "object" &&
    "raw" in message &&
    typeof (message as { raw?: unknown }).raw === "string"
  ) {
    return (message as { raw: string }).raw;
  }
  return String(message);
}
