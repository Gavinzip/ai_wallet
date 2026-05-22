import Constants from "expo-constants";

export function getAgentApiBaseUrl(errorContext = "agent API") {
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
    throw new Error(`Cannot resolve Expo development server URL for ${errorContext}.`);
  }

  const host = hostUri.split(":")[0];
  return `http://${host}:8787`;
}

function isLocalDevelopmentOrigin(location: Location) {
  const host = location.hostname;
  return (host === "localhost" || host === "127.0.0.1" || host === "::1") && location.port === "8081";
}

export async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? payload.detail ?? payload.message ?? fallbackMessage);
  }
  return payload as T;
}
