import { Card } from "@/components/ui/card";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { DailyData } from "@/lib/utils/metrics";

interface LineChartProps {
  data: DailyData[];
  title: string;
}

export function LineChart({ data, title }: LineChartProps) {
  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-4">{title}</h3>
      <div className="w-full overflow-x-auto">
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <RechartsLineChart 
            data={data}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

            {/* Eixo X */}
            <XAxis 
              dataKey="date" 
              stroke="hsl(var(--muted-foreground))" 
              fontSize={10}
              tick={{ fontSize: 10 }}
            />

            {/* Eixo Y de GANHOS (esquerda) */}
            <YAxis 
              yAxisId="left"
              stroke="hsl(var(--muted-foreground))" 
              fontSize={10}
              tick={{ fontSize: 10 }}
            />

            {/* Eixo Y de LEADS (direita) - tick escondido */}
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="hsl(var(--muted-foreground))"
              tick={false}
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

            {/* Linha de Leads (eixo direito) */}
            <Line
              type="monotone"
              dataKey="leads"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              name="Leads"
              yAxisId="right"
              dot={{ fill: "hsl(var(--primary))" }}
              activeDot={{ r: 5 }}
            />

            {/* Linha de Ganhos (eixo esquerdo) */}
            <Line
              type="monotone"
              dataKey="ganhos"
              stroke="hsl(var(--success))"
              strokeWidth={2}
              name="Ganhos (R$)"
              yAxisId="left"
              dot={{ fill: "hsl(var(--success))" }}
              activeDot={{ r: 5 }}
            />

          </RechartsLineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
