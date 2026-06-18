import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, Target, TrendingUp } from "lucide-react";
import { useDashboard } from "@/hooks/useDashboard";
import { MobileHeader } from "@/components/ui/mobile-header";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";
import { useAuth } from "@/hooks/useAuth";

const iconMap = {
  Users,
  Building2,
  Target,
  TrendingUp
};

export default function Dashboard() {
  const { stats, recentActivities, loading } = useDashboard();
  const { currentOrganization, organizations, loading: orgLoading } = useOrganizationContext();
  const { user } = useAuth();

  if (loading || orgLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Loading your CRM data...
          </p>
        </div>
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">No Organization Access</h1>
          <p className="text-muted-foreground">
            You don't have access to any organizations. Please contact your administrator.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <MobileHeader
        title="Dashboard"
        subtitle="Welcome back! Here's what's happening with your CRM today."
      />

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
         {stats.map((stat) => {
           const IconComponent = iconMap[stat.icon as keyof typeof iconMap];
           return (
           <Card key={stat.title}>
             <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">
                 {stat.title}
               </CardTitle>
               <IconComponent className={`h-4 w-4 ${stat.color}`} />
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">{stat.value}</div>
               <p className="text-xs text-muted-foreground">
                 {stat.description}
               </p>
             </CardContent>
           </Card>
           );
         })}
      </div>

      {/* Recent Activities */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activities</CardTitle>
          <CardDescription>
            Latest updates from your CRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div key={activity.id} className="flex items-center space-x-4">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">{activity.type}</p>
                  <p className="text-sm text-muted-foreground">
                    {activity.description}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {activity.time}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}