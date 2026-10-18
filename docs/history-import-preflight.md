# Supplied history package preflight

Source: `C:\Users\selin\Downloads\looppilot-import-package\looppilot-history.json`.

Validated locally and imported into the signed-in live account on 2026-10-18, after the user manually applied the new migration. The original package is unchanged and has not been copied into public assets or committed source files. No remote migration was applied by the agent.

| Source records | Count |
| --- | ---: |
| Distinct problems | 22 |
| Dated attempts | 15 |
| Stories, all practicing | 4 |
| Unknown attempt confidence | 15 |
| Unknown story confidence | 4 |
| Unknown hint counts | 9 |
| Unknown durations | 15 |

All 22 LeetCode numbers were verified against the source URLs using the maintained metadata catalog. Dates, code, notes, classifications, story content, and unknown values were preserved. The two Number of Islands attempts remain dated 2026-10-06 and 2026-10-11. No planned spreadsheet sessions, fabricated attempts, readiness scores, or official judge results were added.

The complete supplied payload was exercised against a local embedded PostgreSQL database with every project migration and an existing #200 library problem. Preview reported 21 new problems, one existing problem linked, 15 new attempts, and four new stories, without changing persisted records. Commit succeeded locally; repeating the import added zero problems, attempts, or stories. These are local test results, not counts from the live account.

The live import added 21 problems, linked the existing #200 record, and added 15 attempts and four stories, with no conflicts or warnings. Verified account totals are **22 problems, 15 attempts, four practicing stories**, and the original one scheduled task. Every existing source record is unchanged. The two distinct #200 attempts remain attached to the same original problem. A subsequent live preview reported zero new records, 22 linked problems, 15 skipped attempts, and four skipped stories. Unknown confidence, hints, and durations match the supplied source.

Private recovery copies and reports are under ignored `artifacts/history-import/live/`: `account-before-migration.json`, `account-before.json`, `account-after.json`, `account-verified.json`, `commit.json`, `repeat-preview.json`, and `result.json`. Private library/story screenshots are saved there as well. These files must not be committed or served publicly.

For future imports in the app (the supplied package is already imported):

1. The [safe history migration](../supabase/migrations/202610180002_safe_history_import.sql) is now applied to the connected database. Do not rerun it or older applied migrations. `AGENTS.md` requires future remote migrations to be manual.
2. Sign in to LoopPilot and open **Settings & data**. Choose **Export current workspace** and keep the downloaded recovery copy private.
3. Load the original `looppilot-history.json` from the supplied Downloads folder. The app now verifies its problem URLs and fills the corresponding LeetCode numbers automatically. A normalized private copy also exists at `C:\looppilot\artifacts\history-import\looppilot-history.prepared.json`.
4. Choose **Validate & preview**. Check the actual account's linked/new/skipped counts, retained unknown values, warnings, and conflicts. Resolve blocking conflicts before importing.
5. Choose **Import validated records**. Verify the actual problem/attempt/story counts after the refreshed account data loads. Existing problems and history are preserved; identical repeated imports are skipped.

The app uses the signed-in user's public-key/RLS context. It does not use a service-role key, bypass authentication, or expose the private source file through a web route.

Browser coverage uses synthetic records and the actual SQL importer in a local embedded database. Screenshots are `artifacts/history-import/{desktop,wide,mobile}-{preview,reflection}.png`. This verifies export, preview, missing-migration errors, failed-commit recovery, original-file URL identity lookup, repeated import, and nullable historical fields in the IDE. The completed live import separately verified actual Supabase Auth, RLS-scoped export/import, persisted counts, original-record preservation, matching historical fields, and duplicate-free repeat preview. After success the file input resets so the same source file can be selected again for validation.

Verification passed: lint, strict TypeScript, 108 unit/embedded-PostgreSQL tests, all 54 authenticated Chromium checks across 1440×900, 1920×1080, and 390×844, all four setup-preview browser checks, and production build. No deployment or live paid AI request was performed.
