import { createServerClient } from "@supabase/ssr";
import type { APIContext } from "astro";
import { anonKey, supabaseUrl } from "./clients";
import type { TestUser } from "./users";

/**
 * Sign in through `@supabase/ssr` bound to an in-memory cookie jar, then
 * serialize the jar into a single `Cookie:` header string — exactly what a
 * signed-in browser would send. Handling chunked `sb-<ref>-auth-token.N`
 * cookies falls out for free because every jar entry is replayed.
 */
export async function cookieHeaderFor(user: TestUser): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(supabaseUrl(), anonKey(), {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) {
    throw new Error(`cookieHeaderFor: sign-in failed for ${user.email}: ${error.message}`);
  }
  if (jar.size === 0) {
    throw new Error("cookieHeaderFor: sign-in produced no session cookies");
  }

  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Minimal AstroCookies stand-in — handlers only ever call `.set` (via @supabase/ssr). */
function cookieStub() {
  return {
    get: () => undefined,
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
    headers: () => [][Symbol.iterator](),
    merge: () => undefined,
  } as unknown as APIContext["cookies"];
}

interface ApiContextOptions {
  method: string;
  /** Path with query string, e.g. `/api/flashcards?page=2` or `/api/flashcards/<id>`. */
  path: string;
  cookieHeader?: string;
  body?: unknown;
  params?: Record<string, string>;
}

/** Build just enough of an APIContext for the flashcard route handlers, which
 *  read `request`, `cookies`, `params`, and `url` only. */
export function apiContext(opts: ApiContextOptions): APIContext {
  const url = new URL(`http://localhost${opts.path}`);
  const headers = new Headers();
  if (opts.cookieHeader) headers.set("Cookie", opts.cookieHeader);

  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(opts.body);
  }

  return {
    request: new Request(url, init),
    url,
    params: opts.params ?? {},
    cookies: cookieStub(),
    locals: {},
  } as unknown as APIContext;
}
