import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware hoitaa vain Auth0:n istunnon (kun AUTH_MODE=auth0). Sivujen
 * suojaus tehdään sivukohtaisesti requireStaff/requirePortal-funktioilla,
 * koska osa reiteistä on tarkoituksella julkisia (tehtävälinkki,
 * huoltopyyntölomake, todistustilaus).
 */
export async function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE !== "auth0") return NextResponse.next();

  const { auth0 } = await import("@/lib/auth/auth0");
  const authResponse = await auth0.middleware(request);
  if (request.nextUrl.pathname.startsWith("/auth/")) return authResponse;

  const response = NextResponse.next();
  for (const cookie of authResponse.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.svg|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)"],
};
