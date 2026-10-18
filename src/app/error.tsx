"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading">
      <h1>Something interrupted your workspace.</h1>
      <p>Your saved data remains in Supabase.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
