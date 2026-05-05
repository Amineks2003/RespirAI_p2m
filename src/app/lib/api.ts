import { clearSession, getToken } from "./session";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredApiBaseUrl && configuredApiBaseUrl.length > 0
  ? configuredApiBaseUrl
  : "http://localhost:4000/api").replace(/\/$/, "");

type JsonLikeBody = Record<string, unknown> | Array<unknown>;

interface RequestOptions extends Omit<RequestInit, "headers" | "body"> {
  auth?: boolean;
  headers?: Record<string, string>;
  body?: BodyInit | JsonLikeBody | null;
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 500, details: unknown = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { auth = false, headers = {}, body, ...rest } = options;
  const requestBody = body;
  const shouldSerializeJsonBody = Boolean(
    requestBody &&
    typeof requestBody === "object" &&
    !(requestBody instanceof FormData) &&
    !(requestBody instanceof URLSearchParams) &&
    !(requestBody instanceof Blob) &&
    !(requestBody instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(requestBody),
  );
  const normalizedBody: BodyInit | null | undefined = shouldSerializeJsonBody
    ? JSON.stringify(requestBody)
    : (requestBody as BodyInit | null | undefined);
  const shouldSetJsonHeader = normalizedBody !== undefined && !(requestBody instanceof FormData);

  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    body: normalizedBody,
    headers: {
      ...(shouldSetJsonHeader && !headers["Content-Type"] ? { "Content-Type": "application/json" } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }

    throw new ApiError(payload?.message || "Request failed", response.status, payload?.details ?? null);
  }

  return payload as T;
};
