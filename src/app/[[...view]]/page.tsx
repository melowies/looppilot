import Workspace from "@/components/workspace";
export const dynamicParams = false;
export function generateStaticParams() {
  return [
    { view: [] },
    { view: ["coding"] },
    { view: ["stories"] },
    { view: ["plan"] },
    { view: ["analytics"] },
    { view: ["settings"] },
  ];
}
export default function Page() {
  return <Workspace />;
}
