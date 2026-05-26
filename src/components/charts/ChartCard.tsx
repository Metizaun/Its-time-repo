import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, action, children }: ChartCardProps) {
  return (
    <section className="chart-container">
      <div className="chart-container__header">
        <div>
          <h3 className="chart-container__title">{title}</h3>
          {subtitle && <p className="chart-container__subtitle">{subtitle}</p>}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="chart-container__body">{children}</div>
    </section>
  );
}
