import type { BrowserContext } from "@playwright/test";
import { cookieHeaderFor } from "../../integration/helpers/session";
import type { TestUser } from "../../integration/helpers/users";

/**
 * Signs in as `user` through the same `@supabase/ssr` flow the integration
 * tests use (`cookieHeaderFor`) and injects the resulting session cookies
 * directly into the browser context -- no round trip through the
 * `/auth/signin` UI form.
 *
 * Use this for tests where authentication is a precondition, not the risk
 * under test, and each test still creates its own disposable `TestUser` via
 * `createTestUser()` -- per-test isolation is preserved, only the login UI
 * step is skipped. A test that exercises the login flow itself (e.g. the
 * auth-gating risk in `seed.spec.ts`) must keep signing in through the real
 * form -- that round trip *is* the risk it protects.
 */
export async function signInViaCookie(context: BrowserContext, user: TestUser, baseURL: string): Promise<void> {
  const cookieHeader = await cookieHeaderFor(user);
  const domain = new URL(baseURL).hostname;

  const cookies = cookieHeader.split("; ").map((pair) => {
    const separatorIndex = pair.indexOf("=");
    return {
      name: pair.slice(0, separatorIndex),
      value: pair.slice(separatorIndex + 1),
      domain,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    };
  });

  await context.addCookies(cookies);
}
