import crypto from "node:crypto";

import { keccak_256 } from "@noble/hashes/sha3";

import {
  RENAISS_ORDERBOOK,
  RENAISS_PURCHASE_CHAIN_ID,
  RENAISS_PURCHASE_CONTRACTS,
  RENAISS_PURCHASE_ORIGIN,
} from "./renaiss-purchase.mjs";

const USDT_DECIMALS = 18;
const ASK_DEADLINE_SECONDS = 30 * 24 * 60 * 60;
const MAX_UINT256 = (1n << 256n) - 1n;

export async function buildRenaissListingPlan({ listing, session, walletAddress }) {
  const signerAddress = normalizeAddress(walletAddress, "walletAddress");
  const tokenId = normalizeTokenId(listing.tokenId ?? extractRenaissCardTokenId(listing.cardUrl));
  const sellerReceiveAmount = parseUsdtDisplayAmount(listing.askPriceUsdt);
  const totalAskAmount = applyPlatformFee(sellerReceiveAmount, RENAISS_ORDERBOOK.platformFeeBps);
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
  const sellerAddress = directSigner || safeSigner ? sessionWallet : signerAddress;
  const signatureMode = safeSigner ? "safe_eip1271" : "owner_eoa";

  const base = {
    askPrice: {
      platformFeeBps: RENAISS_ORDERBOOK.platformFeeBps.toString(),
      sellerReceives: sellerReceiveAmount.toString(),
      sellerReceivesDisplay: formatTokenAmount(sellerReceiveAmount, USDT_DECIMALS),
      totalAsk: totalAskAmount.toString(),
      totalAskDisplay: formatTokenAmount(totalAskAmount, USDT_DECIMALS),
    },
    cardUrl: listing.cardUrl ?? `${RENAISS_PURCHASE_ORIGIN}/card/${tokenId}`,
    contracts: RENAISS_PURCHASE_CONTRACTS,
    directSigner,
    orderbook: {
      domainName: RENAISS_ORDERBOOK.domainName,
      domainVersion: RENAISS_ORDERBOOK.domainVersion,
      platformFeeBps: RENAISS_ORDERBOOK.platformFeeBps.toString(),
    },
    safe: safeSigner
      ? {
          address: sessionWallet,
          ownerAddress: signerAddress,
        }
      : null,
    sellerAddress,
    session: {
      authenticated: sessionAuthenticated,
      ownerWalletAddress: sessionOwner,
      walletAddress: sessionWallet,
    },
    signatureMode,
    signerAddress,
    tokenId,
  };

  if (!sessionAuthenticated) {
    return {
      ...base,
      blockers: [
        {
          code: "RENAISS_SESSION_REQUIRED",
          message: "需要先用這個 Token Core 錢包簽 RENAISS SIWE 登入，才能建立 RENAISS 掛單。",
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
            "這個 RENAISS session 的 ownerWalletAddress 不是目前 Token Core signer，不能確認你控制要掛單的 RENAISS app wallet。",
        },
      ],
      nextStep: "blocked",
    };
  }

  const collectible = await fetchRenaissCollectibleByTokenId(tokenId, session?.cookieHeader);
  const ownerAddress = maybeNormalizeAddress(collectible.ownerAddress);
  const collectibleId = normalizeCollectibleId(collectible.id);
  if (!ownerAddress || !addressesEqual(ownerAddress, sellerAddress)) {
    return {
      ...base,
      blockers: [
        {
          code: "RENAISS_CARD_NOT_OWNED_BY_SESSION_WALLET",
          message: [
            `RENAISS 顯示這張卡目前 owner 是 ${ownerAddress ?? "未知地址"}。`,
            `目前 session 掛單錢包是 ${sellerAddress}。`,
            "兩者不一致，所以不能替你掛單。",
          ].join(" "),
        },
      ],
      collectible: sanitizeCollectible(collectible),
      collectibleId,
      nextStep: "blocked",
      ownerAddress,
    };
  }

  const ask = buildAskOrder({
    amount: totalAskAmount,
    owner: sellerAddress,
    tokenId,
  });

  return {
    ...base,
    ask,
    blockers: [],
    collectible: sanitizeCollectible(collectible),
    collectibleId,
    nextStep: "sign_ask_and_submit",
    ownerAddress,
  };
}

