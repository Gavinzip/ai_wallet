import type { BscDefiProtocol } from "@/types/defi";

export const bscDefiProtocols: BscDefiProtocol[] = [
  {
    capabilities: [
      "Create swap DApp intent",
      "Review from/to token, fee, price impact, and slippage before signing",
      "Route through PancakeSwap liquidity after user confirmation",
    ],
    category: "Swap",
    chain: "BNB Smart Chain",
    dappUrl: "https://pancakeswap.finance/swap",
    description:
      "BNB Chain DEX for token swaps. PancakeSwap docs state users should review chains, tokens, fees, price impact, and slippage before confirming.",
    docsUrl: "https://docs.pancakeswap.finance/trade/crosschain-swaps/how-to-do-a-crosschain-swap",
    id: "pancakeswap-swap",
    name: "PancakeSwap",
    riskLevel: "warning",
    safetyChecks: [
      "Use only the official pancakeswap.finance/swap URL.",
      "Review token pair, network, fee, price impact, and slippage.",
      "Do not sign until Token Core decodes the final DApp request.",
    ],
    sourceLabel: "Official PancakeSwap docs",
  },
  {
    capabilities: [
      "Create lending/borrow DApp intent",
      "Review supply asset, borrow asset, pool, collateral, and liquidation risk",
      "Require local Token Core signature for any supply, borrow, repay, or withdraw",
    ],
    category: "Lending",
    chain: "BNB Smart Chain",
    dappUrl: "https://app.venus.io/",
    description:
      "Venus Protocol is a lending and borrowing protocol on BNB Chain with supply, borrow, pool, vault, swap, history, and governance interfaces.",
    docsUrl: "https://docs-v4.venus.io/guides/interface",
    id: "venus-lending",
    name: "Venus Protocol",
    riskLevel: "danger",
    safetyChecks: [
      "Review collateral factor, borrow amount, APY, and liquidation risk.",
      "Do not approve unlimited token spend.",
      "Do not sign until Token Core decodes the final DApp request.",
    ],
    sourceLabel: "Official Venus docs",
  },
  {
    capabilities: [
      "Create liquid staking DApp intent",
      "Review BNB staking amount, slisBNB receipt, and CDP/lisUSD borrowing risk",
      "Require local Token Core signature for staking, minting, borrowing, or locking",
    ],
    category: "Liquid staking",
    chain: "BNB Smart Chain",
    dappUrl: "https://lista.org/",
    description:
      "Lista DAO provides BNB liquid staking, slisBNB, lisUSD CDP borrowing, and lending features on BNB Chain.",
    docsUrl: "https://docs.bsc.lista.org/",
    id: "lista-liquid-staking",
    name: "Lista DAO",
    riskLevel: "danger",
    safetyChecks: [
      "Review BNB stake amount, received asset, and withdrawal or lock conditions.",
      "Review CDP collateral ratio before any lisUSD borrow intent.",
      "Do not sign until Token Core decodes the final DApp request.",
    ],
    sourceLabel: "Official Lista docs",
  },
];
