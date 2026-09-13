import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { applyLocalEnv, readLocalStatus } from "../integration/helpers/local-env";
import { createTestUser, deleteTestUser, signedInClient, type TestUser } from "../integration/helpers/users";
import { seedFlashcard } from "../integration/helpers/db";
import { signInViaCookie } from "./helpers/auth";

/**
 * Full generate -> accept -> study journey (test-plan.md Risk #7,
 * context/changes/full-journey-e2e-coverage/plan.md).
 *
 * Risk under test: the "pending" -> "accepted" -> due-list promotion seam.
 * Phase 2's rollout explicitly declined to cross-flow test this ("the seam
 * is documented, not a top risk" -- archived core-flow-correctness/plan.md)
 * -- but the PRD's Primary Success Criterion is exactly this journey
 * end-to-end, so this is the one place e2e earns its cost: a real browser
 * crossing auth, routing, the AI-generation endpoint, acceptance, and the
 * study session.
 *
 * Mocking strategy: only `/api/flashcards/generate` is mocked, at the
 * browser network layer -- the app's own server-side call to the AI
 * provider is unreachable from Playwright (see test-plan.md §6.3). To keep
 * the Accept step onward fully real, a matching "pending" row is seeded
 * directly in the DB first, and the mocked response echoes that same
 * id/front/back, so the (unmocked) PATCH accept call operates on a row that
 * genuinely exists.
 */
test.describe("full generate → accept → study journey (test-plan.md Risk #7)", () => {
  let user: TestUser;
  let proposalId: string;
  let front: string;
  let back: string;

  test.beforeAll(() => {
    applyLocalEnv(readLocalStatus());
  });

  test.beforeEach(async () => {
    user = await createTestUser();
    proposalId = randomUUID();
    front = `Full-journey front ${randomUUID()}`;
    back = `Full-journey back ${randomUUID()}`;
    const ownerClient = await signedInClient(user);
    await seedFlashcard(ownerClient, user.id, { id: proposalId, front, back, status: "pending" });
  });

  test.afterEach(async () => {
    // Cascades the seeded flashcard row via flashcards.user_id's
    // `on delete cascade` FK -- no separate DB cleanup needed.
    await deleteTestUser(user.id);
  });

  test("an accepted proposal is immediately visible and ratable in a study session", async ({
    page,
    context,
    baseURL,
  }) => {
    // Mock only the AI-generation network call; every step from Accept
    // onward hits the real route, real DB, and real SSR, unmocked.
    await page.route("**/api/flashcards/generate", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          flashcards: [{ id: proposalId, user_id: user.id, front, back, status: "pending" }],
        }),
      });
    });

    // This test isn't exercising the login flow itself (seed.spec.ts owns
    // that risk) -- inject a real session cookie instead of driving the
    // /auth/signin form. /generate, /flashcards, and /flashcards/review are
    // all PROTECTED_ROUTES.
    await signInViaCookie(context, user, baseURL ?? "http://localhost:4321");

    // Generate: paste source text, submit, accept the (mocked) proposal.
    await page.goto("/generate");
    await page.getByRole("textbox", { name: "Source text" }).fill("x".repeat(150));
    await page.getByRole("button", { name: "Generate flashcards" }).click();
    await expect(page.getByRole("textbox", { name: "Question" })).toHaveValue(front);
    await expect(page.getByRole("textbox", { name: "Answer" })).toHaveValue(back);
    // The Accept click removes the proposal card optimistically, before the
    // PATCH resolves -- wait for the real response so the next navigation
    // doesn't cancel the in-flight request.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/flashcards/${proposalId}`) && response.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Accept" }).click(),
    ]);

    // Flashcards list: the real PATCH accept call should make the card
    // visible via the real SSR listFlashcards query (status = 'accepted').
    await page.getByRole("link", { name: "Flashcards" }).click();
    await expect(page).toHaveURL(/\/flashcards$/);
    await expect(page.getByText("1 saved", { exact: true })).toBeVisible();
    await expect(page.getByText(front, { exact: true })).toBeVisible();

    // Study session: the real SSR getDueFlashcards call should see the
    // freshly-accepted card as immediately due (due defaults to now() at
    // generation time; the accept PATCH never rewrites it).
    await page.getByRole("link", { name: "Study" }).click();
    await expect(page).toHaveURL(/\/flashcards\/review$/);
    await expect(page.getByText(front, { exact: true })).toBeVisible();
    // ReviewSession is a client:load island -- the server-rendered "Show
    // answer" button can be visible before React hydration attaches its
    // click handler. Retry the click until it actually takes effect.
    // (`exact: true` also avoids matching Astro's dev-mode island-props
    // debug blob, which embeds the same text inside a much larger string.)
    await expect(async () => {
      await page.getByRole("button", { name: "Show answer" }).click();
      await expect(page.getByText(back, { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass();

    // Rate "Good" (real POST review) and confirm the session completes --
    // the only due card was just reviewed.
    await page.getByRole("button", { name: "Good" }).click();
    await expect(page.getByText("No cards due right now. Come back later.", { exact: true })).toBeVisible();
  });
});