export async function submitRenaissSellOffer({ askData, askSignature, collectibleId, cookieHeader }) {
  if (!cookieHeader) {
    throw new Error("Missing RENAISS session cookie. Login with the listing wallet first.");
  }
  const normalizedCollectibleId = normalizeCollectibleId(collectibleId);
  if (!isHexSignatureLike(askSignature)) {
    throw new Error("RENAISS askSignature must be a hex EVM or EIP-1271 signature.");
  }

  const response = await fetch(`${RENAISS_PURCHASE_ORIGIN}/api/trpc/offer.createSellOffer?batch=1`, {
    body: JSON.stringify({
      0: {
        json: {
          askData: normalizeAskDataForSubmit(askData),
          askSignature,
          collectibleId: normalizedCollectibleId,
        },
        meta: {
          values: {
            "askData.deadline": ["bigint"],
            "askData.tokenId": ["bigint"],
            "askData.usdcAmount": ["bigint"],
          },
        },
      },
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: cookieHeader,
      origin: RENAISS_PURCHASE_ORIGIN,
      referer: `${RENAISS_PURCHASE_ORIGIN}/card/${askData?.tokenId ?? ""}`,
      "trpc-accept": "application/jsonl",
      "x-trpc-source": "nextjs-react",
    },
    method: "POST",
  });

  const text = await response.text();
  const error = readTrpcErrorText(text);
  if (!response.ok || error) {
    throw new Error(error ?? `RENAISS createSellOffer failed with HTTP ${response.status}.`);
  }
  return extractTrpcDataFromText(text) ?? { raw: text };
}

function buildAskOrder({ amount, owner, tokenId }) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ASK_DEADLINE_SECONDS);
  const salt = `0x${crypto.randomBytes(4).toString("hex")}`;
  const typedData = buildAskTypedData({
    amount,
    deadline,
    owner,
    salt,
    tokenId,
  });

  return {
    askData: {
      deadline: deadline.toString(),
      owner,
      salt,
      tokenId: tokenId.toString(),
      usdcAmount: amount.toString(),
    },
    eip712Digest: typedData.digest,
    eip712Preimage: typedData.preimage,
    typedData: typedData.typedData,
  };
}

