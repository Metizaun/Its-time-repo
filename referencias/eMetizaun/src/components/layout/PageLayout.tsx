import React from 'react';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  header?: React.ReactNode;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  loading?: boolean;
}

export function PageLayout({
  children,
  className,
  containerClassName,
  header,
  title,
  description,
  actions,
  loading = false
}: PageLayoutProps) {
  // Custom header takes precedence over title/description
  const showDefaultHeader = !header && (title || description);

  if (loading) {
    return (
      <div className={cn("container mx-auto px-6 py-4 space-y-6", containerClassName)}>
        {showDefaultHeader && (
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        )}
        {header}
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div className={cn("container mx-auto px-6 py-4 space-y-6", containerClassName, className)}>
      {showDefaultHeader && (
        <div className={cn(
          "flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4",
          actions ? "" : "mb-6"
        )}>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            {description && (
              <p className="text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      {header}
      {children}
    </div>
  );
}

// Simpler version for pages that don't need the header section
export function SimplePageLayout({
  children,
  className,
  containerClassName
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  return (
    <div className={cn("container mx-auto px-6 py-4", containerClassName, className)}>
      {children}
    </div>
  );
}

/*
## Standard React Layout Patterns:

### 1. Manual Layout Components (What we built)
✅ Simple, explicit, easy to understand
✅ Full control over each page
❌ Developers must remember to use it consistently
❌ Easy to accidentally create inconsistencies

### 2. React Router Nested Layouts (MOST STANDARD)
✅ Automatic consistency across all pages
✅ Built into the routing system
✅ Industry standard for React applications
✅ Used by: Shopify, Airbnb, GitHub, Stripe, etc.

### 3. Higher-Order Components (HOCs)
✅ Automatic application to all pages
❌ Can be complex and hard to debug
❌ Less flexible for different page types

### 4. Context Provider + Custom Hook
✅ Centralized layout state management
✅ Flexible and powerful
❌ Overkill for simple applications

### 5. Next.js App Router (if using Next.js)
✅ Built-in layout system
✅ Automatic consistency
✅ File-based routing with layouts
✅ Most modern approach

## For SuperBro CRM, I recommend:

### Option 1: React Router Nested Layouts (Best for your app)
This would ensure 100% consistency automatically and is the industry standard.

### Option 2: Keep Manual Layout Components (Good for now)
Simple and works well for smaller teams where you control all page creation.

### Option 3: Gradual Migration
Start with manual components, then migrate to router-based layouts later.
*/
