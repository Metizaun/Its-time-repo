import { ReactNode } from 'react';
import { useBreakpoint } from '@/hooks/use-mobile';

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function MobileHeader({ title, subtitle, actions, children }: MobileHeaderProps) {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            {actions}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}