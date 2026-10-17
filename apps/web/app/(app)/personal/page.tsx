import { PersonalSpace } from "@/components/personal/personal-space";
import { loadPersonalSpace } from "@/lib/api/todos";

export const metadata = { title: "Personal" };

export default async function PersonalPage() {
  return <PersonalSpace initial={await loadPersonalSpace()} />;
}
