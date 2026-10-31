export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class AuthError extends Error {
  constructor(message = "Não autenticado") {
    super(message);
    this.name = "AuthError";
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("acessor_token");
}

export function setToken(token: string): void {
  localStorage.setItem("acessor_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("acessor_token");
  localStorage.removeItem("acessor_role");
}

export async function fetchApi(path: string, options: RequestInit = {}) {
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    throw new AuthError(body.detail || "Sessão expirada ou token ausente");
  }

  return res;
}

// Papel gravado no token (developer, admin ou corretor). Em localhost os três
// portais dividem o mesmo localStorage: cada portal só aceita o próprio papel.
export function tokenRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

// Identificação gravada no token (e-mail do admin ou telefone do corretor).
export function tokenSub(): string {
  const token = getToken();
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

// Id do corretor gravado no token (`cid`); vazio para os outros papéis.
export function tokenCorretorId(): string {
  const token = getToken();
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.cid === "string" ? payload.cid : "";
  } catch {
    return "";
  }
}
