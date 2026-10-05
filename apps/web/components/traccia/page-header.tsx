import type { ReactNode } from "react";

/** `tabs` (a section nav) sits under the title row, sharing the header's bottom border. */
export function PageHeader({ title, children, tabs }: { title: ReactNode; children?: ReactNode; tabs?: ReactNode }) {
  return (
    <header className="shrink-0 border-b">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 sm:px-4">
        <h1 className="flex min-w-0 items-center gap-2 text-[13px] font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
      {tabs ? <div className="px-3 sm:px-4">{tabs}</div> : null}
    </header>
  );
}
