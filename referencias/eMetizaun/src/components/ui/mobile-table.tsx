import { ReactNode } from 'react';
import { useBreakpoint } from '@/hooks/use-mobile';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface MobileTableProps {
  headers: string[];
  data: any[];
  renderRow: (item: any, isMobile: boolean) => ReactNode;
  renderMobileCard: (item: any) => ReactNode;
  emptyState?: ReactNode;
}

export function MobileTable({ 
  headers, 
  data, 
  renderRow, 
  renderMobileCard, 
  emptyState 
}: MobileTableProps) {
  const { isMobile } = useBreakpoint();

  if (data.length === 0) {
    return emptyState || (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {data.map((item, index) => (
          <Card key={item.id || index} className="p-4">
            <CardContent className="p-0">
              {renderMobileCard(item)}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header, index) => (
              <TableHead key={index}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item, index) => (
            <TableRow key={item.id || index}>
              {renderRow(item, false)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}