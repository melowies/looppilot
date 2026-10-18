export const get = (f: FormData, k: string) => String(f.get(k) ?? "");
export const num = (f: FormData, k: string) => Number(f.get(k));
export const pretty = (s: string) => s.replaceAll("-", " ");

export function message(e: unknown) {
  if (e && typeof e === "object" && "issues" in e) {
    return (e as { issues: { message: string }[] }).issues
      .map((i) => i.message)
      .join(" ");
  }
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Something went wrong. Please try again.";
}
