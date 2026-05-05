type UserRole = "doctor" | "patient";

export interface AuthSession {
  token: string;
  role: UserRole;
  userId: string;
  email: string;
}

const SESSION_KEY = "ehealth_session";

export const getSession = (): AuthSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
};

export const setSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const getToken = () => getSession()?.token ?? "";
