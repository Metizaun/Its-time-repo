import { Card } from "@/components/ui/card";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { RevenueByVendor } from "@/lib/utils/metrics";

interface RevenueByVendorChartProps {
  data: RevenueByVendor[];
  title: string;
}

const COLORS = [
  "hsl(190, 90%, 50%)",  // Cyan
  "hsla(241, 45%, 35%, 1.00)",   // Gold suave
  "hsl(142, 70%, 45%)",  // Verde sucesso 
  "hsl(262, 75%, 60%)",  // Roxo 
  "hsl(346, 75%, 62%)",  // Rosa neon
];

export function RevenueByVendorChart({ data, title }: RevenueByVendorChartProps) {
  const formattedData = data.map((item) => ({
    ...item,
    receitaFormatted: new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(item.receita),
  }));

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-4">{title}</h3>
      <div className="w-full overflow-x-auto">
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <RechartsBarChart
            data={formattedData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            layout="vertical"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

            <XAxis
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) =>
                new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  compactDisplay: "short",
                }).format(value)
              }
            />

            <YAxis
              type="category"
              dataKey="responsavel"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              width={90}
            />

            <Tooltip
  contentStyle={{
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
    color: "white",
  }}
  labelStyle={{
    color: "white",
    fontWeight: 600,
  }}
  formatter={(value: number, name) => [
    <span style={{ color: "white" }}>
      {new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(value)}
    </span>,
    <span style={{ color: "white" }}>{name}</span>
  ]}
  labelFormatter={(label) => `Vendedor: ${label}`}
  wrapperStyle={{ zIndex: 1000 }}
/>



            <Bar dataKey="receita" name="Receita" radius={[0, 8, 8, 0]}>
              {formattedData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                  style={{ transition: "all .2s ease" }}
                  className="hover:opacity-90 hover:brightness-125"
                />
              ))}
            </Bar>

          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
