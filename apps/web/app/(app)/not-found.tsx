import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/traccia/empty-state";

export default function NotFound() {
  return <EmptyState icon={SearchX} title="Not found">This page or item does not exist, or it was deleted.</EmptyState>;
}
