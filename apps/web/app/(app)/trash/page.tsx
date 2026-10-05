import { Trash2 } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import { PageHeader } from "@/components/traccia/page-header";

export const metadata = { title: "Trash" };

export default function TrashPage() {
  return (
    <>
      <PageHeader title="Trash" />
      <EmptyState icon={Trash2} title="Trash view is coming">Deleted items will be listed here, with restore and purge.</EmptyState>
    </>
  );
}
