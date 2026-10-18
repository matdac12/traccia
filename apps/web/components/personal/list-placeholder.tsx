import { Construction } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";
import type { PersonalList } from "@/lib/personal/lists";
import { LISTS, projectKeyOf } from "./list-menu";
import { ListHeading } from "./list-heading";
import { ProjectChip } from "./todo-title";

/** Upcoming, Anytime, Logbook and By project arrive with TRC-163; until then their menu entry opens this. */
export function ListPlaceholder({ list }: { list: PersonalList }) {
  const projectKey = projectKeyOf(list);
  return (
    <>
      <ListHeading>{projectKey ? <ProjectChip projectKey={projectKey} /> : LISTS.find((l) => l.id === list)?.label}</ListHeading>
      <EmptyState icon={Construction} title="This list is not built yet" className="rounded-lg border border-dashed py-12" />
    </>
  );
}
