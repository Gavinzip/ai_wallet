import { getAgentApiBaseUrl } from "@/services/api-base-url";
import type { WalletToken } from "@/types/wallet";

const BALANCE_OF_SELECTOR = "70a08231";

type VerifiedEvmToken = {
  accent: string;
  address: string;
  decimals: number;
  iconLabel: string;
  name: string;
  symbol: string;
};

type WalletEvmChain = {
  accent: string;
  chainId: string;
  explorerAddressUrl: string;
  iconLabel: string;
  id: string;
  isTestnet?: boolean;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  tokens: VerifiedEvmToken[];
};

type JsonRpcResponse<T> = {
  error?: { code: number; message: string };
  id: number;
  jsonrpc: "2.0";
  result?: T;
};

export type WalletBalanceReadResult = {
  failedChains: string[];
  tokens: WalletToken[];
};

const EVM_WALLET_CHAINS: WalletEvmChain[] = [
  {
    accent: "#627EEA",
    chainId: "1",
    explorerAddressUrl: "https://etherscan.io/address/",
    iconLabel: "Ξ",
    id: "ethereum-mainnet",
    name: "Ethereum Mainnet",
    nativeSymbol: "ETH",
    rpcUrl: process.env.EXPO_PUBLIC_ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    tokens: [
      {
        accent: "#2775CA",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
        iconLabel: "$",
        name: "USD Coin",
        symbol: "USDC",
      },
      {
        accent: "#26A17B",
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
        iconLabel: "₮",
        name: "Tether USD",
        symbol: "USDT",
      },
      {
        accent: "#F5AC37",
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped Ether",
        symbol: "WETH",
      },
      {
        accent: "#F4B731",
        address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        decimals: 18,
        iconLabel: "D",
        name: "Dai Stablecoin",
        symbol: "DAI",
      },
      {
        accent: "#00A3FF",
        address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
        decimals: 18,
        iconLabel: "S",
        name: "Lido Staked Ether",
        symbol: "stETH",
      },
      {
        accent: "#00A3FF",
        address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped stETH",
        symbol: "wstETH",
      },
      {
        accent: "#7C5CFF",
        address: "0xd9A442856C234a39a81a089C06451EBAa4306a72",
        decimals: 18,
        iconLabel: "P",
        name: "Puffer pufETH",
        symbol: "pufETH",
      },
    ],
  },
  {
    accent: "#F0B90B",
    chainId: "56",
    explorerAddressUrl: "https://bscscan.com/address/",
    iconLabel: "B",
    id: "bsc-mainnet",
    name: "BNB Smart Chain",
    nativeSymbol: "BNB",
    rpcUrl: process.env.EXPO_PUBLIC_BSC_RPC_URL ?? "https://bsc-dataseed-public.bnbchain.org",
    tokens: [
      {
        accent: "#26A17B",
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        iconLabel: "₮",
        name: "Binance-Peg Tether USD",
        symbol: "USDT",
      },
      {
        accent: "#2775CA",
        address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        decimals: 18,
        iconLabel: "$",
        name: "Binance-Peg USD Coin",
        symbol: "USDC",
      },
      {
        accent: "#F0B90B",
        address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped BNB",
        symbol: "WBNB",
      },
      {
        accent: "#D1884F",
        address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
        decimals: 18,
        iconLabel: "C",
        name: "PancakeSwap Token",
        symbol: "CAKE",
      },
    ],
  },
  {
    accent: "#0052FF",
    chainId: "8453",
    explorerAddressUrl: "https://basescan.org/address/",
    iconLabel: "B",
    id: "base-mainnet",
    name: "Base",
    nativeSymbol: "ETH",
    rpcUrl: process.env.EXPO_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org",
    tokens: [
      {
        accent: "#2775CA",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        iconLabel: "$",
        name: "USD Coin",
        symbol: "USDC",
      },
      {
        accent: "#F5AC37",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped Ether",
        symbol: "WETH",
      },
    ],
  },
  {
    accent: "#8247E5",
    chainId: "137",
    explorerAddressUrl: "https://polygonscan.com/address/",
    iconLabel: "P",
    id: "polygon-mainnet",
    name: "Polygon",
    nativeSymbol: "POL",
    rpcUrl: process.env.EXPO_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com",
    tokens: [
      {
        accent: "#2775CA",
        address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        decimals: 6,
        iconLabel: "$",
        name: "USD Coin PoS",
        symbol: "USDC.e",
      },
      {
        accent: "#26A17B",
        address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        decimals: 6,
        iconLabel: "₮",
        name: "Tether USD",
        symbol: "USDT",
      },
      {
        accent: "#F5AC37",
        address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped Ether",
        symbol: "WETH",
      },
    ],
  },
  {
    accent: "#627EEA",
    chainId: "11155111",
    explorerAddressUrl: "https://sepolia.etherscan.io/address/",
    iconLabel: "S",
    id: "ethereum-sepolia",
    isTestnet: true,
    name: "Ethereum Sepolia",
    nativeSymbol: "SepoliaETH",
    rpcUrl: process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    tokens: [
      {
        accent: "#2775CA",
        address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        decimals: 6,
        iconLabel: "$",
        name: "USD Coin Sepolia",
        symbol: "USDC",
      },
      {
        accent: "#F5AC37",
        address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped Ether Sepolia",
        symbol: "WETH",
      },
    ],
  },
  {
    accent: "#627EEA",
    chainId: "17000",
    explorerAddressUrl: "https://holesky.etherscan.io/address/",
    iconLabel: "H",
    id: "ethereum-holesky",
    isTestnet: true,
    name: "Ethereum Holesky",
    nativeSymbol: "HoleskyETH",
    rpcUrl: process.env.EXPO_PUBLIC_HOLESKY_RPC_URL ?? "https://holesky.drpc.org",
    tokens: [
      {
        accent: "#00A3FF",
        address: "0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034",
        decimals: 18,
        iconLabel: "S",
        name: "Lido Staked Ether Holesky",
        symbol: "stETH",
      },
      {
        accent: "#00A3FF",
        address: "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped stETH Holesky",
        symbol: "wstETH",
      },
      {
        accent: "#7C5CFF",
        address: "0x9196830bB4c05504E0A8475A0aD566AceEB6BeC9",
        decimals: 18,
        iconLabel: "P",
        name: "Puffer pufETH Holesky",
        symbol: "pufETH",
      },
    ],
  },
  {
    accent: "#F0B90B",
    chainId: "97",
    explorerAddressUrl: "https://testnet.bscscan.com/address/",
    iconLabel: "T",
    id: "bsc-testnet",
    isTestnet: true,
    name: "BNB Smart Chain Testnet",
    nativeSymbol: "tBNB",
    rpcUrl: process.env.EXPO_PUBLIC_BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-dataseed.bnbchain.org",
    tokens: [
      {
        accent: "#F0B90B",
        address: "0xae13d989dac2f0debff460ac112a837c89baa7cd",
        decimals: 18,
        iconLabel: "W",
        name: "Wrapped BNB Testnet",
        symbol: "WBNB",
      },
    ],
  },
];

