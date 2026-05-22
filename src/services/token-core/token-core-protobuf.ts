type Bytes = number[];

export type TcxKeystoreResult = {
  id: string;
  name: string;
  identifier: string;
  ipfsId: string;
  source: string;
};

export type TcxAccountResponse = {
  address: string;
  chainType: string;
  curve: string;
  path: string;
  publicKey: string;
};

export type TcxScannedKeystore = TcxKeystoreResult & {
  accounts: TcxAccountResponse[];
  migrationStatus: string;
};

export type TcxEthTxInput = {
  accessList?: { address: string; storageKeys: string[] }[];
  chainId: string;
  data: string;
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: string;
  to: string;
  txType?: string;
  value: string;
};

export type TcxEthTxOutput = {
  signature: string;
  txHash: string;
};

const ANY_TYPE_URL = "imtoken";
const DEFAULT_ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const EVM_CHAIN_TYPE = "ETHEREUM";
const EVM_CURVE = "secp256k1";

export async function initTokenCoreX(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  fileDir: string,
) {
  await callTcxApi(callRawTcxApi, "init_token_core_x", encodeInitTokenCoreXParam({
    fileDir,
    isDebug: false,
    xpubCommonIv: "9C0C30889CBCC5E01AB5B2BB88715799",
    xpubCommonKey: "B888D25EC8C12BD5043777B1AC49F872",
  }));
}

export async function createTcxKeystore(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  input: { name: string; network: string; password: string; passwordHint?: string },
): Promise<TcxKeystoreResult> {
  const result = await callTcxApi(callRawTcxApi, "create_keystore", encodeCreateKeystoreParam(input));
  return decodeKeystoreResult(result);
}

export async function deleteTcxKeystore(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  input: { keystoreId: string; password: string },
) {
  await callTcxApi(callRawTcxApi, "delete_keystore", encodeWalletKeyParam(input));
}

export async function scanTcxKeystores(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
): Promise<TcxScannedKeystore[]> {
  const result = await callTcxApi(callRawTcxApi, "scan_keystores", new Uint8Array());
  return decodeScannedKeystoresResult(result);
}

export async function deriveTcxEvmAccount(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  input: { chainId: string; keystoreId: string; password: string },
): Promise<TcxAccountResponse> {
  const result = await callTcxApi(
    callRawTcxApi,
    "derive_accounts",
    encodeDeriveAccountsParam({
      derivations: [
        {
          chainId: input.chainId,
          chainType: EVM_CHAIN_TYPE,
          contractCode: "",
          curve: EVM_CURVE,
          network: "",
          path: DEFAULT_ETH_DERIVATION_PATH,
          segWit: "",
        },
      ],
      id: input.keystoreId,
      password: input.password,
    }),
  );

  const accounts = decodeDeriveAccountsResult(result);
  const account = accounts[0];
  if (!account?.address) {
    throw new Error("Token Core did not derive an EVM account.");
  }
  return account;
}

export async function signTcxEthereumMessage(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  input: { keystoreId: string; messageHex: string; password: string },
) {
  const result = await callTcxApi(
    callRawTcxApi,
    "sign_msg",
    encodeSignParam({
      chainType: EVM_CHAIN_TYPE,
      curve: EVM_CURVE,
      id: input.keystoreId,
      input: encodeAny(encodeEthMessageInput({ message: input.messageHex, signatureType: 0 })),
      network: "",
      password: input.password,
      path: DEFAULT_ETH_DERIVATION_PATH,
      segWit: "",
    }),
  );

  return decodeEthMessageOutput(result).signature;
}

export async function signTcxEthereumTransaction(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  input: { chainId: string; keystoreId: string; password: string; tx: TcxEthTxInput },
): Promise<TcxEthTxOutput> {
  const result = await callTcxApi(
    callRawTcxApi,
    "sign_tx",
    encodeSignParam({
      chainType: EVM_CHAIN_TYPE,
      curve: EVM_CURVE,
      id: input.keystoreId,
      input: encodeAny(encodeEthTxInput({ ...input.tx, chainId: input.chainId })),
      network: "",
      password: input.password,
      path: DEFAULT_ETH_DERIVATION_PATH,
      segWit: "",
    }),
  );

  return decodeEthTxOutput(result);
}

export function utf8ToHex(value: string) {
  return toHex(utf8Bytes(value));
}

export function decodeTokenCoreError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Token Core call failed.";
  }

  const match = error.message.match(/[0-9a-fA-F]{8,}/);
  if (!match) return error.message;

  try {
    const decoded = decodeGeneralResult(fromHex(match[0]));
    return decoded.error || error.message;
  } catch {
    return error.message;
  }
}

async function callTcxApi(
  callRawTcxApi: (hexPayload: string) => Promise<string>,
  method: string,
  paramPayload: Uint8Array,
) {
  try {
    const action = encodeTcxAction(method, encodeAny(paramPayload));
    return fromHex(await callRawTcxApi(toHex(action)));
  } catch (error) {
    throw new Error(`${method}: ${decodeTokenCoreError(error)}`);
  }
}

