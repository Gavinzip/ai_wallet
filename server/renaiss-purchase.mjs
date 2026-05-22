import crypto from "node:crypto";

import { keccak_256 } from "@noble/hashes/sha3";

export const RENAISS_PURCHASE_CHAIN_ID = 56;
export const RENAISS_PURCHASE_ORIGIN = "https://www.renaiss.xyz";
export const RENAISS_PURCHASE_CONTRACTS = {
  nft: "0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30",
  orderbook: "0xAE3e7268EF5A062946216A44f58A8F685fFD11d0",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  usdt: "0x55d398326f99059fF775485246999027B3197955",
};
export const RENAISS_ORDERBOOK = {
  domainName: "Renaiss OrderBook",
  domainVersion: "1",
  platformFeeBps: 200n,
};

const BSC_RPC_URL =
  process.env.BSC_RPC_URL ??
  process.env.EXPO_PUBLIC_BSC_RPC_URL ??
  "https://bsc-dataseed-public.bnbchain.org";
const BNB_DECIMALS = 18;
const USDT_DECIMALS = 18;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_ALLOWANCE_THRESHOLD = MAX_UINT256 / 2n;
const BUY_DEADLINE_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SAFE_MIN_BNB = "0.003";
const NATIVE_TRANSFER_GAS_BUFFER = 25_200n;
const SELECTORS = {
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  balanceOf: "0x70a08231",
  transfer: "0xa9059cbb",
};

