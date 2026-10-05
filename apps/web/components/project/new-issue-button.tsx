"use client";
import type { ReactNode } from "react";
import { useCreateIssue } from "@/components/create-issue/provider";
import { Button } from "@/components/ui/button";

export function NewIssueButton({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { open } = useCreateIssue();
  return <Button size="sm" className="h-7" onClick={() => open({ projectId })}>{children}</Button>;
}