function encodeTcxAction(method: string, param: Uint8Array) {
  const writer = new ProtoWriter();
  writer.string(1, method);
  writer.bytes(2, param);
  return writer.finish();
}

function encodeAny(value: Uint8Array) {
  const writer = new ProtoWriter();
  writer.string(1, ANY_TYPE_URL);
  writer.bytes(2, value);
  return writer.finish();
}

function encodeInitTokenCoreXParam(input: {
  fileDir: string;
  isDebug: boolean;
  xpubCommonIv: string;
  xpubCommonKey: string;
}) {
  const writer = new ProtoWriter();
  writer.string(1, input.fileDir);
  writer.string(2, input.xpubCommonKey);
  writer.string(3, input.xpubCommonIv);
  writer.bool(4, input.isDebug);
  return writer.finish();
}

function encodeCreateKeystoreParam(input: {
  name: string;
  network: string;
  password: string;
  passwordHint?: string;
}) {
  const writer = new ProtoWriter();
  writer.string(1, input.password);
  writer.string(2, input.passwordHint ?? "");
  writer.string(3, input.name);
  writer.string(4, input.network);
  return writer.finish();
}

function encodeWalletKeyParam(input: { keystoreId: string; password: string }) {
  const writer = new ProtoWriter();
  writer.string(1, input.keystoreId);
  writer.string(2, input.password);
  return writer.finish();
}

function encodeDeriveAccountsParam(input: {
  derivations: {
    chainId: string;
    chainType: string;
    contractCode: string;
    curve: string;
    network: string;
    path: string;
    segWit: string;
  }[];
  id: string;
  password: string;
}) {
  const writer = new ProtoWriter();
  writer.string(1, input.id);
  writer.string(2, input.password);
  for (const derivation of input.derivations) {
    const nested = new ProtoWriter();
    nested.string(1, derivation.chainType);
    nested.string(2, derivation.path);
    nested.string(3, derivation.network);
    nested.string(4, derivation.segWit);
    nested.string(5, derivation.chainId);
    nested.string(6, derivation.curve);
    nested.string(7, derivation.contractCode);
    writer.bytes(4, nested.finish());
  }
  return writer.finish();
}

function encodeSignParam(input: {
  chainType: string;
  curve: string;
  id: string;
  input: Uint8Array;
  network: string;
  password: string;
  path: string;
  segWit: string;
}) {
  const writer = new ProtoWriter();
  writer.string(1, input.id);
  writer.string(2, input.password);
  writer.string(4, input.chainType);
  writer.string(5, input.path);
  writer.string(6, input.curve);
  writer.string(7, input.network);
  writer.string(8, input.segWit);
  writer.bytes(9, input.input);
  return writer.finish();
}

function encodeEthMessageInput(input: { message: string; signatureType: 0 | 1 }) {
  const writer = new ProtoWriter();
  writer.string(1, input.message);
  writer.uint32(2, input.signatureType);
  return writer.finish();
}

function encodeEthTxInput(input: TcxEthTxInput) {
  const writer = new ProtoWriter();
  writer.string(1, input.nonce);
  writer.string(2, input.gasPrice);
  writer.string(3, input.gasLimit);
  writer.string(4, input.to);
  writer.string(5, input.value);
  writer.string(6, input.data);
  writer.string(7, input.chainId);
  writer.string(8, input.txType ?? "");
  writer.string(9, input.maxFeePerGas ?? "");
  writer.string(10, input.maxPriorityFeePerGas ?? "");
  for (const item of input.accessList ?? []) {
    const nested = new ProtoWriter();
    nested.string(1, item.address);
    for (const storageKey of item.storageKeys) {
      nested.string(2, storageKey);
    }
    writer.bytes(11, nested.finish());
  }
  return writer.finish();
}

function decodeKeystoreResult(bytes: Uint8Array): TcxKeystoreResult {
  const reader = new ProtoReader(bytes);
  const result: TcxKeystoreResult = { id: "", identifier: "", ipfsId: "", name: "", source: "" };
  reader.read((field, wire) => {
    if (wire !== 2) return reader.skip(wire);
    if (field === 1) result.id = reader.string();
    else if (field === 2) result.name = reader.string();
    else if (field === 3) result.identifier = reader.string();
    else if (field === 4) result.ipfsId = reader.string();
    else if (field === 5) result.source = reader.string();
    else reader.skip(wire);
  });
  return result;
}

function decodeDeriveAccountsResult(bytes: Uint8Array) {
  const accounts: TcxAccountResponse[] = [];
  const reader = new ProtoReader(bytes);
  reader.read((field, wire) => {
    if (field !== 1 || wire !== 2) return reader.skip(wire);
    accounts.push(decodeAccountResponse(reader.bytes()));
  });
  return accounts;
}

