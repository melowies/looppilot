# LoopPilot

The Study Plan generates an adaptive seven-day schedule from explicit study windows, interview rounds, and recorded performance. See [adaptive planner setup, algorithm, and verification boundaries](docs/adaptive-planner.md). Optional coaching supports an eligible **ChatGPT plan**, the separately billed **OpenAI API**, or **rule-based planning**. The default provider is rule-based; coaching also requires separate consent. ChatGPT plan mode needs no API key. Existing installations do not need a new database migration for this integration.

A personal Amazon SDE I preparation workspace built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase. Adaptive scheduling is deterministic; optional consent-based OpenAI coaching explains validated focus choices. There are no offer predictions.

The persistent Live Study Companion uses the same saved schedule as Overview and Study Plan. Start/pause/resume a session, save a linked coding outcome, or explicitly finish rehearsal; remaining work adapts to the actual time left. Existing installations must **manually apply only** `supabase/migrations/202610180003_live_study_companion.sql` for this feature. See [behavior, setup, and verification](docs/live-study-companion.md). This migration has not been applied remotely by development tooling.

The interface uses a warm rose study-journal theme: blush, cream, berry ink, Averia Sans Libre headings, Karla body/interface text, and a Gochi Hand wordmark with occasional journal details. Desktop navigation sits at the top; mobile navigation stays at the bottom with safe-area padding. Overview groups existing progress beside today’s focus and recent work. Copy uses natural headings and useful empty states, without decorative uppercase eyebrows or generic slogans. Theme and responsive typography tokens live in `src/app/globals.css`. All three Google Fonts are self-hosted by `next/font/google`; the first build needs network access to download them.

The supplied transparent notebook-and-flower artwork is preserved at `public/brand/icon.png` and displayed through `src/components/brand.tsx`. The supplied standalone flower (`favicon.png`) is preserved at `src/app/icon.png`: Next.js automatically registers this file as the browser-tab icon. Both PNGs remain unmodified, with their original transparency, colors, and aspect ratio. Only the standalone flower is used for the favicon.

## Run locally

Requires Node 20.19+ (or Node 22+) and npm.

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open http://127.0.0.1:3000. With empty Supabase configuration the application is an explicitly labeled, read-only setup preview with empty data. No sample attempts, scores, or persistence are simulated.

## Use your ChatGPT plan locally

Keep your existing Supabase URL and public key in `.env.local`. Set these server-only options (edit existing entries instead of appending duplicates):

```dotenv
LOOPPILOT_CHATGPT_LOCAL=1
LOOPPILOT_LOCAL_ORIGIN=http://127.0.0.1:3000
OPENAI_API_KEY=
```

`OPENAI_PLANNER_MODEL` applies only to the separately billed API provider. The ChatGPT model is selected from the connected account’s current model catalog. No OAuth client secret or advance client registration is required for the official local dynamic-registration flow.

Run from this repository in PowerShell:

```powershell
Set-Location C:\looppilot
npm install
notepad .env.local
npm run dev
```

Open **http://127.0.0.1:3000**, sign into your existing Supabase account, and open **Settings**. `localhost` and `127.0.0.1` have separate browser storage: if you previously used localhost, sign into Supabase again at 127.0.0.1. Allow that origin in your Supabase redirect settings. Keep one local LoopPilot server running for the connection.

1. Click **Continue with ChatGPT**. Complete the official OpenAI authorization in the browser. LoopPilot uses `http://127.0.0.1:3000/auth/callback`, a one-time browser binding, random state/nonce, and S256 PKCE. It validates the ID token’s signature, issuer, audience, expiry, and nonce before activating the account. Subsequent sign-ins reuse its issued client ID and the installation’s stable host ID.
2. Check **Connected · plan permission granted**. Identity-only authorization stays visible with inference disabled. Use **Enable ChatGPT plan permission** to request consent explicitly. Eligibility, workspace, region, or policy restrictions cannot be bypassed. Saved registrations can be selected individually; **Add another account or workspace** starts a separate registration.
3. Select an **Available ChatGPT model**, then **Save ChatGPT model**. The list comes from OAuth-authenticated `GET https://api.openai.com/v1/models`; display names stay separate from the actual inference slugs. No model is silently selected for you.
4. Select **ChatGPT plan · existing allowance** under **AI provider**, then **Use selected provider**. Confirm **Current provider: ChatGPT plan**. Connecting an account does not change the provider or grant permission to send your study summary.
5. In **Study plan → Edit availability → AI coaching**, allow the structured summary and save. Add study windows if needed. Return to the plan; optional coaching runs alongside the unchanged deterministic schedule. **Request coaching** retries after an error or retrieves cached validated coaching. Code, narrative, free-form notes, and personal names are excluded.
6. A completed, validated result shows **Using ChatGPT plan · [selected model]**. A **cached** label means this request reused a previously validated result, rather than proving a new live inference. Leave `OPENAI_API_KEY` empty and restart the server to verify this mode has no separately billed API credential available. The browser response from `/api/planner/coach` includes only coaching, provider, model, and generated/cached status—not credentials.

