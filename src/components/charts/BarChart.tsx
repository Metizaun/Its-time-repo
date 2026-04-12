import { Card } from "@/components/ui/card";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { OriginData } from "@/lib/utils/metrics";

interface BarChartProps {
  data: OriginData[];
  title: string;
}

export function BarChart({ data, title }: BarChartProps) {
  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-4">{title}</h3>
      <div className="w-full overflow-x-auto">
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <RechartsBarChart 
            data={data}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

            <XAxis 
              dataKey="origem" 
              stroke="hsl(var(--muted-foreground))" 
              fontSize={10}
              tick={{ fontSize: 10 }}
            />

            {/* Y Ganhos */}
            <YAxis 
              yAxisId="left"
              stroke="hsl(var(--muted-foreground))" 
              fontSize={10}
              tick={{ fontSize: 10 }}
              domain={[0, (dataMax: number) => dataMax + 500]}
            />

            {/* Y Leads (escondido) */}
            <YAxis 
              yAxisId="right"
              orientation="right"
              tick={false}
              stroke="transparent"
              domain={[0, (dataMax: number) => dataMax + 1]}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              wrapperStyle={{ zIndex: 1000 }}
            />

            <Legend wrapperStyle={{ fontSize: "12px" }} />

            {/* Leads */}
            <Bar 
              dataKey="leads" 
              fill="hsl(var(--primary))" 
              name="Leads" 
              radius={[8, 8, 0, 0]}
              yAxisId="right"
            />

            {/* Ganhos */}
            <Bar
              dataKey="ganhos"
              fill="hsl(var(--success))"
              name="Ganhos (R$)"
              radius={[8, 8, 0, 0]}
              yAxisId="left"
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
