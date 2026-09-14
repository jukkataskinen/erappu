import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/current-user";
import { authMode, DEV_SESSION_COOKIE } from "@/lib/auth/session";

export async function GET(request: Request) {
  if (authMode() === "auth0") return NextResponse.redirect(new URL("/auth/logout", request.url));
  const res = NextResponse.redirect(new URL("/kirjaudu", request.url));
  res.cookies.delete(DEV_SESSION_COOKIE);
  res.cookies.delete(ACTIVE_ORG_COOKIE);
  return res;
}
