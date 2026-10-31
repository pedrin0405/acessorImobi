import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // Evita reescrever recursos estáticos e chamadas de API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Verifica subdomínio (acesso por IP, como 127.0.0.1, não tem subdomínio)
  const hostname = host.split(":")[0];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) {
    return NextResponse.next();
  }
  // Endereços da página de divulgação: o domínio raiz, o www e os que forem listados em LANDING_HOSTS
  // (separados por vírgula; útil para endereços de teste do EasyPanel). Eles servem todas as rotas sem reescrita:
  // "/" é a divulgação, "/login" o acesso e "/tenant", "/corretor" e "/admin" os portais.
  const base = (process.env.BASE_DOMAIN || "").toLowerCase();
  const paginasPublicas = [base, base && `www.${base}`, ...(process.env.LANDING_HOSTS || "").toLowerCase().split(",")]
    .map((h) => h.trim())
    .filter(Boolean);
  if (paginasPublicas.includes(hostname.toLowerCase())) {
    return NextResponse.next();
  }

  const parts = hostname.split(".");

  if (parts[0] === "admin") {
    if (!pathname.startsWith("/admin")) {
      url.pathname = `/admin${pathname}`;
      return NextResponse.rewrite(url);
    }
  } else if (parts[0] === "corretor") {
    if (!pathname.startsWith("/corretor")) {
      url.pathname = `/corretor${pathname}`;
      return NextResponse.rewrite(url);
    }
  } else if (parts.length > 2 && parts[0] !== "www") {
    // É um tenant: {tenant}.acessorimobi.com.br
    if (!pathname.startsWith("/tenant")) {
      url.pathname = `/tenant${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