function decodeScannedKeystoresResult(bytes: Uint8Array): TcxScannedKeystore[] {
  const keystores: TcxScannedKeystore[] = [];
  const reader = new ProtoReader(bytes);
  reader.read((field, wire) => {
    if (field !== 1 || wire !== 2) return reader.skip(wire);
    keystores.push(decodeScannedKeystore(reader.bytes()));
  });
  return keystores;
}

function decodeScannedKeystore(bytes: Uint8Array): TcxScannedKeystore {
  const reader = new ProtoReader(bytes);
  const result: TcxScannedKeystore = {
    accounts: [],
    id: "",
    identifier: "",
    ipfsId: "",
    migrationStatus: "",
    name: "",
    source: "",
  };
  reader.read((field, wire) => {
    if (wire === 2) {
      if (field === 1) result.id = reader.string();
      else if (field === 2) result.name = reader.string();
      else if (field === 3) result.identifier = reader.string();
      else if (field === 4) result.ipfsId = reader.string();
      else if (field === 5) result.source = reader.string();
      else if (field === 7) result.accounts.push(decodeAccountResponse(reader.bytes()));
      else if (field === 8) result.migrationStatus = reader.string();
      else reader.skip(wire);
    } else {
      reader.skip(wire);
    }
  });
  return result;
}

function decodeAccountResponse(bytes: Uint8Array): TcxAccountResponse {
  const reader = new ProtoReader(bytes);
  const result: TcxAccountResponse = {
    address: "",
    chainType: "",
    curve: "",
    path: "",
    publicKey: "",
  };
  reader.read((field, wire) => {
    if (wire !== 2) return reader.skip(wire);
    if (field === 1) result.chainType = reader.string();
    else if (field === 2) result.address = reader.string();
    else if (field === 3) result.path = reader.string();
    else if (field === 4) result.curve = reader.string();
    else if (field === 5) result.publicKey = reader.string();
    else reader.skip(wire);
  });
  return result;
}

function decodeEthMessageOutput(bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const result = { signature: "" };
  reader.read((field, wire) => {
    if (field === 1 && wire === 2) result.signature = reader.string();
    else reader.skip(wire);
  });
  return result;
}

function decodeEthTxOutput(bytes: Uint8Array): TcxEthTxOutput {
  const reader = new ProtoReader(bytes);
  const result: TcxEthTxOutput = { signature: "", txHash: "" };
  reader.read((field, wire) => {
    if (wire !== 2) return reader.skip(wire);
    if (field === 1) result.signature = reader.string();
    else if (field === 2) result.txHash = reader.string();
    else reader.skip(wire);
  });
  return result;
}

function decodeGeneralResult(bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const result = { error: "", isSuccess: false };
  reader.read((field, wire) => {
    if (field === 1 && wire === 0) result.isSuccess = reader.uint32() === 1;
    else if (field === 2 && wire === 2) result.error = reader.string();
    else reader.skip(wire);
  });
  return result;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex payload length.");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }

  const encoded: Bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) encoded.push(code);
    else if (code < 0x800) {
      encoded.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      encoded.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(encoded);
}

function utf8String(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }

  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    output += String.fromCharCode(bytes[index]);
  }
  return decodeURIComponent(escape(output));
}

class ProtoWriter {
  private readonly buffer: Bytes = [];

  bool(field: number, value: boolean) {
    if (!value) return;
    this.tag(field, 0);
    this.varint(value ? 1 : 0);
  }

  bytes(field: number, value: Uint8Array) {
    if (value.length === 0) return;
    this.tag(field, 2);
    this.varint(value.length);
    this.buffer.push(...value);
  }

  finish() {
    return new Uint8Array(this.buffer);
  }

  string(field: number, value: string) {
    if (!value) return;
    this.bytes(field, utf8Bytes(value));
  }

  uint32(field: number, value: number) {
    if (value === 0) return;
    this.tag(field, 0);
    this.varint(value);
  }

  private tag(field: number, wireType: number) {
    this.varint((field << 3) | wireType);
  }

  private varint(value: number) {
    let current = value >>> 0;
    while (current > 127) {
      this.buffer.push((current & 0x7f) | 0x80);
      current >>>= 7;
    }
    this.buffer.push(current);
  }
}

class ProtoReader {
  private position = 0;

  constructor(private readonly source: Uint8Array) {}

  bytes() {
    const length = this.uint32();
    const start = this.position;
    this.position += length;
    return this.source.slice(start, start + length);
  }

  read(handler: (field: number, wireType: number) => void) {
    while (this.position < this.source.length) {
      const tag = this.uint32();
      handler(tag >>> 3, tag & 7);
    }
  }

  skip(wireType: number) {
    if (wireType === 0) {
      this.uint32();
      return;
    }
    if (wireType === 2) {
      const length = this.uint32();
      this.position += length;
      return;
    }
    throw new Error(`Unsupported protobuf wire type ${wireType}.`);
  }

  string() {
    return utf8String(this.bytes());
  }

  uint32() {
    let result = 0;
    let shift = 0;
    while (this.position < this.source.length) {
      const byte = this.source[this.position++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new Error("Invalid protobuf varint.");
  }
}
