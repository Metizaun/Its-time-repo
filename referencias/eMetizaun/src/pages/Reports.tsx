import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, DollarSign, Target, Calendar, CheckSquare } from "lucide-react";
import { useReports } from "@/hooks/useReports";

export default function Reports() {
  const { metrics, pipelineStats, activitySummary, loading } = useReports();

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-muted-foreground">
            Loading your analytics data...
          </p>
        </div>
      </div>
    );
  }

  const salesMetrics = [
    {
      title: "Monthly Revenue",
      value: `$${(metrics?.monthlyRevenue || 0).toLocaleString()}`,
      change: "+0%", // Could calculate based on previous month
      icon: DollarSign,
      color: "text-green-600"
    },
    {
      title: "Deals Closed",
      value: metrics?.dealsClosedCount?.toString() || "0",
      change: "+0%",
      icon: Target,
      color: "text-blue-600"
    },
    {
      title: "New Contacts",
      value: metrics?.newContactsCount?.toString() || "0",
      change: "+0%",
      icon: Users,
      color: "text-purple-600"
    },
    {
      title: "Conversion Rate",
      value: `${(metrics?.conversionRate || 0).toFixed(1)}%`,
      change: "+0%",
      icon: TrendingUp,
      color: "text-orange-600"
    }
  ];

  // Get pipeline stages in order
  const pipelineStages = [
    { key: "Prospecting", label: "Prospecting" },
    { key: "Qualification", label: "Qualification" },
    { key: "Proposal", label: "Proposal" },
    { key: "Negotiation", label: "Negotiation" },
    { key: "Closed Won", label: "Closed Won" },
    { key: "Closed Lost", label: "Closed Lost" }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-muted-foreground">
          Track your sales performance and business metrics
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {salesMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <metric.icon className={`h-4 w-4 ${metric.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-muted-foreground">{metric.change}</span> from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Analysis</CardTitle>
          <CardDescription>Deal distribution across pipeline stages</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-6">
            {pipelineStages.map((stage) => {
              const stageData = pipelineStats?.[stage.key] || { count: 0, value: 0 };
              return (
                <div key={stage.key} className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{stageData.count}</div>
                  <div className="text-sm font-medium">{stage.label}</div>
                  <div className="text-xs text-muted-foreground">
                    ${(stageData.value / 1000).toFixed(0)}K
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activities Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Summary</CardTitle>
          <CardDescription>Key activities from the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center p-4 border rounded-lg">
              <CheckSquare className="h-6 w-6 mx-auto mb-2 text-blue-600" />
              <div className="text-2xl font-bold">{activitySummary?.tasksCreated || 0}</div>
              <div className="text-sm text-muted-foreground">Tasks Created</div>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <Users className="h-6 w-6 mx-auto mb-2 text-green-600" />
              <div className="text-2xl font-bold">{activitySummary?.contactsAdded || 0}</div>
              <div className="text-sm text-muted-foreground">Contacts Added</div>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <Target className="h-6 w-6 mx-auto mb-2 text-purple-600" />
              <div className="text-2xl font-bold">{activitySummary?.dealsClosed || 0}</div>
              <div className="text-sm text-muted-foreground">Deals Closed</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}