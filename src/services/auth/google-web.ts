import Constants from "expo-constants";

export type GoogleWebUser = {
  email: string;
  name: string;
  picture: string | null;
  sub: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (input?: { prompt?: string }) => void;
};

type GoogleAccounts = {
  oauth2: {
    initTokenClient: (input: {
      callback: (response: GoogleTokenResponse) => void;
      client_id: string;
      scope: string;
    }) => GoogleTokenClient;
  };
};

declare global {
  interface Window {
    google?: {
      accounts?: GoogleAccounts;
    };
  }
}

const GOOGLE_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GOOGLE_SCRIPT_ID = "google-identity-services";
const GOOGLE_USER_STORAGE_KEY = "imtoken.web.googleUser.v1";

let googleScriptPromise: Promise<void> | null = null;
let runtimeGoogleClientIdPromise: Promise<string> | null = null;

export function getGoogleClientId() {
  return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";
}

export function loadStoredGoogleUser(): GoogleWebUser | null {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(GOOGLE_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleWebUser;
  } catch {
    return null;
  }
}

export function clearStoredGoogleUser() {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return;
  window.localStorage.removeItem(GOOGLE_USER_STORAGE_KEY);
}

export async function signInWithGoogleWeb(): Promise<GoogleWebUser> {
  const token = await requestGoogleAccessTokenWeb({ prompt: "consent" });
  const user = await fetchGoogleUser(token);
  storeGoogleUser(user);
  return user;
}

export async function getGoogleAccessTokenForServer(): Promise<{
  accessToken: string;
  user: GoogleWebUser;
}> {
  const accessToken = await requestGoogleAccessTokenWeb({ prompt: "" });
  const user = await fetchGoogleUser(accessToken);
  storeGoogleUser(user);
  return { accessToken, user };
}

export async function requestGoogleAccessTokenWeb(input: { prompt?: string } = {}): Promise<string> {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") {
    throw new Error("Google web sign-in only runs in the browser.");
  }

  const clientId = await resolveGoogleClientId();
  if (!clientId) {
    throw new Error("Set EXPO_PUBLIC_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID on the agent server before using Google wallet login.");
  }

  await loadGoogleIdentityScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google Identity Services did not load.");
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(formatGoogleOAuthError(response)));
          return;
        }
        resolve(response.access_token);
      },
      client_id: clientId,
      scope: "openid email profile",
    });
    client.requestAccessToken({ prompt: input.prompt ?? "consent" });
  });
}

async function resolveGoogleClientId() {
  const bundledClientId = getGoogleClientId();
  if (bundledClientId) return bundledClientId;

  if (!runtimeGoogleClientIdPromise) {
    runtimeGoogleClientIdPromise = fetchRuntimeGoogleClientId().catch(() => "");
  }
  return runtimeGoogleClientIdPromise;
}

async function fetchRuntimeGoogleClientId() {
  const response = await fetch(`${getAgentApiBaseUrl()}/api/config`);
  if (!response.ok) return "";
  const payload = (await response.json()) as { googleClientId?: string };
  return typeof payload.googleClientId === "string" ? payload.googleClientId : "";
}

export function getAgentApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_AGENT_API_URL) {
    return process.env.EXPO_PUBLIC_AGENT_API_URL;
  }

  if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
    if (!isLocalDevelopmentOrigin(window.location)) {
      return window.location.origin;
    }
    return "http://localhost:8787";
  }

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoClient?.hostUri;
  if (!hostUri) {
    throw new Error("Cannot resolve Expo development server URL for Google runtime config.");
  }

  const host = hostUri.split(":")[0];
  return `http://${host}:8787`;
}

function isLocalDevelopmentOrigin(location: Location) {
  const host = location.hostname;
  return (host === "localhost" || host === "127.0.0.1" || host === "::1") && location.port === "8081";
}

function storeGoogleUser(user: GoogleWebUser) {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return;
  window.localStorage.setItem(GOOGLE_USER_STORAGE_KEY, JSON.stringify(user));
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleWebUser> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Google userinfo failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as {
    email?: string;
    name?: string;
    picture?: string;
    sub?: string;
  };
  if (!payload.sub || !payload.email) {
    throw new Error("Google profile is missing a stable subject or email.");
  }
  return {
    email: payload.email,
    name: payload.name ?? payload.email,
    picture: payload.picture ?? null,
    sub: payload.sub,
  };
}

function loadGoogleIdentityScript() {
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }

    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google script failed to load.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script failed to load."));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

function formatGoogleOAuthError(response: GoogleTokenResponse) {
  const raw = [response.error, response.error_description].filter(Boolean).join(": ");
  const normalized = raw.toLowerCase();
  const origin = typeof window === "undefined" ? "this web origin" : window.location.origin;

  if (
    normalized.includes("invalid_client")
    || normalized.includes("origin")
    || normalized.includes("registered")
    || normalized.includes("not allowed")
  ) {
    return [
      `Google OAuth blocked ${origin}.`,
      "Add this exact origin to the Web application OAuth client in Google Cloud > Authorized JavaScript origins.",
      "Use only the origin, not a route path. Example: http://localhost:8081 or https://your-domain.com.",
      raw ? `Google error: ${raw}` : "Google error: invalid_client",
    ].join(" ");
  }

  return raw || "Google sign-in did not return an access token.";
}
