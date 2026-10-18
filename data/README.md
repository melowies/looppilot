# LeetCode metadata catalog

`leetcode.json` is a metadata-only extract of the maintained [doocs/leetcode catalog](https://github.com/doocs/leetcode/blob/main/solution/result.json). It records displayed frontend numbers, English titles, difficulty, slugs, and topic tags. It contains no problem statements, solutions, user history, or completed attempts. Non-numeric regional IDs are excluded.

Source: https://raw.githubusercontent.com/doocs/leetcode/main/solution/result.json

Attribution: the doocs/leetcode contributors; source content is provided under **CC BY-SA 4.0**, retained in `LICENSE.doocs`. The extract preserves factual metadata and omits all other fields. The JSON envelope records retrieval date and the full source file's SHA-256 for provenance. The license applies to this dataset, not to unrelated application files.

Refresh explicitly from the project root:

```powershell
node scripts/update-leetcode.mjs
```

Review the resulting diff and run `npm test` before accepting an update. The script refuses unexpectedly small datasets. It can also normalize a previously downloaded source with `node scripts/update-leetcode.mjs path/to/result.json`.

The server looks up one record from this bundled snapshot. No live LeetCode API or runtime internet access is required. Recently added problems can be absent until the catalog is refreshed; unknown numbers return 404 and the form offers manual entry. Metadata can become stale, so all populated fields remain editable. The browser never downloads the full catalog.
