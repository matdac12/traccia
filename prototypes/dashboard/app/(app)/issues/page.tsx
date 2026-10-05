import { Suspense } from "react";
import { IssuesView } from "@/components/tracker/issues-view";

export default function Page() {
  return <Suspense><IssuesView /></Suspense>;
}
