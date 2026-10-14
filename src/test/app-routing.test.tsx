import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { probability } from "@/routes/_authenticated/trade";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches a referral link and the referral dashboard", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes("/r/abc1234567").at(-1)?.routeId).toBe("/r/$code");
    expect(router.matchRoutes("/referrals").at(-1)?.routeId).toBe("/_authenticated/referrals");
  });

  it("keeps demo trades near a 90% win rate", () => {
    expect(probability("EVEN", 0)).toBe(0.9);
    expect(probability("ODD", 0)).toBe(0.9);
    expect(probability("OVER", 5)).toBe(0.9);
    expect(probability("UNDER", 5)).toBe(0.9);
    expect(probability("MATCHES", 7)).toBe(0.9);
    expect(probability("DIFFERS", 7)).toBe(0.9);
  });
});
