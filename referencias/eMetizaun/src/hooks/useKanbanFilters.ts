import { useState, useMemo } from 'react';

interface FilterConfig {
  search?: string;
  tags?: string[];
  dateRange?: { start: Date; end: Date };
  priority?: string[];
  assignee?: string[];
  [key: string]: any;
}

export function useKanbanFilters<T>(
  items: T[],
  searchFields: (keyof T)[],
  filterFields: Record<keyof FilterConfig, (item: T, value: any) => boolean>
) {
  const [filters, setFilters] = useState<FilterConfig>({});

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Search filter
      if (filters.search && filters.search.trim()) {
        const searchLower = filters.search.toLowerCase();
        const matchesSearch = searchFields.some(field => {
          const value = item[field];
          return value && String(value).toLowerCase().includes(searchLower);
        });
        if (!matchesSearch) return false;
      }

      // Custom filters
      for (const [filterKey, filterValue] of Object.entries(filters)) {
        if (filterKey === 'search' || !filterValue) continue;
        
        // Skip empty arrays
        if (Array.isArray(filterValue) && filterValue.length === 0) continue;
        
        // Skip null, undefined, or empty string values
        if (filterValue === null || filterValue === undefined || filterValue === '') continue;
        
        const filterFn = filterFields[filterKey as keyof FilterConfig];
        if (filterFn && !filterFn(item, filterValue)) {
          return false;
        }
      }

      return true;
    });
  }, [items, filters, searchFields, filterFields]);

  const updateFilter = <K extends keyof FilterConfig>(key: K, value: FilterConfig[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const clearFilter = (key: keyof FilterConfig) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const hasActiveFilters = useMemo(() => {
    return Object.entries(filters).some(([key, value]) => {
      if (key === 'search') return value && value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== '';
    });
  }, [filters]);

  return {
    filters,
    filteredItems,
    updateFilter,
    clearFilters,
    clearFilter,
    hasActiveFilters,
    filterCount: Object.keys(filters).filter(key => {
      const value = filters[key as keyof FilterConfig];
      if (key === 'search') return value && value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== '';
    }).length,
  };
}