export async function readVerifiedEvmWalletTokens(address: string): Promise<WalletBalanceReadResult> {
  assertAddress(address, "wallet");

  const results = await Promise.allSettled(
    EVM_WALLET_CHAINS.map(async (chain) => readChainWalletTokens(chain, address)),
  );
  const tokens: WalletToken[] = [];
  const failedChains: string[] = [];

  results.forEach((result, index) => {
    const chain = EVM_WALLET_CHAINS[index];
    if (!chain) return;
    if (result.status === "fulfilled") {
      tokens.push(...result.value);
    } else {
      failedChains.push(chain.name);
    }
  });

  return {
    failedChains,
    tokens: tokens.sort(compareWalletTokens),
  };
}

export function summarizeNativeBalances(tokens: WalletToken[]) {
  const nativeTokens = tokens.filter((token) => token.isNative);
  const nonZeroNative = nativeTokens.find((token) => BigInt(token.rawBalance ?? "0") > 0n);
  return nonZeroNative?.balanceLabel ?? nativeTokens[0]?.balanceLabel ?? null;
}

async function readChainWalletTokens(chain: WalletEvmChain, owner: string): Promise<WalletToken[]> {
  const [nativeBalance, ...tokenBalances] = await Promise.all([
    readNativeBalance(chain, owner),
    ...chain.tokens.map((token) => readErc20RawBalance(chain, owner, token)),
  ]);

  const tokens: WalletToken[] = [
    {
      accent: chain.accent,
      balanceLabel: `${formatDisplayAmount(nativeBalance, 18)} ${chain.nativeSymbol}`,
      chain: chain.name,
      chainId: chain.chainId,
      change: null,
      explorerAddressUrl: `${chain.explorerAddressUrl}${owner}`,
      fiatValue: `${chain.name}${chain.isTestnet ? " testnet" : ""} native coin`,
      iconLabel: chain.iconLabel,
      id: `${chain.id}-native`,
      isNative: true,
      isTestnet: Boolean(chain.isTestnet),
      name: chain.nativeSymbol,
      rawBalance: nativeBalance.toString(),
      sparkline: [],
      symbol: chain.nativeSymbol,
      tokenAddress: null,
    },
  ];

  chain.tokens.forEach((token, index) => {
    const balance = tokenBalances[index] ?? 0n;
    tokens.push({
      accent: token.accent,
      balanceLabel: `${formatDisplayAmount(balance, token.decimals)} ${token.symbol}`,
      chain: chain.name,
      chainId: chain.chainId,
      change: null,
      explorerAddressUrl: `${chain.explorerAddressUrl}${owner}`,
      fiatValue: `${chain.name} · ${shortAddress(token.address)}`,
      iconLabel: token.iconLabel,
      id: `${chain.id}-${token.symbol.toLowerCase()}-${token.address.toLowerCase()}`,
      isNative: false,
      isTestnet: Boolean(chain.isTestnet),
      name: token.name,
      rawBalance: balance.toString(),
      sparkline: [],
      symbol: token.symbol,
      tokenAddress: token.address,
    });
  });

  return tokens;
}

