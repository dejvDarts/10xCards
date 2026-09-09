import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { onRequest } from "./middleware";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

const FAKE_USER = { id: "user-123", email: "a@example.test" } as unknown as User;

/** Stub the Supabase SSR client so `auth.getUser()` resolves to `user`. */
function stubSupabase(user: User | null) {
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  } as unknown as ReturnType<typeof createClient>);
}

/** Minimal APIContext shaped just enough for `onRequest`. */
function makeContext(pathname: string) {
  const url = new URL(`http://localhost${pathname}`);
  return {
    request: new Request(url),
    cookies: {} as never,
    url,
    locals: {} as App.Locals,
    redirect: vi.fn((location: string) => new Response(null, { status: 302, headers: { Location: location } })),
  };
}

function makeNext() {
  return vi.fn().mockResolvedValue(new Response("ok"));
}

const PROTECTED = ["/dashboard", "/generate", "/flashcards", "/flashcards/review"];
const PUBLIC = ["/", "/auth/signin", "/auth/signup", "/api/flashcards/anything"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware onRequest — page gating", () => {
  describe("unauthenticated", () => {
    beforeEach(() => {
      stubSupabase(null);
    });

    it.each(PROTECTED)("redirects %s to /auth/signin and does not call next", async (pathname) => {
      const context = makeContext(pathname);
      const next = makeNext();

      await onRequest(context as never, next as never);

      expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
      expect(next).not.toHaveBeenCalled();
    });

    it.each(PUBLIC)("lets %s through to next with no redirect", async (pathname) => {
      const context = makeContext(pathname);
      const next = makeNext();

      await onRequest(context as never, next as never);

      expect(next).toHaveBeenCalledOnce();
      expect(context.redirect).not.toHaveBeenCalled();
    });

    it("does not gate /api/** even though it shares the /flashcards prefix concern", async () => {
      const context = makeContext("/api/flashcards/00000000-0000-0000-0000-000000000000");
      const next = makeNext();

      await onRequest(context as never, next as never);

      expect(next).toHaveBeenCalledOnce();
      expect(context.redirect).not.toHaveBeenCalled();
    });
  });

  describe("authenticated", () => {
    beforeEach(() => {
      stubSupabase(FAKE_USER);
    });

    it.each(PROTECTED)("lets %s through to next with no redirect", async (pathname) => {
      const context = makeContext(pathname);
      const next = makeNext();

      await onRequest(context as never, next as never);

      expect(next).toHaveBeenCalledOnce();
      expect(context.redirect).not.toHaveBeenCalled();
    });
  });

  describe("locals.user population", () => {
    it("sets locals.user from getUser() when authenticated", async () => {
      stubSupabase(FAKE_USER);
      const context = makeContext("/");

      await onRequest(context as never, makeNext() as never);

      expect(context.locals.user).toEqual(FAKE_USER);
    });

    it("sets locals.user to null when there is no session", async () => {
      stubSupabase(null);
      const context = makeContext("/");

      await onRequest(context as never, makeNext() as never);

      expect(context.locals.user).toBeNull();
    });

    it("sets locals.user to null and redirects a protected route when the client cannot be built", async () => {
      mockCreateClient.mockReturnValue(null);
      const context = makeContext("/dashboard");
      const next = makeNext();

      await onRequest(context as never, next as never);

      expect(context.locals.user).toBeNull();
      expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
      expect(next).not.toHaveBeenCalled();
    });
  });
});
