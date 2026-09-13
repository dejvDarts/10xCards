import { parseCookieHeader } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";
import { cookieHeaderFor } from "../../integration/helpers/session";
import type { TestUser } from "../../integration/helpers/users";

/**
 * Signs in as `user` through the same `@supabase/ssr` flow the integration
 * tests use (`cookieHeaderFor`) and injects the resulting session cookies
 * directly into the browser context -- no round trip through the
 * `/auth/signin` UI form.
 *
 * Cookie attributes (`httpOnly: false`, `sameSite: "Lax"`) mirror
 * `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS`, which `src/lib/supabase.ts`
 * uses unmodified -- so an injected cookie matches what a real sign-in
 * actually sets.
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
  const secure = new URL(baseURL).protocol === "https:";

  const cookies = parseCookieHeader(cookieHeader).map(({ name, value }) => ({
    name,
    value: value ?? "",
    url: baseURL,
    httpOnly: false,
    secure,
    sameSite: "Lax" as const,
  }));

  await context.addCookies(cookies);
}
