import { PageHeader } from "@/components/traccia/page-header";
import { AppearanceSettings } from "@/components/settings/appearance-settings";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-2xl space-y-8 p-4 sm:p-6">
        <AppearanceSettings />
      </div>
    </>
  );
}
