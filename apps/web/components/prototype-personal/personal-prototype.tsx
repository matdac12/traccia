"use client";
// PROTOTYPE (TRC-148): three variants of the Personal Space on /prototype-personal, switchable via `?variant=`.
// Seeded, in-memory To-dos; the Project keys are real (from the API). Throwaway: lives only on the prototype branch.
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/traccia/page-header";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { type Proj, ProjectsContext } from "./shared";
import { useTodos } from "./store";
import { name as nameA, VariantA } from "./variant-a";
import { name as nameB, VariantB } from "./variant-b";
import { name as nameC, VariantC } from "./variant-c";

const VARIANTS = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
];

export function PersonalPrototype({ projects }: { projects: Proj[] }) {
  // Seeded relative to the browser's today: render on the client only, so server and client agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? (
    <ProjectsContext.Provider value={projects}>
      <Inner projectKeys={projects.map((p) => p.key)} />
    </ProjectsContext.Provider>
  ) : null;
}

function Inner({ projectKeys }: { projectKeys: string[] }) {
  const store = useTodos();
  const keys = new Set(projectKeys);
  const variant = useSearchParams().get("variant") ?? "A";
  return (
    <>
      <PageHeader title={<>Personal <span className="rounded border px-1 font-mono text-[10px] text-muted-foreground">prototype</span></>}>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Seeded data, nothing is saved</span>
      </PageHeader>
      {variant === "B" ? <VariantB store={store} keys={keys} /> : variant === "C" ? <VariantC store={store} keys={keys} /> : <VariantA store={store} keys={keys} />}
      <PrototypeSwitcher variants={VARIANTS} />
    </>
  );
}
