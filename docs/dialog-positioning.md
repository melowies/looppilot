# Shared dialog positioning regression

The supplied screenshots show two layout failures together: the modal sits at `(0,0)` and the lookup button falls below its input. Both layouts previously depended entirely on recently added global stylesheet declarations.

Before changing the component, fresh Chromium renders of the checked-in code were centered at all three requested sizes. Reintroducing conflicting older global rules (`.dialog { inset: 0; margin: 0 }` and `.problem-lookup { display: block }`) reproduced the screenshots' top-left placement and stacked lookup controls. Horizontal center errors were **340px**, **580px**, and **18px** at 1440×900, 1920×1080, and 390×844 respectively. The portaled dialog's parent was BODY and position was fixed, so a parent-relative container was not the cause of that reproduction.

This establishes the failure mechanism: the old fix depended on the current global positioning/alignment declarations taking effect. It does **not** establish why the user's browser had different styles; no network/cache trace from that browser was available. A stale stylesheet is a plausible explanation, not a proven cache diagnosis.

The shared fix puts critical geometry directly on the rendered dialog: fixed position at 50%/50%, translation by half its own size, explicit zero margin, and viewport-constrained width/height with internal scrolling. Normal stylesheet rules cannot override those inline values. The existing native top-layer modal, portal, backdrop, focus wrapping, Escape handler, focus restoration and scroll lock are preserved. Only appearance remains in global dialog CSS.

The lookup input and button now have a dedicated controls row with component-local grid alignment. Help/status messages follow the row and cannot push the button beneath the input. Lookup behavior is unchanged.

## Browser verification

Run `npm run test:crud`. The tests measure `getBoundingClientRect()` for Add Problem (empty and populated), Add Story, and internally scrolled Add Story. They require horizontal/vertical center errors <=5px whenever the modal fits, no horizontal overflow, and lookup-control vertical alignment within 3px. A second pass injects conflicting global rules and a transformed, clipped app container. Existing tests exercise background page scrolling, viewport resizing, keyboard focus, Escape closing and focus/scroll restoration.

Measured centers after the fix, for both dialog types and both stylesheet conditions:

| Viewport | Center X | Center Y | X/Y error |
| --- | --- | --- | --- |
| 1440×900 | 720 | 450 | 0px / 0px |
| 1920×1080 | 960 | 540 | 0px / 0px |
| 390×844 | 195 | 422 | 0px / 0px |

Screenshots and JSON measurements are generated under `artifacts/`, for example `desktop-current-css-add-problem.png`, `wide-current-css-add-story.png`, `mobile-current-css-add-problem.png`, and the matching `*-dialog-measurements.json` files. Fixtures use a fake Supabase session with intercepted persistence requests; no real account or database is changed.