function buildAskTypedData({ amount, deadline, owner, salt, tokenId }) {
  const domain = {
    chainId: RENAISS_PURCHASE_CHAIN_ID,
    name: RENAISS_ORDERBOOK.domainName,
    verifyingContract: RENAISS_PURCHASE_CONTRACTS.orderbook,
    version: RENAISS_ORDERBOOK.domainVersion,
  };
  const types = {
    Ask: [
      { name: "salt", type: "bytes4" },
      { name: "deadline", type: "uint256" },
      { name: "usdcAmount", type: "uint256" },
      { name: "owner", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  };
  const message = {
    deadline: deadline.toString(),
    owner,
    salt,
    tokenId: tokenId.toString(),
    usdcAmount: amount.toString(),
  };
  const domainSeparator = hashOrderbookDomain(domain);
  const structHash = hashAsk({
    amount,
    deadline,
    owner,
    salt,
    tokenId,
  });
  const preimage = concatHex(["0x1901", domainSeparator, structHash]);
  return {
    digest: keccakHex(preimage),
    preimage,
    typedData: {
      domain,
      message,
      primaryType: "Ask",
      types,
    },
  };
}

async function fetchRenaissCollectibleByTokenId(tokenId, cookieHeader) {
  const input = {
    0: {
      json: {
        tokenId: tokenId.toString(),
      },
      meta: {
        values: {
          tokenId: ["bigint"],
        },
      },
    },
  };
  const response = await fetch(
    `${RENAISS_PURCHASE_ORIGIN}/api/trpc/collectible.getCollectibleByTokenId?batch=1&input=${encodeURIComponent(
      JSON.stringify(input),
    )}`,
    {
      headers: {
        accept: "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        referer: `${RENAISS_PURCHASE_ORIGIN}/card/${tokenId}`,
        "trpc-accept": "application/jsonl",
        "x-trpc-source": "nextjs-react",
      },
      method: "GET",
    },
  );
  const text = await response.text();
  const error = readTrpcErrorText(text);
  if (!response.ok || error) {
    throw new Error(error ?? `RENAISS collectible lookup failed with HTTP ${response.status}.`);
  }
  const collectible = extractTrpcDataFromText(text);
  if (!collectible || typeof collectible !== "object") {
    throw new Error("RENAISS collectible lookup returned no collectible data.");
  }
  return collectible;
}

function sanitizeCollectible(value) {
  return {
    askPriceInUSDT: nullableString(value?.askPriceInUSDT),
    frontImageUrl: nullableString(value?.frontImageUrl),
    id: nullableString(value?.id),
    itemId: nullableString(value?.itemId),
    name: nullableString(value?.name),
    ownerAddress: nullableString(value?.ownerAddress),
    tokenId: nullableString(value?.tokenId),
  };
}

function normalizeAskDataForSubmit(value) {
  return {
    deadline: bigintString(value?.deadline, "askData.deadline"),
    owner: normalizeAddress(value?.owner, "askData.owner"),
    salt: normalizeBytes4(value?.salt, "askData.salt"),
    tokenId: bigintString(value?.tokenId, "askData.tokenId"),
    usdcAmount: bigintString(value?.usdcAmount, "askData.usdcAmount"),
  };
}

function applyPlatformFee(amount, platformFeeBps) {
  const divisor = 10_000n;
  return (amount * (divisor + platformFeeBps) + divisor - 1n) / divisor;
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

function extractRenaissCardTokenId(url) {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("RENAISS card URL or tokenId is required.");
  }
  const match = url.match(/\/card\/(\d+)/);
  if (!match) {
    throw new Error("RENAISS card URL does not include a tokenId.");
  }
  return match[1];
}

function normalizeTokenId(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("RENAISS tokenId must be a decimal integer.");
  }
  return BigInt(text);
}

function normalizeCollectibleId(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{32,40}$/.test(value)) {
    throw new Error("RENAISS collectible id is missing or invalid.");
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

function normalizeBytes4(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new Error(`${label} must be bytes4 hex.`);
  }
  return value;
}

function isHexSignatureLike(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) && value.length >= 132 && value.length % 2 === 0;
}

function hashOrderbookDomain(domain) {
  return keccakHex(
    concatHex([
      keccakUtf8("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      keccakUtf8(domain.name),
      keccakUtf8(domain.version),
      encodeUint256(BigInt(domain.chainId)),
      encodeAddress(domain.verifyingContract),
    ]),
  );
}

function hashAsk({ amount, deadline, owner, salt, tokenId }) {
  return keccakHex(
    concatHex([
      keccakUtf8("Ask(bytes4 salt,uint256 deadline,uint256 usdcAmount,address owner,uint256 tokenId)"),
      encodeBytes4(salt),
      encodeUint256(deadline),
      encodeUint256(amount),
      encodeAddress(owner),
      encodeUint256(tokenId),
    ]),
  );
}

function encodeBytes4(value) {
  const normalized = normalizeBytes4(value, "bytes4").slice(2).toLowerCase();
  return `0x${normalized.padEnd(64, "0")}`;
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

function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTrpcDataFromText(text) {
  const payloads = parseJsonLines(text);
  for (const payload of payloads.slice().reverse()) {
    const direct = payload?.result?.data?.json ?? payload?.result?.data ?? null;
    if (direct && typeof direct === "object") return direct;
    const packet = Array.isArray(payload?.json) ? payload.json : null;
    const candidate = packet?.[2]?.[0]?.[0];
    if (candidate?.error) continue;
    if (candidate && typeof candidate === "object") return candidate;
  }
  return null;
}

function readTrpcErrorText(text) {
  for (const payload of parseJsonLines(text)) {
    const direct = payload?.error?.json?.message ?? payload?.error?.message;
    if (direct) return direct;
    const packet = Array.isArray(payload?.json) ? payload.json : null;
    const error = packet?.[2]?.[0]?.[0]?.error;
    if (error?.message) return error.message;
  }
  return null;
}

function parseJsonLines(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      if (lines.length === 1) {
        try {
          return [JSON.parse(trimmed)];
        } catch {
          return [];
        }
      }
    }
  }
  return parsed;
}