async function readNativeBalance(chain: WalletEvmChain, owner: string) {
  return hexQuantityToBigInt(await evmRpc<string>(chain, "eth_getBalance", [owner, "latest"]));
}

async function readErc20RawBalance(chain: WalletEvmChain, owner: string, token: VerifiedEvmToken) {
  const data = `0x${BALANCE_OF_SELECTOR}${encodeAddress(owner)}`;
  const result = await evmRpc<string>(chain, "eth_call", [{ data, to: token.address }, "latest"]);
  return BigInt(result);
}

async function evmRpc<T>(chain: WalletEvmChain, method: string, params: unknown[]): Promise<T> {
  const useProxy = process.env.EXPO_PUBLIC_WALLET_RPC_PROXY === "1";
  const response = await fetch(useProxy ? `${getAgentApiBaseUrl("EVM wallet RPC proxy")}/api/evm/rpc` : chain.rpcUrl, {
    body: JSON.stringify(
      useProxy
        ? {
            chainId: chain.chainId,
            method,
            params,
          }
        : {
            id: Date.now(),
            jsonrpc: "2.0",
            method,
            params,
          },
    ),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `${chain.name} RPC ${method} failed.`);
  }
  if (payload.result === undefined) {
    throw new Error(`${chain.name} RPC ${method} returned no result.`);
  }
  return payload.result;
}

function compareWalletTokens(a: WalletToken, b: WalletToken) {
  const aNonZero = BigInt(a.rawBalance ?? "0") > 0n;
  const bNonZero = BigInt(b.rawBalance ?? "0") > 0n;
  if (aNonZero !== bNonZero) return aNonZero ? -1 : 1;

  const aChainIndex = EVM_WALLET_CHAINS.findIndex((chain) => chain.chainId === a.chainId);
  const bChainIndex = EVM_WALLET_CHAINS.findIndex((chain) => chain.chainId === b.chainId);
  if (aChainIndex !== bChainIndex) return aChainIndex - bChainIndex;

  if (a.isNative !== b.isNative) return a.isNative ? -1 : 1;
  return a.symbol.localeCompare(b.symbol);
}

function encodeAddress(address: string) {
  assertAddress(address, "address");
  return strip0x(address).toLowerCase().padStart(64, "0");
}

function formatDisplayAmount(value: bigint, decimals: number) {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();

  const paddedFraction = fraction.toString().padStart(decimals, "0");
  const trimmedFraction = paddedFraction.slice(0, 6).replace(/0+$/, "");
  return trimmedFraction ? `${whole.toString()}.${trimmedFraction}` : whole.toString();
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function assertAddress(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${label} address.`);
  }
}

function hexQuantityToBigInt(value: string) {
  return BigInt(value);
}

function strip0x(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}
