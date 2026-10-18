import Workspace from "@/components/workspace";

export default async function PracticePage({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const { problemId } = await params;
  return <Workspace practiceProblemId={problemId} />;
}
