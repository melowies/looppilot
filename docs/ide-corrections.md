# Coding workspace corrections — October 18, 2026

## Root causes

- `python-problems.ts` registered only #200 and `PythonExecutionRequest.method` allowed only `numIslands`. The sandbox harness unconditionally parsed a grid and called that method. #206 therefore received neither starter nor cases, and the testing panel's instructions were hardcoded to grid inputs. This was missing implementation, rather than evidence of a stale build.
- `usePracticeTimer` ran independently of the persisted companion session. Saving paused only the local attempt timer. Session links were first selected during saving, so the visible clocks could disagree and a late save could select a different active session. No schema change was needed: attempt timing and session timing already have distinct meanings and storage.
- The IDE combined a fixed minimum grid height with an independently capped, scrolling content wrapper and hardcoded viewport deductions. These sizes were not derived from the actual content top and companion height. The corrected desktop flex grid fills the measured remaining region; only panel contents scroll in the normal compact layout. Expanded companion/small-height views retain an outer escape scroll. Monaco's existing `automaticLayout` responds to the resulting panel dimensions; pointer and keyboard splitters remain functional. On mobile, explicit tab/run actions bring the selected panel below sticky tabs, and the large heading scrolls away; the workspace has one outer scroll region instead of leaving results below the toolbars.
- The unsaved-work guard removed its temporary same-URL history entry with an asynchronous Back during effect cleanup. An immediate post-save refresh could race that navigation and abort. Saving and attempt switching now explicitly await guard removal before exposing the completed transition.
- Overview's canonical focus used bare content inside a panel whose header already had padding. A shared `.panel-body` supplies consistent content padding. Its countdown read only `profile.interview_date`, ignoring configured rounds. `interview-countdown.ts` now uses the scheduler's unended-round, interview-timezone and hours-to-days semantics, with the profile date only as the no-round fallback.

## Implementation boundaries

Files changed for this correction (the workspace already contained uncommitted companion work):

| Area | Files |
| --- | --- |
| Problem content and execution | `src/lib/python-problems.ts`, `src/lib/python-runner.ts`, `src/lib/coding-workspace.ts` |
| Session identity and timing | `src/lib/live-study.ts`, `src/components/use-practice-timer.ts`, `src/components/linked-study-indicator.tsx`, `src/components/live-study-companion.tsx` |
| IDE, chosen-task start, Overview | `src/components/coding-practice.tsx`, `src/components/study-plan.tsx`, `src/components/overview.tsx`, `src/lib/interview-countdown.ts`, `src/app/globals.css` |
| Regression coverage | `tests/problem-content.test.ts`, `e2e-crud/reverse-linked-list.spec.ts`, `e2e-crud/python-execution.spec.ts`, `e2e-crud/coding-practice.spec.ts` |
| Documentation | `docs/python-practice.md`, this report, continuation notes in `AGENTS.md` |

The typed registry contains curated #200/#206 summaries, contracts, constraints, canonical links, starters, examples and adapter methods. #206 inputs become `ListNode` chains; output serialization detects cycles, invalid values and traversals over 5000 nodes. Execution remains inside the disposable opaque-origin browser worker, under the existing network-denying CSP and timeouts. It never runs on Next.js.

New linked attempts capture exact session identity during opening, and the attempt clock stops advancing. Existing attempt seconds/minutes remain separate and frozen; fresh linked attempts have unknown separate duration. An identity-only subscription avoids heartbeat rerenders of the controlled editor. The header indicator independently subscribes to the shared running/paused/finished state and opens the companion. New attempt never sends a session start RPC. Study Plan can explicitly Start a chosen session, subject to the existing owner/revision/window checks. Existing database session/RLS/trigger rules are unchanged.

Saved solutions stay hidden until explicitly selected in Previous attempts. Reopening restores their exact code and custom cases. Running default samples for an attempt with no saved cases does not rewrite historical evidence. Only untouched blank local previews receive newly available starters. Historical durations, classifications and dates are never inferred.

## Evidence

`e2e-crud/reverse-linked-list.spec.ts` exercises Study Plan → Start Review Reverse Linked List → Open task at 1440×900, 1920×1080 and 390×844. It pastes Python through Monaco, runs the actual local WebAssembly runtime, checks expected/actual outputs for correct/wrong/cyclic results, adds a single-node custom case, saves an unverified draft, refreshes, explicitly records a guided partial outcome, checks session evidence, navigates Overview/back, and compares the original historical attempt byte-for-byte. Additional checks cover numeric identity, legacy URL identity, blank recovery, edited recovery, old attempt timing retention and new-attempt session continuity. Existing Python checks also exercise runtime exceptions, suite timeout, cancellation, loading failures and historical evidence preservation. Supabase transport in these automated tests is isolated and synthetic; Python execution is real.

Screenshots are under ignored `artifacts/{desktop,wide,mobile}-reverse-linked-list{,-results}.png`. A separate read-only check used the existing private browser profile against the personal server/account and observed the real stored Reverse Linked List opening with its content, starter, enabled runner and retained paused 0:22 session. Its screenshot and script remain in ignored `artifacts/ide-verification/`. No attempt was saved during that live check, and coaching requests were blocked. Full live-account save/completion behavior was not tested against real history.

No deployment, remote migration, paid inference or historical-data rewrite was performed.

Final verification passed: `npm run lint`, `npm run typecheck`, all **169** unit/embedded-PostgreSQL tests, the full **78** authenticated Chromium scenarios at the three requested viewport sizes, all **six** setup-preview/real-route checks, and an isolated production `npm run build` using `.next-preview`. After the final mobile-only panel-visibility refinement, all **36** affected IDE/Python/companion/#206 checks passed again without retries, as did lint/types/169 tests and the production build. The mobile #206 check explicitly asserts that the first actual output is in the viewport after Run Code. The personal server was not stopped or deployed.

Pre-commit review on October 27, 2026: lint, strict types, all 169 unit/embedded-PostgreSQL tests, the isolated production build, and all six preview/real-route checks passed again. The full authenticated browser run passed 77/78: the desktop automatic break-completion check timed out while a request was pending. That unchanged check then passed all nine sequential repetitions (three per viewport). This intermittent timing failure remains a verification limitation; no product fix was inferred from the reruns. Tracked text files were scanned for credential patterns, and private exports, local credentials, runtime assets and test artifacts remain excluded from Git. No remote migration, deployment, or live inference was performed.
