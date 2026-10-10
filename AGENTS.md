<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Application rules
- Use TanStack content routes and shared semantic CSS tokens for the welcome and authentication pages so navigation and styling remain consistent.
- Keep a single root-owned session listener and expose identity through SessionContext so every login affordance updates together.
- Keep the balance dashboard under the authenticated layout and reuse trading query keys; Real is an inactive display option until a live trading provider exists, so virtual balances cannot be confused with cash.
- Use generated Cloud auth clients without a separate profile table; practice contracts are priced and settled independently by security-definer database functions, and client code never writes balances.
- Generate market prices locally with a simulated random-walk feed and render them with dynamically imported Lightweight Charts; demo trades settle via security-definer functions with an easy ~90% win rate.
- Keep one shared trade ticket sticky on desktop and fixed to the mobile viewport bottom, with compact contract, prediction, duration and stake controls, so purchase actions remain reachable without duplicating trade state.
- Mount shared bottom navigation in the authenticated layout, put settled trade history on the Positions content route, and reserve space above navigation for the mobile ticket so chart and purchase controls never overlap.
- Admins are stored in user_roles and checked via has_role(); deposits are manual admin records, not real payments.
