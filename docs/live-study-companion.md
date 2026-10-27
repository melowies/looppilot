# Live Study Companion

The companion, Overview focus, and Study Plan read the canonical owner-isolated `study_plans` schedule. The older `daily_study_tasks` list remains available as history in Study Plan; it no longer substitutes for the current adaptive task on Overview.

## Enable persistence

After the existing planner and safe-import migrations, manually apply **only** `supabase/migrations/202610180003_live_study_companion.sql` in Supabase. Do not rerun earlier migrations. No new table, dependency, credentials, or deployment is required. The new migration adds session actions and a linked-attempt trigger, and updates planner reads/validation/commits. It never backfills or rewrites preparation history.

Until that migration is applied, the schedule remains readable and live controls report the missing migration. It has been verified in embedded PostgreSQL, not against the personal live Supabase account.

## Session behavior

- The floating panel shows the current or next task, scheduled interval, category, status, acknowledged active time, estimated remaining time, and next scheduled task. Expand it for Start, Pause, Resume, Finish, Skip, and Open task. An available task for today may start before its scheduled minute, within the configured window.
- Desktop places it at the bottom right. Mobile places it above bottom navigation and respects the safe area. The IDE uses a bounded scroll region above the panel so code and test controls remain accessible. Minimize it to recover vertical space. Story dialogs show the canonical session and controls inside the browser's dialog layer.
- Starting is explicit. Opening a page, typing, running samples, or reaching the scheduled end never finishes coding practice. Generic sessions and rehearsal use explicit Finish. Editing a story never records interview rehearsal; separate behavioral outcome records are still unsupported.
- Breaks also require Start. Their countdown uses active time, pauses when hidden or explicitly paused, and sends an idempotent completion when acknowledged time reaches the break estimate. End break finishes early. Merely waiting for an unstarted break's end does not complete it.
- Brief completion and due-task messages appear within the panel without a transition popup. No notification permission or background service is used.

## Coding evidence

Only a **new** attempt saved while a matching problem session is active receives a `studySession` link in the existing `looppilot-workspace-v1` test-evidence envelope. The link identifies the plan date, item key, and server-recorded start. Draft recovery, attempt selection, and later saves preserve it.

The database trigger verifies ownership, the problem, the live start identity, category, and the current date in the study timezone. A new linked `passed`, `partial`, or `failed` result completes attempted practice atomically with saving the attempt. Guided, hinted, or viewed-solution attempts can finish practice. The task separately retains attempt ID, outcome, assistance, supplied attempt duration, active session time, and actual completion timestamp. An `unverified` draft remains unfinished until a qualifying result is saved. Attaching a link through a historical edit cannot finish a task; changing an already linked draft's result can.

Task completion does not modify correctness, hints, confidence, readiness, repetition stages, historical dates/durations, legacy tasks, or sample results. Existing independent-solve requirements still apply. Attempt duration and companion active time are separate measurements; unknown attempt durations remain unknown.

## Timing, navigation, connectivity, and concurrency

Session state lives in each schedule item's optional `live` object. Five-second heartbeats are serialized under the existing per-account planner lock. A heartbeat can credit only the smaller of server-observed time and the current mounted observer's bounded interval. Navigation, reload, closed-app gaps, and hidden time therefore cannot be recovered as active study time. Only acknowledged seconds are durable; a last unacknowledged interval can be lost. The panel interpolates a bounded display within its current observation, and other views show acknowledged time.

One running or paused session is allowed per account. A running timer has a tab owner; another tab can pause it and explicitly resume to take over. Hidden/page-exit handlers request a pause. A missing heartbeat older than 15 seconds is reconciled to paused on the next server read without crediting the gap. The app does not run while closed.

Owner-keyed local snapshots retain the last readable schedule through navigation, refresh, or connection failure. Supabase remains authoritative. Failed actions remain visible and require retry after reconnection; there is no hidden offline write queue or falsely successful completion. Signing out clears that account's cached schedule. Storage signals synchronize same-browser actions; visible tabs also check the persisted revision every 15 seconds and on focus/reconnection. Evidence writes refresh other visible dashboard views, while background planning stays outside the controlled IDE.

