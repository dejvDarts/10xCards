import { test, expect } from "@playwright/test";
import { applyLocalEnv, readLocalStatus } from "../integration/helpers/local-env";
import { createTestUser, deleteTestUser, type TestUser } from "../integration/helpers/users";

/**
 * Seed e2e spec — the reference pattern for this project's e2e conventions
 * (see context/foundation/test-plan.md §6.3, added when this file was written).
 * Not a rollout phase: e2e stays "reconsider only if a risk needs the full
 * deployed shape" per §4; this is that one case.
 *
 * Risk under test — test-plan.md Risk #4 ("Auth/session gating regresses on a
 * protected route"), page-gating half: a middleware unit test (`middleware.test.ts`)
 * already pins the redirect *decision* in isolation. What it cannot see is the
 * real browser round trip — Set-Cookie landing, the cookie surviving a
 * follow-up navigation, the gate re-engaging after sign-out — which is exactly
 * why this scenario, and only this one, is worth the e2e cost.
 *
 * Conventions demonstrated here:
 *  - `getByRole` (falling back to `getByLabel` only where there's no ARIA role
 *    to hang a query on, e.g. `input[type=password]`) as the default locator —
 *    never CSS selectors or test-ids.
 *  - Assertions wait on observable state (URL, visible text) via Playwright's
 *    auto-retrying `expect`, never a fixed `waitForTimeout`.
 *  - Test data carries a unique identifier per run (`createTestUser()` mints a
 *    `test+cpc-<uuid>@example.test` address) so parallel/rerun runs never
 *    collide — same prefix convention as `tests/integration/helpers/users.ts`.
 *  - Cleanup happens in `afterEach`, independent of pass/fail, via the same
 *    admin-API teardown the integration suite uses.
 */
test.describe("protected route gating (test-plan.md Risk #4)", () => {
  let user: TestUser;

  test.beforeAll(() => {
    applyLocalEnv(readLocalStatus());
  });

  test.beforeEach(async () => {
    user = await createTestUser();
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("redirects an anonymous visitor off /dashboard, then lets the signed-in owner in and back out", async ({
    page,
  }) => {
    // Anonymous visit to a protected route is redirected to sign-in.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/signin$/);

    // Sign in as the freshly seeded, uniquely-identified user.
    await page.getByRole("textbox", { name: "Email" }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The handler redirects to "/" on success — wait for that state, not a timer.
    await expect(page).toHaveURL(/\/$/);

    // With a valid session cookie, the same protected route now renders.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // The email and a "Sign out" control each appear twice (Topbar + main card) —
    // neither Topbar nor the dashboard body use a landmark role to disambiguate,
    // and either instance is equivalent for this assertion/action.
    await expect(page.getByText(user.email).first()).toBeVisible();

    // Signing out drops the session...
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/$/);

    // ...and the gate re-engages for the same route.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/signin$/);
  });
});
