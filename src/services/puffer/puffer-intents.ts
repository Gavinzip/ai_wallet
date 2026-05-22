import {
  Chain,
  CONTRACT_ADDRESSES,
  TOKENS_ADDRESSES,
  UnifiToken,
  VAULTS_ADDRESSES,
} from "@pufferfinance/puffer-sdk";

import {
  estimateEthereumGas,
  ethereumRpc,
  ETHEREUM_CHAIN_ID,
  getEthereumGasPrice,
  getEthereumTransactionCount,
  HOLESKY_CHAIN_ID,
} from "@/services/defi/ethereum-rpc";
import type { EvmTransactionPayload, WalletIntent } from "@/types/intent";
import type {
  PreparedPufferDeposit,
  PufferDepositAsset,
  PufferNetworkMode,
  PufferRateSnapshot,
  PufferVaultOpportunity,
} from "@/types/puffer";

const PREVIEW_DEPOSIT_SELECTOR = "ef8b30f7";
const DEPOSIT_ETH_SELECTOR = "2d2da806";
const BALANCE_OF_SELECTOR = "70a08231";
const MAINNET = Chain.Mainnet;
const HOLESKY = Chain.Holesky;
const PUFETH_DECIMALS = 18;

type PufferNetworkConfig = {
  chain: PufferRateSnapshot["chain"];
  chainId: string;
  isTestnet: boolean;
  networkMode: PufferNetworkMode;
  pufEthAddress: string;
  pufferDepositorAddress: string;
  pufferVaultAddress: string;
  sdkChain: Chain.Mainnet | Chain.Holesky;
};

export const PUFFER_APP_URL = "https://app.puffer.fi/";
export const PUFFER_SDK_DOCS_URL = "https://pufferfinance.github.io/puffer-sdk/";
export const PUFFER_TESTNET_NOTE =
  "Puffer SDK does not expose PufferVault/PufferDepositor on Sepolia. Testnet Puffer staking uses Ethereum Holesky.";

export const PUFFER_VAULT_ADDRESS = requireSdkAddress(
  CONTRACT_ADDRESSES[MAINNET].PufferVault,
  "PufferVault",
  "Ethereum Mainnet",
);
export const PUFFER_DEPOSITOR_ADDRESS = requireSdkAddress(
  CONTRACT_ADDRESSES[MAINNET].PufferDepositor,
  "PufferDepositor",
  "Ethereum Mainnet",
);
export const PUFETH_ADDRESS = requireSdkAddress(
  TOKENS_ADDRESSES.pufETH[MAINNET],
  "pufETH",
  "Ethereum Mainnet",
);

export const PUFFER_UNIFI_VAULTS: PufferVaultOpportunity[] = [
  {
    accepts: "pufETH",
    contractAddress: VAULTS_ADDRESSES[UnifiToken.unifiETH][MAINNET].NucleusBoringVault,
    id: "unifi-eth",
    name: "UniFi ETH Vault",
    outputToken: "unifiETH",
    summary: "Automated pufETH vault for UniFi ETH exposure and CARROT rewards.",
  },
  {
    accepts: "USDC / USDT / stablecoins",
    contractAddress: VAULTS_ADDRESSES[UnifiToken.unifiUSD][MAINNET].NucleusBoringVault,
    id: "unifi-usd",
    name: "UniFi USD Vault",
    outputToken: "unifiUSD",
    summary: "Stablecoin vault opportunity listed by the Puffer SDK vault registry.",
  },
  {
    accepts: "WBTC / BTC wrappers",
    contractAddress: VAULTS_ADDRESSES[UnifiToken.unifiBTC][MAINNET].NucleusBoringVault,
    id: "unifi-btc",
    name: "UniFi BTC Vault",
    outputToken: "unifiBTC",
    summary: "BTC strategy vault opportunity listed by the Puffer SDK vault registry.",
  },
  {
    accepts: "pufETH",
    contractAddress: VAULTS_ADDRESSES[UnifiToken.pufETHs][MAINNET].NucleusBoringVault,
    id: "pufeths",
    name: "pufETHs Vault",
    outputToken: "pufETHs",
    summary: "Puffer pufETH strategy vault exposed through the SDK vault address map.",
  },
];

