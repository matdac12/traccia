import { ListTodo } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import { PageHeader } from "@/components/traccia/page-header";

export const metadata = { title: "Issues" };

export default function IssuesPage() {
  return (
    <>
      <PageHeader title="Issues" />
      <EmptyState icon={ListTodo} title="Issue views are coming">
        The table and Kanban views arrive in the next dashboard tickets.
      </EmptyState>
    </>
  );
}
