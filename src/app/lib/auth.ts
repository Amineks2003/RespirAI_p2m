import { apiRequest } from "./api";
import { clearSession, setSession, type AuthSession } from "./session";

interface AuthResponse {
  success: boolean;
  token: string;
  user: {
    _id: string;
    email: string;
    role: "doctor" | "patient";
  };
  profile: unknown;
}

export const login = async (input: { email: string; password: string; role: "doctor" | "patient" }) => {
  const response = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const session: AuthSession = {
    token: response.token,
    role: response.user.role,
    userId: response.user._id,
    email: response.user.email,
  };

  setSession(session);
  return response;
};

export const register = async (input: Record<string, unknown>) => {
  const response = await apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const session: AuthSession = {
    token: response.token,
    role: response.user.role,
    userId: response.user._id,
    email: response.user.email,
  };

  setSession(session);
  return response;
};

export const logout = async () => {
  try {
    await apiRequest("/auth/logout", { method: "POST", auth: true });
  } finally {
    clearSession();
  }
};
