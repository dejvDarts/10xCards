import { expect, vi } from "vitest";

/**
 * Shared OpenRouter-edge mock for the generate route's integration tests.
 *
 * The generate handler makes TWO kinds of outbound calls: Supabase auth
 * (`getUser`) and the OpenRouter provider. These helpers mock ONLY the network
 * edge that matters — `openrouter.ai` — and let everything else hit the real
 * local Supabase. Mocking `astro:env/server` is avoided on purpose (it would
 * null `SUPABASE_*` and break the real DB insert).
 */

const OPENROUTER = "openrouter.ai";

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

/** Intercept openrouter.ai with `handler`; pass every other request through. */
export function mockProvider(handler: () => Promise<Response> | Response): ReturnType<typeof vi.spyOn> {
  // Capture the real fetch now, after asserting it hasn't already been spied by
  // another integration file that forgot to restore — otherwise the pass-through
  // below would silently route Supabase auth into a stale mock.
  expect(vi.isMockFunction(globalThis.fetch), "globalThis.fetch already mocked before this suite").toBe(false);
  const realFetch = globalThis.fetch.bind(globalThis);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (urlOf(input).includes(OPENROUTER)) return Promise.resolve(handler());
    return realFetch(input, init);
  });
  return fetchSpy;
}

/** Whether the provider (openrouter.ai) was hit since the last `mockProvider`. */
export function providerCalled(): boolean {
  return fetchSpy?.mock.calls.some(([input]) => urlOf(input as RequestInfo | URL).includes(OPENROUTER)) ?? false;
}