export function getPufferNetworkConfig(networkMode: PufferNetworkMode = "mainnet"): PufferNetworkConfig {
  const isTestnet = networkMode === "testnet";
  const sdkChain = (isTestnet ? HOLESKY : MAINNET) as Chain.Mainnet | Chain.Holesky;
  const chain = isTestnet ? "Ethereum Holesky" : "Ethereum Mainnet";

  return {
    chain,
    chainId: String(isTestnet ? HOLESKY_CHAIN_ID : ETHEREUM_CHAIN_ID),
    isTestnet,
    networkMode,
    pufEthAddress: requireSdkAddress(TOKENS_ADDRESSES.pufETH[sdkChain], "pufETH", chain),
    pufferDepositorAddress: requireSdkAddress(
      CONTRACT_ADDRESSES[sdkChain]?.PufferDepositor,
      "PufferDepositor",
      chain,
    ),
    pufferVaultAddress: requireSdkAddress(CONTRACT_ADDRESSES[sdkChain]?.PufferVault, "PufferVault", chain),
    sdkChain,
  };
}

export function getPufferUnifiVaults(networkMode: PufferNetworkMode = "mainnet") {
  return networkMode === "mainnet" ? PUFFER_UNIFI_VAULTS : [];
}

export async function readPufferRateSnapshot(
  input?: string | null | { networkMode?: PufferNetworkMode; walletAddress?: string | null },
): Promise<PufferRateSnapshot> {
  const normalizedInput =
    typeof input === "string" || input === null ? { walletAddress: input } : input ?? {};
  const config = getPufferNetworkConfig(normalizedInput.networkMode ?? "mainnet");
  const [shares, walletPufEthBalance] = await Promise.all([
    readPreviewDeposit(parseUnits("1", PUFETH_DECIMALS), config),
    normalizedInput.walletAddress ? readPufEthBalance(normalizedInput.walletAddress, config) : Promise.resolve(null),
  ]);

  return {
    chain: config.chain,
    chainId: config.chainId,
    isTestnet: config.isTestnet,
    networkMode: config.networkMode,
    pufEthAddress: config.pufEthAddress,
    pufferDepositorAddress: config.pufferDepositorAddress,
    pufferVaultAddress: config.pufferVaultAddress,
    rateLabel: `1 ETH = ${formatDisplayUnits(shares, PUFETH_DECIMALS, 6)} pufETH`,
    updatedAt: new Date().toISOString(),
    walletPufEthBalance,
  };
}

export async function preparePufferEthDepositIntent(input: {
  amountEth: string;
  fromAddress: string;
  networkMode?: PufferNetworkMode;
}): Promise<PreparedPufferDeposit> {
  assertAddress(input.fromAddress, "wallet");
  const config = getPufferNetworkConfig(input.networkMode ?? "mainnet");
  const amountWei = parseUnits(input.amountEth, 18);
  if (amountWei <= 0n) {
    throw new Error("Puffer deposit amount must be greater than zero.");
  }

  const receiver = input.fromAddress;
  const data = encodeDepositEth(receiver);
  const network = { chainId: config.chainId };
  const [nonce, gasPrice, gasEstimate, expectedPufEthWei] = await Promise.all([
    getEthereumTransactionCount(input.fromAddress, network),
    getEthereumGasPrice(network),
    estimateEthereumGas(
      {
        data,
        from: input.fromAddress,
        to: config.pufferVaultAddress,
        value: amountWei,
      },
      network,
    ),
    readPreviewDeposit(amountWei, config),
  ]);

  const evmTx: EvmTransactionPayload = {
    chainId: config.chainId,
    data,
    gasLimit: addGasBuffer(gasEstimate).toString(),
    gasPrice: gasPrice.toString(),
    nonce: nonce.toString(),
    to: config.pufferVaultAddress,
    txType: "00",
    value: amountWei.toString(),
  };
  const expectedPufEth = formatDisplayUnits(expectedPufEthWei, PUFETH_DECIMALS, 6);

  return {
    expectedPufEth,
    intent: createPufferEthDepositIntent({
      amountEth: input.amountEth,
      chain: config.chain,
      evmTx,
      expectedPufEth,
      networkMode: config.networkMode,
      pufEthAddress: config.pufEthAddress,
      pufferVaultAddress: config.pufferVaultAddress,
      receiver,
    }),
    rateLabel: `${input.amountEth} ETH -> about ${expectedPufEth} pufETH on ${config.chain}`,
  };
}