Start/pause/resume/finish/skip use revision checks; repeated terminal actions are harmless. Heartbeats do not invalidate performance revisions or trigger coaching. Atomic schedule commits merge the latest live timing to avoid overwriting a heartbeat read during generation. RPCs require `auth.uid()`, qualify account access, and use an empty search path. Existing table RLS and SELECT-only client grants remain in force.

## Replanning

The existing deterministic seven-day engine remains the scheduling authority. A completion or skip is committed first, then a revision refresh reloads authoritative evidence and regenerates remaining work using the current instant.

Completed, skipped, missed, pinned, running, and paused records survive. Actual completion intervals replace estimated blocking intervals for timed work. Free slots round inward to minute boundaries so second-precision completion/rest boundaries cannot overlap. Minimum breaks, minimum work lengths, daily limits, unavailable periods, interview deadlines, timezone/DST intervals, and hard window ends continue to apply. Recently finished work can produce an explicit remaining break. Short gaps remain free; lower-priority work is reconsidered in future available windows.

While a session is explicitly running or paused, its end is unknown. The engine withholds new unpinned work for today until Finish/Skip; pinned commitments remain visible, with conflicts flagged. The companion's next scheduled item may therefore be on a provisional future day. Finishing recalculates today's remaining work immediately. It never extends availability or automatically ends an overrun.

Study Plan shows the active session, planned versus active/attempt time, remaining window minutes before the interview or hard end, completion deviations from the scheduled end, and named deferred work. Unknown historical timing remains unknown. Failed/assisted outcomes continue to influence existing review and pattern priorities; estimates use recorded attempt timings. Readiness never rises from a task checkbox.

Existing explicit AI provider selection, consent, privacy filtering, bounded requests/cache, and deterministic fallback remain intact. Optional Study Plan coaching is coalesced for 1.2 seconds after revision changes. Timer ticks and heartbeats do not change the coaching key. There is no automatic fallback from ChatGPT to paid API inference. Development made no live OAuth, inference, or revocation request.

## Verification

`tests/live-study.test.ts` and `tests/live-study-database.test.ts` cover early/late completion, limited time and deferral, active/pinned preservation, changed interview constraints, exact actual blocking intervals, immutable readiness evidence, bounded timing, pause/resume, expired leases, break gating, linked failed/partial/guided outcomes, unverified drafts, historical edits, idempotent completion/skip, heartbeat/commit races, forged metadata, and account isolation.

`e2e-crud/live-study.spec.ts` exercises the real UI at 1440×900, 1920×1080, and 390×844 with isolated in-memory Supabase transport. It covers canonical Overview/Study Plan focus, navigation through coding/IDE/stories/readiness, story-dialog visibility without practice completion, pause/resume, refresh, connection-failure recovery, multiple tabs, closing/reopening, unverified-to-classified attempt saves, and started/paused/hidden/elapsed break transitions. Browser break fixtures advance stored seconds near the boundary, then require the UI's genuine heartbeat and automatic completion request. Hidden-tab tests dispatch visibility changes because headless Chromium keeps tabs visible.

Screenshots under ignored `artifacts/` use test data only:

- `{desktop,wide,mobile}-live-study-overview.png`
- `{desktop,wide,mobile}-live-study-ide-active.png`
- `{desktop,wide,mobile}-live-study-story-editor.png`
- `{desktop,wide,mobile}-live-study-companion.png`
- `{desktop,wide,mobile}-live-study-ide.png`

Final verification: lint, strict types, all **164** offline tests, production build, **27** sequential IDE/Python/companion browser checks without retries, three final screenshot checks, and all **six** setup-preview/real-route checks passed. The broader 69-case authenticated run had 67 passes before the final viewport adjustment; both affected editor cases passed in the final sequential rerun. All 12 companion cases passed across the three viewports. These checks do not verify live Supabase, deployment, personal user history, or real ChatGPT inference. Continuation guidance is recorded in `AGENTS.md`.