export async function buildRenaissPurchasePlan({ context, session, walletAddress }) {
  const signerAddress = normalizeAddress(walletAddress, "walletAddress");
  const tokenId = extractRenaissTokenId(context.renaissUrl);
  const collectibleId = normalizeCollectibleId(context.itemId);
  const amount = parseUsdtDisplayAmount(context.askPriceUsd);
  const sessionSummary = session?.session ?? null;
  const sessionWallet = maybeNormalizeAddress(sessionSummary?.walletAddress);
  const sessionOwner = maybeNormalizeAddress(sessionSummary?.ownerWalletAddress);
  const sessionAuthenticated = Boolean(session?.cookieHeader && sessionSummary?.authenticated);
  const directSigner =
    sessionAuthenticated &&
    sessionWallet !== null &&
    addressesEqual(sessionWallet, signerAddress) &&
    (!sessionOwner || addressesEqual(sessionOwner, signerAddress));
  const safeSigner =
    sessionAuthenticated &&
    sessionWallet !== null &&
    sessionOwner !== null &&
    !addressesEqual(sessionWallet, signerAddress) &&
    addressesEqual(sessionOwner, signerAddress);
  const payerAddress = directSigner || safeSigner ? sessionWallet : signerAddress;
  const signatureMode = safeSigner ? "safe_eip1271" : "owner_eoa";

  const base = {
    amount,
    amountDisplay: formatTokenAmount(amount, USDT_DECIMALS),
    cardName: context.name,
    collectibleId,
    contracts: RENAISS_PURCHASE_CONTRACTS,
    directSigner,
    imageUrl: context.imageUrl ?? null,
    orderbook: {
      domainName: RENAISS_ORDERBOOK.domainName,
      domainVersion: RENAISS_ORDERBOOK.domainVersion,
      platformFeeBps: RENAISS_ORDERBOOK.platformFeeBps.toString(),
    },
    payerAddress,
    renaissUrl: context.renaissUrl ?? null,
    session: {
      authenticated: sessionAuthenticated,
      ownerWalletAddress: sessionOwner,
      walletAddress: sessionWallet,
    },
    signatureMode,
    signerAddress,
    safe: safeSigner
      ? {
          address: sessionWallet,
          ownerAddress: signerAddress,
        }
      : null,
    tokenId,
  };

  if (!sessionAuthenticated) {
    return {
      ...base,
      blockers: [
        {
          code: "RENAISS_SESSION_REQUIRED",
          message: "需要先用這個 Token Core 錢包簽 RENAISS SIWE 登入，才能送 buyNow。",
        },
      ],
      nextStep: "login",
    };
  }

  if (!directSigner && !safeSigner) {
    return {
      ...base,
      blockers: [
        {
          code: "RENAISS_SESSION_WALLET_MISMATCH",
          message:
            "這個 RENAISS session 的 ownerWalletAddress 不是目前 Token Core signer，不能確認你控制付款 Safe/app wallet。",
        },
      ],
      nextStep: "blocked",
    };
  }

  const [bnbBalance, usdtBalance, allowance, payerCode] = await Promise.all([
    readNativeBalance(payerAddress),
    readErc20Balance(RENAISS_PURCHASE_CONTRACTS.usdt, payerAddress),
    readErc20Allowance(RENAISS_PURCHASE_CONTRACTS.usdt, payerAddress, RENAISS_PURCHASE_CONTRACTS.permit2),
    readContractCode(payerAddress),
  ]);

  const balances = {
    bnbDisplay: formatTokenAmount(bnbBalance, BNB_DECIMALS),
    bnbWei: bnbBalance.toString(),
    payerAddress,
    payerCodeDeployed: payerCode !== "0x",
    usdt: usdtBalance.toString(),
    usdtDisplay: formatTokenAmount(usdtBalance, USDT_DECIMALS),
  };
  const permit2 = {
    allowance: allowance.toString(),
    allowanceDisplay: formatTokenAmount(allowance, USDT_DECIMALS),
    hasSufficientAllowance: allowance >= amount || allowance >= MAX_ALLOWANCE_THRESHOLD,
    spender: RENAISS_PURCHASE_CONTRACTS.permit2,
  };

  const minSafeBnb = getRenaissSafeMinBnbWei();
  if (safeSigner && bnbBalance < minSafeBnb) {
    const fundAmount = minSafeBnb - bnbBalance;
    const ownerBnbBalance = await readNativeBalance(signerAddress);
    const funding = {
      amount: fundAmount.toString(),
      amountDisplay: formatTokenAmount(fundAmount, BNB_DECIMALS),
      asset: "BNB",
      ownerBalances: {
        bnbDisplay: formatTokenAmount(ownerBnbBalance, BNB_DECIMALS),
        bnbWei: ownerBnbBalance.toString(),
      },
      targetMinBnb: minSafeBnb.toString(),
      targetMinBnbDisplay: formatTokenAmount(minSafeBnb, BNB_DECIMALS),
    };
    const gasPrice = await rpc("eth_gasPrice", []).then(hexToBigInt);
    const estimatedGasCost = NATIVE_TRANSFER_GAS_BUFFER * gasPrice;
    if (ownerBnbBalance < fundAmount + estimatedGasCost) {
      return {
        ...base,
        balances,
        blockers: [
          {
            code: "INSUFFICIENT_OWNER_BNB_FOR_SAFE_BNB",
            message: `RENAISS 付款錢包 BNB buffer 不足，需要先補 ${funding.amountDisplay} BNB；但 Token Core owner 需要同時支付轉帳 gas，總共約 ${formatTokenAmount(fundAmount + estimatedGasCost, BNB_DECIMALS)} BNB，目前 ${funding.ownerBalances.bnbDisplay} BNB。`,
          },
        ],
        funding: {
          ...funding,
          gasCostWei: estimatedGasCost.toString(),
        },
        nextStep: "blocked",
        permit2,
      };
    }
    const fundTx = await buildNativeTransferTx({
      amount: fundAmount,
      from: signerAddress,
      to: payerAddress,
    });
    const gasCost = BigInt(fundTx.gasLimit) * BigInt(fundTx.gasPrice);
    return {
      ...base,
      balances,
      blockers: [],
      funding: {
        ...funding,
        gasCostWei: gasCost.toString(),
      },
      fundTx,
      nextStep: "fund_safe_bnb",
      permit2,
    };
  }

  if (usdtBalance < amount) {
    if (safeSigner) {
      const fundAmount = amount - usdtBalance;
      const [ownerBnbBalance, ownerUsdtBalance] = await Promise.all([
        readNativeBalance(signerAddress),
        readErc20Balance(RENAISS_PURCHASE_CONTRACTS.usdt, signerAddress),
      ]);
      const funding = {
        amount: fundAmount.toString(),
        amountDisplay: formatTokenAmount(fundAmount, USDT_DECIMALS),
        ownerBalances: {
          bnbDisplay: formatTokenAmount(ownerBnbBalance, BNB_DECIMALS),
          bnbWei: ownerBnbBalance.toString(),
          usdt: ownerUsdtBalance.toString(),
          usdtDisplay: formatTokenAmount(ownerUsdtBalance, USDT_DECIMALS),
        },
      };
      if (ownerUsdtBalance >= fundAmount) {
        const fundTx = await buildUsdtTransferTx({
          amount: fundAmount,
          from: signerAddress,
          to: payerAddress,
        });
        const gasCost = BigInt(fundTx.gasLimit) * BigInt(fundTx.gasPrice);
        if (ownerBnbBalance >= gasCost) {
          return {
            ...base,
            balances,
            blockers: [],
            funding: {
              ...funding,
              gasCostWei: gasCost.toString(),
            },
            fundTx,
            nextStep: "fund_safe_usdt",
            permit2,
          };
        }
        return {
          ...base,
          balances,
          blockers: [
            {
              code: "INSUFFICIENT_OWNER_BNB_FOR_FUNDING",
              message: `Token Core owner 錢包 BNB 不足，無法先把 USDT 轉到 RENAISS 付款錢包。需要約 ${gasCost.toString()} wei gas，目前 ${ownerBnbBalance.toString()} wei。`,
            },
          ],
          funding: {
            ...funding,
            gasCostWei: gasCost.toString(),
          },
          nextStep: "blocked",
          permit2,
        };
      }
      return {
        ...base,
        balances,
        blockers: [
          {
            code: "INSUFFICIENT_OWNER_USDT",
            message: `RENAISS 付款錢包 USDT 不足，需要補 ${funding.amountDisplay} USDT；但 Token Core owner 錢包目前只有 ${funding.ownerBalances.usdtDisplay} USDT。`,
          },
        ],
        funding,
        nextStep: "blocked",
        permit2,
      };
    }

    return {
      ...base,
      balances,
      blockers: [
        {
          code: "INSUFFICIENT_USDT",
          message: `RENAISS 付款錢包 USDT 不足：需要 ${formatTokenAmount(amount, USDT_DECIMALS)} USDT，目前 ${formatTokenAmount(usdtBalance, USDT_DECIMALS)} USDT。付款錢包是 ${payerAddress}。`,
        },
      ],
      nextStep: "blocked",
      permit2,
    };
  }

  if (!permit2.hasSufficientAllowance) {
    const approveCall = buildPermit2ApprovalCall();
    if (safeSigner) {
      return {
        ...base,
        balances,
        blockers: [],
        nextStep: "safe_approve_permit2",
        permit2,
        safeTx: {
          calls: [approveCall],
          safeAddress: sessionWallet,
          ownerAddress: signerAddress,
        },
      };
    }

    const approveTx = await buildPermit2ApprovalTx(signerAddress);
    return {
      ...base,
      approveTx,
      balances,
      blockers: [],
      nextStep: "approve_permit2",
      permit2,
    };
  }

  const bid = buildBuyNowBid({ amount, bidder: payerAddress, tokenId });
  return {
    ...base,
    balances,
    bid,
    blockers: [],
    nextStep: "sign_bid_and_submit",
    permit2,
  };
}

