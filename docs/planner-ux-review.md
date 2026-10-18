# Study Plan UX review

Reviewed on 2026-10-18 in Chromium at 1440×900, 1920×1080, and 390×844.

## What changed

- **Joined text:** unavailable-day text and the add-window action were inline siblings without a layout gap. They now occupy separate rows with explicit spacing. The empty-state edit action was inside the descriptive paragraph; it now uses the existing `Empty` action slot. A mobile global rule also constrained the regenerate action to 85px and 10px text; the planner now gives it room to wrap naturally at 14px.
- **Availability dialog:** five keyboard-accessible tabs separate Study schedule, Interview rounds, Days off & exceptions, Advanced settings, and AI coaching. Every existing field remains available. Drafts survive tab changes. The content body scrolls independently, with a persistent header, tabs, and sticky save/cancel footer. The planner header uses the outer flex frame instead of a redundant sticky layer, fixing a disappearing header during mobile field scrolling. Other dialogs retain their existing geometry and behavior.
- **Validation and recovery:** saving reveals the tab containing an invalid native field and focuses it. Schema errors identify their section where a field path is available. Errors stay above the footer, failed saves preserve the draft, and cancel/Escape restore opener focus.
- **Plan explanations:** five sections provide priorities, task rationale, activity allocation, comparison with yesterday, and AI status. Longer evidence and time-accounting explanations remain available in native disclosure controls. Browser checks verify every original generated explanation remains visible after expanding them.
- **Calendar:** each date labels available window minutes, planned study estimates, completed session count, and remaining planned study minutes. Unavailable dates have a subtle hatch and a text label. Completed sessions use the existing sage palette and a side rule. The daily limit explicitly does not create availability; planned and remaining minutes are not recorded durations.
- **Readability:** planner body copy and secondary text have more space and stronger contrast using existing rose/berry colors. Form labels and actions are at least 14px; form controls use 16px text. Grids have explicit minimum widths and responsive columns. Fonts, branding, logo assets, and desktop/mobile navigation are preserved.

The scheduling engine, planner repository, Supabase schema/migrations, authentication, and AI API integration were not changed.

## Before and after screenshots

These are local, ignored artifacts under `artifacts/planner-ux/`. Page images are full-page captures from the named viewport; dialog images use the viewport dimensions. Screenshots use isolated test transport and a fixed Monday, 2026-10-19 clock. They contain test-only schedules, not real preparation history. Completed examples result from clicking Complete in that isolated test account and create no coding attempt.

| Viewport | Study Plan | Availability dialog |
| --- | --- | --- |
| Desktop · 1440×900 | [Before](../artifacts/planner-ux/before-desktop-plan.png) · [After](../artifacts/planner-ux/after-desktop-plan.png) | [Before](../artifacts/planner-ux/before-desktop-availability.png) · [After](../artifacts/planner-ux/after-desktop-availability.png) |
| Wide · 1920×1080 | [Before](../artifacts/planner-ux/before-wide-plan.png) · [After](../artifacts/planner-ux/after-wide-plan.png) | [Before](../artifacts/planner-ux/before-wide-availability.png) · [After](../artifacts/planner-ux/after-wide-availability.png) |
| Mobile · 390×844 | [Before](../artifacts/planner-ux/before-mobile-plan.png) · [After](../artifacts/planner-ux/after-mobile-plan.png) | [Before](../artifacts/planner-ux/before-mobile-availability.png) · [After](../artifacts/planner-ux/after-mobile-availability.png) |

Additional states:

| Viewport | Empty state before / after | Scrolled dialog | Interview fields | Completed session and expanded explanations | Failed save |
| --- | --- | --- | --- | --- | --- |
| Desktop | [Before](../artifacts/planner-ux/before-desktop-empty.png) · [After](../artifacts/planner-ux/after-desktop-empty.png) | [View](../artifacts/planner-ux/after-desktop-availability-bottom.png) | [View](../artifacts/planner-ux/after-desktop-interviews.png) | [View](../artifacts/planner-ux/after-desktop-completed.png) | [View](../artifacts/planner-ux/after-desktop-save-error.png) |
| Wide | [Before](../artifacts/planner-ux/before-wide-empty.png) · [After](../artifacts/planner-ux/after-wide-empty.png) | [View](../artifacts/planner-ux/after-wide-availability-bottom.png) | [View](../artifacts/planner-ux/after-wide-interviews.png) | [View](../artifacts/planner-ux/after-wide-completed.png) | [View](../artifacts/planner-ux/after-wide-save-error.png) |
| Mobile | [Before](../artifacts/planner-ux/before-mobile-empty.png) · [After](../artifacts/planner-ux/after-mobile-empty.png) | [View](../artifacts/planner-ux/after-mobile-availability-bottom.png) | [View](../artifacts/planner-ux/after-mobile-interviews.png) | [View](../artifacts/planner-ux/after-mobile-completed.png) | [View](../artifacts/planner-ux/after-mobile-save-error.png) |

## Verification

`e2e-crud/planner-ux.spec.ts` adds nine Chromium checks (three scenarios per viewport). They measure text/action separation, label/input spacing, control widths, document/dialog overflow, footer position before/after scrolling, and header/tab/footer hit testing. They exercise keyboard tab navigation and focus wrapping, all five settings sections, adding/removing records, draft retention, save/reopen, cancel/Escape, hidden-field validation, failed-save retry, calendar selection, and completion without recording a solve.

Passed:

- `npm run lint`
- `npm run typecheck`
- `npm test`: 97 tests, including embedded PostgreSQL checks
- `node node_modules/@playwright/test/cli.js test --config playwright.crud.config.ts --workers=3`: all 51 authenticated browser checks, including IDE, Python, timer, and planner regressions
- `npm run test:e2e`: all four setup-preview browser checks
- `npm run build`: production compilation, TypeScript, and static page generation

Live Supabase persistence and live OpenAI responses are outside these browser fixtures. No migration, deployment, or paid AI call was performed.