ChatGPT requests consume the existing plan allowance or credits and remain subject to account and app limits. **Manage usage** opens [ChatGPT usage settings](https://chatgpt.com/settings/usage). LoopPilot additionally retains its five-request/UTC-day limit, one-minute spacing, and 12-hour cache. A quota error does not imply a particular reset time or that the whole plan is empty. Failures keep the rule-based schedule available; they never select the paid API. Explicitly selecting **OpenAI API · separately billed** is the only API-key dispatch path.

For production-mode local Node execution, keep the same environment and origin:

```powershell
npm run build
npm start
```

Stop the dev server before starting production on the same port. To use another port, update `LOOPPILOT_LOCAL_ORIGIN` to the exact `http://127.0.0.1:<port>` origin and use `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port <port>`. The callback path stays `/auth/callback`; the authorization and token exchange use the identical URI. Keep the server bound to loopback; do not proxy or expose these local routes publicly. A cloud browser’s 127.0.0.1 refers to that cloud computer, so cloud-side tests do not establish OAuth on your PC.

Credentials and provider/model preferences stay in ignored `.looppilot-local/`, separated by Supabase user and ChatGPT registration. On Windows, the directory has an owner-only ACL and the contents use DPAPI CurrentUser encryption; no administrator setup is required. On Unix, directory/file permissions are 0700/0600. Atomic file replacement and a cross-process exclusive lock serialize refreshes and save replacement refresh tokens together with access tokens. Do not sync this directory to Git, Supabase, another OS account, logs, or support transcripts. Retained ID tokens are not returned to client JavaScript, including authorization URLs. Sign-out from Supabase is independent; use **Disconnect ChatGPT** to end the AI connection.

Disconnect discovers OpenAI’s revocation endpoint, revokes the renewable session with its refresh token, and clears local access/refresh/ID tokens. Account/client mappings and host identity remain for later sign-in. If remote revocation cannot be confirmed, the UI says so and directs you to ChatGPT usage settings. In-flight requests in this server are cancelled; changed/disconnected selections cannot cache their result.

Troubleshooting:

- **Local AI settings require …**: enable `LOOPPILOT_CHATGPT_LOCAL=1`, set the exact loopback origin, restart Next.js, and use 127.0.0.1. Local mode is deliberately off by default and does not qualify a public deployment for subscription access.
- **Sign-in expired/state mismatch**: begin again from Settings in the same browser. Callbacks expire after ten minutes and are consumed once. Do not share callback URLs.
- **Callback says to open the local server**: use the latest code and start a fresh sign-in. The local guard accepts Next.js internal localhost normalization while keeping the browser Host, scheme, and port fixed to the configured loopback origin. Official cross-site browser returns are permitted only on the GET callback; state and the HttpOnly browser binding remain mandatory. Missing binding returns to Settings as failed without touching stored sessions.
- **Identity connected / inference disabled**: required token-response scopes (`openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`) or renewable credentials were not granted. Request plan permission or review actual account eligibility. Identity alone never enables inference.
- **No models / unavailable model**: refresh models for the selected account and save an available model. No unsupported model is substituted.
- **Expired or revoked session**: sign in again with the saved registration. Terminal refresh failures clear unusable tokens; temporary infrastructure failures preserve them and report unavailability. OpenAI does not notify this app immediately about a remote disconnect; the next authenticated request/refresh detects it.
- **Usage limit / permission / serving-region restriction**: review Manage usage or the selected account/workspace. There is no automatic paid fallback, inferred quota reset, or eligibility workaround.
- **Interrupted/malformed/incomplete coaching**: no result is cached until `response.completed`, complete JSON parsing, and evidence validation succeed. Retry later; the schedule remains available.
- **Storage unavailable**: use the same Windows account that created the DPAPI file. Do not move encrypted credentials between accounts. A corrupted file fails closed instead of being overwritten. To recover a lock after a server crash, stop **all** LoopPilot Node processes first and remove only `C:\looppilot\.looppilot-local\session.lock` if it exists; never remove it while another process might be rotating a token. Do not delete the credential file to repair a lock.

This implements the official [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [session lifecycle](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [model/inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and [preview restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Eligibility is controlled by OpenAI; the preview covers eligible local/personal/open-source integrations and does not automatically cover a publicly hosted commercial app. See the [official example and eligibility explanation](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

Automated tests use synthetic OAuth/token/model/inference transports and real signed test JWTs. Windows storage tests exercise actual ACL/DPAPI and file locking with synthetic tokens. Browser tests exercise provider choice and quota recovery at three viewports. **These checks do not prove real account eligibility, OAuth, model access, revocation, or completed subscription inference.** Personal ChatGPT login and the first authorized completed coaching request remain manual verification steps. No real AI inference is executed by tests or build.

## Connect your database

1. Create your own Supabase project. No external resources are created by this repository.
2. Execute the SQL files in `supabase/migrations/` once in filename order using the Supabase SQL editor. Existing installations need only unapplied migrations, including `202610180001_adaptive_planner.sql`. Never reapply the initial migration to an existing database or automatically migrate a remote database.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` using the project URL and public anon key (the publishable key also works). Never use a service-role/secret key here. `.env.local` is gitignored.
4. Enable Email/password under Supabase Authentication. Set Site URL to `http://localhost:3000`, and allow both `http://localhost:3000` and `http://localhost:3000/**` in redirect URLs. If you open the app at `127.0.0.1`, allow that origin too. Use only your actual application origin in a production environment.
5. Restart `npm run dev`. Create an account and confirm your email. Sign in, set your name/interview date/timezone, add a problem, record an attempt, and write your first story.

Supabase Auth owns passwords and email verification. Sessions are browser-managed. Private data is loaded only after authentication; every table enforces `auth.uid()` ownership through Row Level Security. Composite foreign keys prevent linking a user's attempts or tasks to somebody else's problem. There are no server endpoints trusting a client-supplied user ID, and no service-role key is needed.

See [Supabase's security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) for production project configuration. Public keys are intentionally public; RLS is the access boundary. For this single-user product, disable new signups in Supabase after creating your account if desired.

## Behavior and limits

- Add a problem by entering its displayed LeetCode number. A debounced server lookup fills title, difficulty, canonical URL, and available topic tags from a bundled 4,081-record metadata snapshot. No runtime LeetCode API is used. Review/override the fields before saving; ambiguous or unsupported tags require choosing a pattern. Unknown IDs, outages, and malformed responses preserve manual entry. See [catalog provenance and refresh instructions](data/README.md).
- The additive LeetCode migration adds nullable `leetcode_id`, topic tags, and a unique `(user_id, leetcode_id)` index. Old manual problems and their attempts are unchanged. The UI also detects recognizable legacy LeetCode URLs; you can edit an existing manual problem to associate its frontend number without changing its ID or attempts. Database uniqueness handles concurrent inserts. JSON history import remains the existing manual-problem format and does not infer LeetCode identities.
- Shared dialogs are native modal dialogs portaled to `document.body`, centered by component-local fixed 50% positioning and a half-size translation. Their geometry no longer depends on global auto-margin rules that can be missing or overridden in an older stylesheet. The backdrop covers the viewport; long forms scroll inside, the header stays visible, background scroll is locked, Tab focus wraps, Escape closes, and opener focus/scroll are restored. Lookup input/button alignment is likewise defined on the controls row. See [measured positioning evidence](docs/dialog-positioning.md).

- Coding problems and attempts have separate lifecycles; editing solution code edits the selected attempt. Deleting a problem deletes its attempts and linked tasks after confirmation.
- Number of Islands (#200) automatically loads curated samples and runs unsaved Python `class Solution` code in a self-hosted, sandboxed browser worker with timeouts. Results show actual/expected outputs, exceptions, and console output. Sample passes never update self-reported correctness or readiness. Other problems retain code storage and custom cases. See [execution and timer behavior](docs/python-practice.md).
- Active practice time starts on editing or Run Code; Pause/Resume, tab visibility, and five-minute inactivity pauses exclude paused time. Local draft/timer recovery survives refresh and reopening. Saves round measured seconds up to database minutes while retaining exact seconds and manual-correction provenance in existing evidence storage. Historical durations stay unchanged. Solution-viewed, guided, and hinted attempts never count as independent solves.
- Adaptive reviews start at D+1, D+3, and D+7 after the first attempt. Only independent passes on distinct eligible days advance a stage. Failed/assisted reviews return with higher priority; later failures can reopen recovery review. Completing a task does not create learning evidence.
- Daily schedules prioritize overdue reviews, latest pattern weaknesses, assistance, low confidence, behavioral gaps and the next interview format/deadline. They fit explicit availability, breaks, and session caps. See [the algorithm and its limits](docs/adaptive-planner.md).
- Evidence index: 70% distinct independently passed problems / distinct attempted problems + 30% ready stories / all stories. Requires five distinct attempted problems, three observed patterns, and two stories. This heuristic is not a validated assessment or an offer probability. Snapshots are saved only on explicit request, using current evidence.
- Dates use the configured IANA timezone, defaulting to Europe/Istanbul. No interview date or old activity is assumed.
- JSON imports validate before confirmation and execute in one database transaction. Reimporting the same file creates new records. See [the import contract](docs/import-format.md).
- Study sessions can be logged. Generated sessions support complete, skip, pin and reschedule; completed history and older manually scheduled task records are preserved. Completion is self-reported and does not inflate coding analytics.
- Supabase loads the current account's history into memory. This is intentionally simple for one user's month of preparation; pagination belongs in a later phase.

## Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Database tests run the actual migration against embedded PostgreSQL (PGlite), with an emulated Supabase `auth.uid()` and two authenticated accounts. They test CRUD, RLS isolation, cross-owner FK rejection, and import rollback. They do not replace a live Supabase Auth integration test.

Optional browser checks (start with empty Supabase environment variables):

```powershell
npm run browser:install
npm run test:e2e
npm run test:crud
```

The browser suite checks all setup-preview routes, import validation, mobile navigation, console errors, and horizontal overflow at 390px/1440px. It writes local screenshots to ignored `artifacts/`. Live authenticated CRUD and email delivery must additionally be verified after supplying your own Supabase configuration.

`test:crud` runs a separate test server on port 3002 with a fake Supabase session and intercepted persistence requests. It uses the real server metadata route and checks all five example IDs, manual fallback, field overrides, legacy/database duplicates, no attempt creation, and Add Problem/Add Story centering, resize behavior, keyboard focus, scroll locking and restoration. Its 18 checks cover 1440×900, 1920×1080 and 390×844, including actual bounding rectangles, conflicting older CSS, transformed/clipped parent containers, and lookup-button alignment. Run the two browser suites sequentially. Database constraints and migration preservation are tested against real embedded PostgreSQL; browser mocks do not verify a hosted Supabase connection. Verification also includes 53 Vitest tests, four setup-preview checks, lint, types, and production build.

Verified after the brand refinement on October 17, 2026: lint, TypeScript, production build, and 29 Vitest tests passed. Chromium verification passed four tests across desktop/mobile, covering all six routes, active navigation, keyboard skip navigation, import preview, horizontal overflow, removed label elements, and successful loading of the exact supplied brand PNGs and favicon. Screenshots were visually reviewed. Sign-in, signup, and password-reset presentation was additionally checked at desktop/mobile sizes without submitting forms. Browser CRUD tests deliberately use an isolated empty Supabase configuration; account creation, email delivery, password changes, and live Supabase CRUD were not exercised. No external deployment was performed. Existing authentication behavior, planning rules, and the database model remain unchanged.

Dependency audit: production packages have no reported vulnerabilities at implementation time. The full audit reports five high-severity entries along the single development-only `eslint-config-next → fast-glob → micromatch → braces` chain. The latest compatible `braces` is affected; npm's suggested framework-lint downgrade is not an appropriate fix. Do not pass untrusted glob patterns to local tooling; revisit this advisory when upstream publishes a compatible patch.

## Phase 2

Real source-file import adapters; longer retention schedules; readiness trends from genuine saved snapshots; separate behavioral rehearsal outcomes; scored mock interview workflows; and future calendar adapters. Calendar synchronization, speech and payments are not implemented. Optional OpenAI coaching now requires explicit consent and server configuration.
