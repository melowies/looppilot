import {
  lookupLeetcodeProblem,
  lookupLeetcodeSlug,
} from "@/lib/leetcode-catalog";
import { parseLeetcodeNumber } from "@/lib/leetcode";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("number") ?? "";
  const slug = params.get("slug");
  try {
    if (slug !== null) {
      if (!/^[a-z0-9-]{1,200}$/.test(slug)) throw new Error("Invalid slug");
    } else parseLeetcodeNumber(raw);
  } catch {
    return Response.json(
      { error: "Enter a positive LeetCode problem number." },
      { status: 400 },
    );
  }
  try {
    const problem =
      slug !== null ? lookupLeetcodeSlug(slug) : lookupLeetcodeProblem(raw);
    return problem
      ? Response.json(problem, {
          headers: { "Cache-Control": "public, max-age=3600" },
        })
      : Response.json(
          {
            error:
              "Problem not found in the current catalog. Use manual entry.",
          },
          { status: 404 },
        );
  } catch {
    return Response.json(
      { error: "Lookup is unavailable. Use manual entry." },
      { status: 503 },
    );
  }
}