export function createPufferTokenDepositReviewIntent(input: {
  amount: string;
  asset: Exclude<PufferDepositAsset, "ETH">;
  networkMode?: PufferNetworkMode;
  walletAddress: string;
}): WalletIntent {
  assertAddress(input.walletAddress, "wallet");
  const config = getPufferNetworkConfig(input.networkMode ?? "mainnet");
  const tokenAddress = requireSdkAddress(
    input.asset === "stETH" ? TOKENS_ADDRESSES.stETH[config.sdkChain] : TOKENS_ADDRESSES.wstETH[config.sdkChain],
    input.asset,
    config.chain,
  );

  return {
    actions: [
      {
        amount: input.amount,
        chain: config.chain,
        dappUrl: PUFFER_APP_URL,
        data: null,
        message: null,
        params: {
          asset: input.asset,
          depositor: config.pufferDepositorAddress,
          networkMode: config.networkMode,
          pufEth: config.pufEthAddress,
          protocol: "Puffer",
          reviewOnly: true,
          tokenAddress,
        },
        to: config.pufferDepositorAddress,
        token: `${input.asset} -> pufETH`,
        type: "dapp_request",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId(`puffer-${input.asset.toLowerCase()}-deposit-review`),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      `PufferDepositor uses ERC20 permit data for this asset path on ${config.chain}.`,
      "This app shows the exact PufferDepositor and token address before any wallet interaction.",
      "Local signing is blocked until the ERC20 permit payload is decoded and reviewed.",
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Review ${input.amount} ${input.asset} deposit into Puffer for pufETH through the official PufferDepositor path on ${config.chain}.`,
    title: `Puffer ${input.asset} Deposit Review`,
  };
}

function createPufferEthDepositIntent(input: {
  amountEth: string;
  chain: PufferRateSnapshot["chain"];
  evmTx: EvmTransactionPayload;
  expectedPufEth: string;
  networkMode: PufferNetworkMode;
  pufEthAddress: string;
  pufferVaultAddress: string;
  receiver: string;
}): WalletIntent {
  const modeLabel = input.networkMode === "testnet" ? "Holesky Testnet" : "Mainnet";
  return {
    actions: [
      {
        amount: input.amountEth,
        chain: input.chain,
        dappUrl: PUFFER_APP_URL,
        data: input.evmTx.data,
        evmTx: input.evmTx,
        message: null,
        params: {
          expectedPufEth: input.expectedPufEth,
          function: "depositETH(address)",
          networkMode: input.networkMode,
          protocol: "Puffer",
          pufEth: input.pufEthAddress,
          receiver: input.receiver,
          vault: input.pufferVaultAddress,
        },
        to: input.pufferVaultAddress,
        token: "ETH -> pufETH",
        type: "transfer",
      },
    ],
    createdAt: new Date().toISOString(),
    id: makeIntentId("puffer-eth-deposit"),
    requiresLocalSignature: true,
    requiresUserConfirmation: true,
    riskLevel: "warning",
    safetyChecks: [
      `Uses the PufferVault depositETH(address) function on ${input.chain}.`,
      "Recipient is the connected wallet address.",
      "Expected pufETH is previewed with the vault previewDeposit read call.",
      "Gas, nonce, calldata, value, and chainId are shown before signing.",
      "Server and AI can only prepare this intent.",
      "Final signing must happen on this device through Token Core.",
    ],
    serverCanExecute: false,
    status: "needs_review",
    summary: `Deposit ${input.amountEth} ETH into Puffer and mint about ${input.expectedPufEth} pufETH on ${input.chain}.`,
    title: `Puffer ETH to pufETH (${modeLabel})`,
  };
}

async function readPreviewDeposit(amountWei: bigint, config: PufferNetworkConfig) {
  const data = `0x${PREVIEW_DEPOSIT_SELECTOR}${encodeUint(amountWei)}`;
  const result = await ethereumRpc<string>(
    "eth_call",
    [{ data, to: config.pufferVaultAddress }, "latest"],
    { chainId: config.chainId },
  );
  return BigInt(result);
}

async function readPufEthBalance(walletAddress: string, config: PufferNetworkConfig) {
  assertAddress(walletAddress, "wallet");
  const data = `0x${BALANCE_OF_SELECTOR}${encodeAddress(walletAddress)}`;
  const result = await ethereumRpc<string>(
    "eth_call",
    [{ data, to: config.pufEthAddress }, "latest"],
    { chainId: config.chainId },
  );
  return formatDisplayUnits(BigInt(result), PUFETH_DECIMALS, 6);
}

function encodeDepositEth(receiver: string) {
  return `0x${DEPOSIT_ETH_SELECTOR}${encodeAddress(receiver)}`;
}

function addGasBuffer(gasEstimate: bigint) {
  return (gasEstimate * 120n) / 100n;
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

function parseUnits(value: string, decimals: number) {
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

function formatDisplayUnits(value: bigint, decimals: number, maxFractionDigits: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function assertAddress(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${label} address.`);
  }
}

function strip0x(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function makeIntentId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function requireSdkAddress(value: string | undefined, label: string, chain: string) {
  if (!value) {
    throw new Error(`Puffer SDK did not provide ${label} address for ${chain}.`);
  }
  return value;
}