export async function submitRenaissBuyNow({ bidData, bidSignature, cookieHeader, collectibleId }) {
  if (!cookieHeader) {
    throw new Error("Missing RENAISS session cookie. Login with the buying wallet first.");
  }
  const normalizedCollectibleId = normalizeCollectibleId(collectibleId);
  if (!/^0x[0-9a-fA-F]{130}$/.test(bidSignature)) {
    throw new Error("RENAISS buyNow signature must be a 65-byte EVM signature.");
  }

  const response = await fetch(`${RENAISS_PURCHASE_ORIGIN}/api/trpc/offer.buyNow?batch=1`, {
    body: JSON.stringify({
      0: {
        json: {
          bidData: normalizeBidDataForSubmit(bidData),
          bidSignature,
          collectibleId: normalizedCollectibleId,
        },
      },
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: cookieHeader,
      origin: RENAISS_PURCHASE_ORIGIN,
      referer: `${RENAISS_PURCHASE_ORIGIN}/card/${bidData?.tokenId ?? ""}`,
      "trpc-accept": "application/jsonl",
      "x-trpc-source": "nextjs-react",
    },
    method: "POST",
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(readTrpcError(payload) ?? `RENAISS buyNow failed with HTTP ${response.status}.`);
  }

  const result = Array.isArray(payload) ? payload[0]?.result?.data?.json : payload?.result?.data?.json;
  if (!result) {
    return { raw: payload };
  }
  return result;
}

function buildBuyNowBid({ amount, bidder, tokenId }) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + BUY_DEADLINE_SECONDS);
  const nonce = randomUint256();
  const typedData = buildPermitWitnessTransferFromTypedData({
    amount,
    bidder,
    deadline,
    feeBps: RENAISS_ORDERBOOK.platformFeeBps,
    nonce,
    tokenId,
  });

  return {
    bidData: {
      amount: amount.toString(),
      bidder,
      deadline: deadline.toString(),
      feeBps: RENAISS_ORDERBOOK.platformFeeBps.toString(),
      nonce: nonce.toString(),
      tokenId: tokenId.toString(),
    },
    eip712Preimage: typedData.preimage,
    eip712Digest: typedData.digest,
    typedData: typedData.typedData,
  };
}

