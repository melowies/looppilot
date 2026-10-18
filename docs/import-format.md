# Historical data import · version 1

Upload a supplied JSON file or paste JSON under Settings & data. Export the current workspace, validate the account-aware preview, then import. All records are inserted atomically with authenticated ownership; a failed record rolls back the whole import. Existing records are never overwritten. Exact repeated attempts and stories are skipped. The required new migration is `supabase/migrations/202610180002_safe_history_import.sql`; apply it manually, without editing or rerunning older migrations.

Problems are linked by LeetCode number, canonical LeetCode URL, or exact nonempty source URL. Validation verifies LeetCode URLs against the maintained server-side catalog and fills their displayed numbers; file-local source IDs are never treated as problem numbers. Conflicting identities or an ambiguous existing title block the import. Metadata differences on a verified existing identity are shown as warnings; existing metadata is kept. Manual imported problems and imported attempts/stories retain per-account content origin fingerprints, so repeated uploads stay safe after local source-ID changes or edits to an imported record. Material changes to an input record produce a different fingerprint; review the preview rather than treating edited files as updates.

Preview uses the same SQL validation and transaction path as import, then rolls it back, including planner revision changes. It reports new/linked problems, new/skipped attempts and stories, unknown fields, warnings, and blocking conflicts. A preview does not import anything. Existing records without import origins are also checked for exact content matches. Separate legitimate attempts with different dates remain separate records.

Top-level fields are required: `version: 1`, `problems`, `attempts`, `stories`. Maximum: 2,000 problems, 10,000 attempts, 1,000 stories per import; file selector accepts up to 5 MB. `source_id` is a unique reference within this file, not a database ID. Each `problem_source_id` must reference a problem in the same file. Problems may include a positive integer `leetcode_id`. Never include user IDs.

The following illustrates the contract with placeholders; it is not user history and must not be imported as completed work:

```json
{
  "version": 1,
  "problems": [
    {"source_id": "source-row-1", "title": "REPLACE WITH SOURCE TITLE", "url": "", "difficulty": "Medium", "pattern": "Graphs"}
  ],
  "attempts": [
    {
      "problem_source_id": "source-row-1",
      "data": {
        "attempted_on": "2026-10-17",
        "duration_minutes": null,
        "language": "Python",
        "solution": "",
        "difficulty": "Medium",
        "pattern": "Graphs",
        "assistance": "solution-viewed",
        "hints": 0,
        "correctness": "unverified",
        "test_results": "",
        "time_complexity": "",
        "space_complexity": "",
        "confidence": null,
        "notes": "REPLACE WITH SOURCE NOTES"
      }
    }
  ],
  "stories": [
    {
      "title": "REPLACE WITH REAL EXPERIENCE",
      "principles": ["Ownership"],
      "situation": "", "task": "", "action": "", "result": "",
      "evidence": "", "follow_up_questions": "",
      "confidence": null, "status": "draft"
    }
  ]
}
```

Use only values from source material or explicitly supplied user assessments. If an attempt date, language, assistance classification, result, difficulty, or pattern cannot be established, leave the attempt out and retain the material as a problem or source notes until the user supplies missing facts. Do not substitute today's date or invent a rating. Unknown duration, confidence, and assisted hint count are explicitly `null`, not zero. Dates must be valid `YYYY-MM-DD` dates. Text fields may be empty, not invented. Zero hints means a known zero. Independent attempts require known zero hints; an unknown hint count must not be promoted to an independent pass.

Allowed patterns: Arrays & hashing; Two pointers; Sliding window; Stack; Binary search; Linked lists; Trees; Graphs; Heaps; Backtracking; Dynamic programming; Intervals.

Difficulty: `Easy`, `Medium`, `Hard`. Assistance: `independent`, `hinted`, `guided`, `solution-viewed`. Correctness: `passed`, `partial`, `failed`, `unverified`. Confidence: null or integer 1–5. Duration: null or integer 0–1440. Hints: null or integer 0–100; independent attempts require zero. Story status: `draft`, `practicing`, `ready`; ready requires all four STAR sections. Leadership Principles must exactly match one of the 16 options in the application (`src/lib/domain.ts`).

Unknown confidence is displayed as Unassessed and contributes no low-confidence penalty. Unknown hints remain unknown in editing and explanations; only recorded hint counts can establish repeated-hint workload adjustments. Readiness still uses independently passed problems and explicitly ready stories, not confidence guesses. Self-reported historical passes are not official LeetCode judge results. The app's account export is a private recovery copy of source tables and available planner state, not a v1 import payload or a full transactional Supabase database backup.

No historical readiness snapshots, invented dates, inferred completed tasks, or scores are imported. When source notes are ambiguous, preserve uncertainty and obtain a real assessment first.
