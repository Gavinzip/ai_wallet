const RP_NAME = "imToken Agent Wallet";
const PRF_SALT_PREFIX = "imtoken-agent-wallet:web-token-core:v1";

type PrfCreateResults = {
  prf?: {
    enabled?: boolean;
    results?: {
      first?: ArrayBuffer;
    };
  };
};

type PrfGetResults = {
  prf?: {
    results?: {
      first?: ArrayBuffer;
    };
  };
};

type PrfCredentialCreationOptions = PublicKeyCredentialCreationOptions & {
  extensions: {
    prf: {
      eval: {
        first: ArrayBuffer;
      };
    };
  };
};

type PrfCredentialRequestOptions = PublicKeyCredentialRequestOptions & {
  extensions: {
    prf: {
      evalByCredential: Record<
        string,
        {
          first: ArrayBuffer;
        }
      >;
    };
  };
};

export type PasskeyPrfResult = {
  credentialId: string;
  prfKeyHex: string;
  rpId: string;
};

export async function createPasskeyPrfKey(input: {
  email: string;
  name: string;
  userId: string;
}): Promise<PasskeyPrfResult> {
  assertWebAuthnAvailable();
  const rpId = getRpId();
  const salt = await makePrfSalt(input.userId, rpId);
  const credential = (await navigator.credentials.create({
    publicKey: {
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      extensions: {
        prf: {
          eval: {
            first: salt,
          },
        },
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      rp: {
        id: rpId,
        name: RP_NAME,
      },
      timeout: 90_000,
      user: {
        displayName: input.name,
        id: await sha256Bytes(input.userId),
        name: input.email,
      },
    } satisfies PrfCredentialCreationOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey creation was cancelled.");
  }

  const createResults = credential.getClientExtensionResults() as PrfCreateResults;
  const first = createResults.prf?.results?.first;
  if (first) {
    return {
      credentialId: credential.id,
      prfKeyHex: arrayBufferToHex(first),
      rpId,
    };
  }

  if (createResults.prf?.enabled === false) {
    throw new Error("This browser or authenticator does not support WebAuthn PRF for wallet encryption.");
  }

  return getPasskeyPrfKey({
    credentialId: credential.id,
    rpId,
    userId: input.userId,
  });
}

export async function getPasskeyPrfKey(input: {
  credentialId: string;
  rpId: string;
  userId: string;
}): Promise<PasskeyPrfResult> {
  assertWebAuthnAvailable();
  const salt = await makePrfSalt(input.userId, input.rpId);
  const credential = (await navigator.credentials.get({
    publicKey: {
      allowCredentials: [
        {
          id: base64UrlToArrayBuffer(input.credentialId),
          type: "public-key",
        },
      ],
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      extensions: {
        prf: {
          evalByCredential: {
            [input.credentialId]: {
              first: salt,
            },
          },
        },
      },
      rpId: input.rpId,
      timeout: 90_000,
      userVerification: "required",
    } satisfies PrfCredentialRequestOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Passkey unlock was cancelled.");
  }

  const results = credential.getClientExtensionResults() as PrfGetResults;
  const first = results.prf?.results?.first;
  if (!first) {
    throw new Error("Passkey unlock did not return a WebAuthn PRF key.");
  }

  return {
    credentialId: input.credentialId,
    prfKeyHex: arrayBufferToHex(first),
    rpId: input.rpId,
  };
}

function assertWebAuthnAvailable() {
  if (
    process.env.EXPO_OS !== "web" ||
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !navigator.credentials ||
    !window.PublicKeyCredential
  ) {
    throw new Error("Passkey PRF requires a secure browser context such as HTTPS or localhost.");
  }
}

function getRpId() {
  if (typeof window === "undefined") {
    throw new Error("Cannot resolve WebAuthn relying party outside the browser.");
  }
  return window.location.hostname;
}

async function makePrfSalt(userId: string, rpId: string) {
  return sha256Bytes(`${PRF_SALT_PREFIX}:${rpId}:${userId}`);
}

async function sha256Bytes(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

function arrayBufferToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlToArrayBuffer(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
