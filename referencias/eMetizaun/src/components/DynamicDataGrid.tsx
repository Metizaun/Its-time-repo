import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface DynamicDataGridProps {
  data: Array<Record<string, any>>;
}

const PAGE_SIZE = 10;

export function DynamicDataGrid({ data }: DynamicDataGridProps) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');

  const columns = useMemo(() => {
    if (!data.length) return [];
    return Object.keys(data[0]);
  }, [data]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return data;
    const lower = filter.toLowerCase();
    return data.filter((row) => {
      return columns.some((key) => {
        const value = row[key];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(lower);
      });
    });
  }, [columns, data, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!data.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          placeholder="Filtrar resultados..."
        />
        <div className="text-xs text-muted-foreground">
          {filtered.length} resultado{filtered.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{formatHeader(column)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((column) => (
                  <TableCell key={column}>
                    {formatCellValue(row[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1}
          >
            Anterior
          </Button>
          <div className="text-xs text-muted-foreground">
            Pagina {page} de {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page === totalPages}
          >
            Proxima
          </Button>
        </div>
      )}
    </div>
  );
}

function formatHeader(column: string) {
  return column
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCellValue(value: any) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';
  if (value instanceof Date) return value.toLocaleDateString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
