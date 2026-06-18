import type { ReactNode } from "react";
import { SectionLabel } from "@/components/dashboard/SectionLabel";

export function DashboardSection({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `dashboard-section ${className}` : "dashboard-section"}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}