function buildPermitWitnessTransferFromTypedData({ amount, bidder, deadline, feeBps, nonce, tokenId }) {
  const domain = {
    chainId: RENAISS_PURCHASE_CHAIN_ID,
    name: "Permit2",
    verifyingContract: RENAISS_PURCHASE_CONTRACTS.permit2,
  };
  const types = {
    Bid: [
      { name: "bidder", type: "address" },
      { name: "feeBps", type: "uint256" },
      { name: "tokenId", type: "uint256" },
    ],
    PermitWitnessTransferFrom: [
      { name: "permitted", type: "TokenPermissions" },
      { name: "spender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "witness", type: "Bid" },
    ],
    TokenPermissions: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  };
  const message = {
    deadline: deadline.toString(),
    nonce: nonce.toString(),
    permitted: {
      amount: amount.toString(),
      token: RENAISS_PURCHASE_CONTRACTS.usdt,
    },
    spender: RENAISS_PURCHASE_CONTRACTS.orderbook,
    witness: {
      bidder,
      feeBps: feeBps.toString(),
      tokenId: tokenId.toString(),
    },
  };

  const domainSeparator = hashEip712Domain(domain);
  const structHash = hashPermitWitnessTransferFrom({
    amount,
    bidder,
    deadline,
    feeBps,
    nonce,
    tokenId,
  });
  const preimage = concatHex(["0x1901", domainSeparator, structHash]);
  return {
    digest: keccakHex(preimage),
    preimage,
    typedData: {
      domain,
      message,
      primaryType: "PermitWitnessTransferFrom",
      types,
    },
  };
}

async function buildPermit2ApprovalTx(from) {
  const { data, to, value } = buildPermit2ApprovalCall();
  const [nonce, gasPrice, gasLimit] = await Promise.all([
    rpc("eth_getTransactionCount", [from, "pending"]).then(hexToBigInt),
    rpc("eth_gasPrice", []).then(hexToBigInt),
    rpc("eth_estimateGas", [
      {
        data,
        from,
        to,
        value: "0x0",
      },
    ]).then(hexToBigInt),
  ]);

  return {
    chainId: String(RENAISS_PURCHASE_CHAIN_ID),
    data,
    gasLimit: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    nonce: nonce.toString(),
    to,
    value,
  };
}

function buildPermit2ApprovalCall() {
  return {
    data: concatHex([
      SELECTORS.approve,
      encodeAddress(RENAISS_PURCHASE_CONTRACTS.permit2),
      encodeUint256(MAX_UINT256),
    ]),
    to: RENAISS_PURCHASE_CONTRACTS.usdt,
    value: "0",
  };
}

async function buildNativeTransferTx({ amount, from, to }) {
  const [nonce, gasPrice, gasLimit] = await Promise.all([
    rpc("eth_getTransactionCount", [from, "pending"]).then(hexToBigInt),
    rpc("eth_gasPrice", []).then(hexToBigInt),
    rpc("eth_estimateGas", [
      {
        data: "0x",
        from,
        to,
        value: quantityHex(amount),
      },
    ]).then(hexToBigInt),
  ]);

  return {
    chainId: String(RENAISS_PURCHASE_CHAIN_ID),
    data: "0x",
    gasLimit: addGasBuffer(gasLimit).toString(),
    gasPrice: gasPrice.toString(),
    nonce: nonce.toString(),
    to,
    value: amount.toString(),
  };
}

async function buildUsdtTransferTx({ amount, from, to }) {
  const data = concatHex([
    SELECTORS.transfer,
    encodeAddress(to),
    encodeUint256(amount),
  ]);
  const [nonce, gasPrice, gasLimit] = await Promise.all([
    rpc("eth_getTransactionCount", [from, "pending"]).then(hexToBigInt),
    rpc("eth_gasPrice", []).then(hexToBigInt),
    rpc("eth_estimateGas", [
      {
        data,
        from,
        to: RENAISS_PURCHASE_CONTRACTS.usdt,
        value: "0x0",
      },
    ]).then(hexToBigInt),
  ]);

  return {
    chainId: String(RENAISS_PURCHASE_CHAIN_ID),
    data,
    gasLimit: addGasBuffer(gasLimit).toString(),
    gasPrice: gasPrice.toString(),
    nonce: nonce.toString(),
    to: RENAISS_PURCHASE_CONTRACTS.usdt,
    value: "0",
  };
}

function addGasBuffer(value) {
  return (value * 120n) / 100n;
}

function getRenaissSafeMinBnbWei() {
  return parseTokenDisplayAmount(
    process.env.RENAISS_SAFE_MIN_BNB ?? process.env.EXPO_PUBLIC_RENAISS_SAFE_MIN_BNB ?? DEFAULT_SAFE_MIN_BNB,
    BNB_DECIMALS,
    "RENAISS_SAFE_MIN_BNB",
  );
}

async function readNativeBalance(address) {
  return hexToBigInt(await rpc("eth_getBalance", [address, "latest"]));
}

async function readErc20Balance(token, owner) {
  const data = concatHex([SELECTORS.balanceOf, encodeAddress(owner)]);
  return hexToBigInt(await rpc("eth_call", [{ data, to: token }, "latest"]));
}

async function readErc20Allowance(token, owner, spender) {
  const data = concatHex([SELECTORS.allowance, encodeAddress(owner), encodeAddress(spender)]);
  return hexToBigInt(await rpc("eth_call", [{ data, to: token }, "latest"]));
}

async function readContractCode(address) {
  return rpc("eth_getCode", [address, "latest"]);
}

async function rpc(method, params) {
  const response = await fetch(BSC_RPC_URL, {
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `BSC RPC ${method} failed.`);
  }
  if (payload.result === undefined) {
    throw new Error(`BSC RPC ${method} returned no result.`);
  }
  return payload.result;
}

function hashEip712Domain(domain) {
  return keccakHex(
    concatHex([
      keccakUtf8("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
      keccakUtf8(domain.name),
      encodeUint256(BigInt(domain.chainId)),
      encodeAddress(domain.verifyingContract),
    ]),
  );
}

function hashPermitWitnessTransferFrom({ amount, bidder, deadline, feeBps, nonce, tokenId }) {
  const permittedHash = keccakHex(
    concatHex([
      keccakUtf8("TokenPermissions(address token,uint256 amount)"),
      encodeAddress(RENAISS_PURCHASE_CONTRACTS.usdt),
      encodeUint256(amount),
    ]),
  );
  const bidHash = keccakHex(
    concatHex([
      keccakUtf8("Bid(address bidder,uint256 feeBps,uint256 tokenId)"),
      encodeAddress(bidder),
      encodeUint256(feeBps),
      encodeUint256(tokenId),
    ]),
  );
  return keccakHex(
    concatHex([
      keccakUtf8(
        "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Bid witness)Bid(address bidder,uint256 feeBps,uint256 tokenId)TokenPermissions(address token,uint256 amount)",
      ),
      permittedHash,
      encodeAddress(RENAISS_PURCHASE_CONTRACTS.orderbook),
      encodeUint256(nonce),
      encodeUint256(deadline),
      bidHash,
    ]),
  );
}

function normalizeBidDataForSubmit(value) {
  const bidder = normalizeAddress(value?.bidder, "bidData.bidder");
  return {
    amount: bigintString(value?.amount, "bidData.amount"),
    bidder,
    deadline: bigintString(value?.deadline, "bidData.deadline"),
    feeBps: bigintString(value?.feeBps, "bidData.feeBps"),
    nonce: bigintString(value?.nonce, "bidData.nonce"),
    tokenId: bigintString(value?.tokenId, "bidData.tokenId"),
  };
}

function bigintString(value, label) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${label} is required.`);
  }
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} must be a decimal integer string.`);
  }
  return text;
}

function parseUsdtDisplayAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("RENAISS ask price must be a positive number.");
  }
  return parseTokenDisplayAmount(value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""), USDT_DECIMALS, "RENAISS ask price");
}

function parseTokenDisplayAmount(value, decimals, label) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`${label} must be a positive decimal amount.`);
  }
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`${label} supports at most ${decimals} decimal places.`);
  }
  const parsed = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function formatTokenAmount(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function extractRenaissTokenId(url) {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("RENAISS card URL is missing.");
  }
  const match = url.match(/\/card\/(\d+)/);
  if (!match) {
    throw new Error("RENAISS card URL does not include a tokenId.");
  }
  return BigInt(match[1]);
}

function normalizeCollectibleId(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{32,40}$/.test(value)) {
    throw new Error("RENAISS collectible/item id is missing or invalid.");
  }
  return value;
}

function maybeNormalizeAddress(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return normalizeAddress(value, "address");
  } catch {
    return null;
  }
}

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full EVM address.`);
  }
  return value;
}

function addressesEqual(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function randomUint256() {
  return BigInt(`0x${crypto.randomBytes(32).toString("hex")}`);
}

function encodeAddress(value) {
  return `0x${normalizeAddress(value, "address").slice(2).toLowerCase().padStart(64, "0")}`;
}

function encodeUint256(value) {
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  if (bigint < 0n || bigint > MAX_UINT256) {
    throw new Error("uint256 value out of range.");
  }
  return `0x${bigint.toString(16).padStart(64, "0")}`;
}

function keccakUtf8(value) {
  return bytesToHex(keccak_256(new TextEncoder().encode(value)));
}

function keccakHex(value) {
  return bytesToHex(keccak_256(hexToBytes(value)));
}

function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function hexToBytes(value) {
  const normalized = String(value).replace(/^0x/, "");
  if (normalized.length % 2 !== 0 || /[^0-9a-fA-F]/.test(normalized)) {
    throw new Error("Invalid hex bytes.");
  }
  return Buffer.from(normalized, "hex");
}

function concatHex(parts) {
  return `0x${parts.map((part) => String(part).replace(/^0x/, "")).join("")}`;
}

function hexToBigInt(value) {
  return BigInt(value || "0x0");
}

function quantityHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readTrpcError(payload) {
  if (Array.isArray(payload)) {
    return payload.map(readTrpcError).find(Boolean) ?? null;
  }
  return payload?.error?.json?.message ?? payload?.error?.message ?? null;
}
