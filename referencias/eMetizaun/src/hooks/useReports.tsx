import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationContext } from "./useOrganizationContext";

export function useReports() {
  const { currentOrganization } = useOrganizationContext();
  const queryClient = useQueryClient();

  const { data: reportsData, isLoading } = useQuery({
    queryKey: ["reports", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization found");

      // Get current month revenue from closed deals
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date();
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);
      endOfMonth.setHours(23, 59, 59, 999);

      // Fetch monthly revenue
      const { data: monthlyDeals } = await supabase
        .from("deals")
        .select("value")
        .eq("organization_id", currentOrganization.id)
        .eq("stage", "Closed Won")
        .gte("actual_close_date", startOfMonth.toISOString().split("T")[0])
        .lte("actual_close_date", endOfMonth.toISOString().split("T")[0]);

      const monthlyRevenue = monthlyDeals?.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0) || 0;

      // Fetch deals closed this month
      const { data: closedDeals } = await supabase
        .from("deals")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .eq("stage", "Closed Won")
        .gte("actual_close_date", startOfMonth.toISOString().split("T")[0]);

      const dealsClosedCount = closedDeals?.length || 0;

      // Fetch new contacts this month
      const { data: newContacts } = await supabase
        .from("contacts")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .gte("created_at", startOfMonth.toISOString());

      const newContactsCount = newContacts?.length || 0;

      // Fetch total contacts and total closed deals for conversion rate
      const { data: totalContacts } = await supabase
        .from("contacts")
        .select("id")
        .eq("organization_id", currentOrganization.id);

      const { data: totalClosedDeals } = await supabase
        .from("deals")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .eq("stage", "Closed Won");

      const conversionRate = totalContacts?.length 
        ? ((totalClosedDeals?.length || 0) / totalContacts.length * 100) 
        : 0;

      // Fetch pipeline data - group by stage, not status
      const { data: pipelineData } = await supabase
        .from("deals")
        .select("stage, value")
        .eq("organization_id", currentOrganization.id);

      const pipelineStats = pipelineData?.reduce((acc, deal) => {
        const stage = deal.stage || "Unknown";
        if (!acc[stage]) {
          acc[stage] = { count: 0, value: 0 };
        }
        acc[stage].count++;
        acc[stage].value += Number(deal.value) || 0;
        return acc;
      }, {} as Record<string, { count: number; value: number }>);

      // Fetch monthly trend data (last 6 months)
      const monthlyTrendData = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - i);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        monthEnd.setDate(0);
        monthEnd.setHours(23, 59, 59, 999);

        const { data: monthDeals } = await supabase
          .from("deals")
          .select("value")
          .eq("organization_id", currentOrganization.id)
          .eq("stage", "Closed Won")
          .gte("actual_close_date", monthStart.toISOString().split("T")[0])
          .lte("actual_close_date", monthEnd.toISOString().split("T")[0]);

        const revenue = monthDeals?.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0) || 0;
        const dealsCount = monthDeals?.length || 0;

        monthlyTrendData.push({
          month: monthStart.toLocaleDateString("en-US", { month: "short" }),
          revenue,
          deals: dealsCount
        });
      }

      // Fetch user performance data - get deals and then fetch user names separately
      const { data: userDeals } = await supabase
        .from("deals")
        .select("user_id, value")
        .eq("organization_id", currentOrganization.id)
        .eq("stage", "Closed Won");

      // Get unique user IDs
      const userIds = [...new Set(userDeals?.map(deal => deal.user_id) || [])];
      
      // Fetch user profiles
      const { data: userProfiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      const userPerformance = userDeals?.reduce((acc, deal) => {
        const userId = deal.user_id;
        const userProfile = userProfiles?.find(p => p.user_id === userId);
        const userName = userProfile?.display_name || "Unknown User";
        
        if (!acc[userId]) {
          acc[userId] = {
            name: userName,
            deals: 0,
            revenue: 0
          };
        }
        
        acc[userId].deals++;
        acc[userId].revenue += Number(deal.value) || 0;
        
        return acc;
      }, {} as Record<string, { name: string; deals: number; revenue: number }>);

      const topPerformers = Object.values(userPerformance || {})
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 4);

      // Fetch tasks count for activity summary
      const startOf30Days = new Date();
      startOf30Days.setDate(startOf30Days.getDate() - 30);

      const { data: tasksCount } = await supabase
        .from("tasks")
        .select("id")
        .eq("organization_id", currentOrganization.id)
        .gte("created_at", startOf30Days.toISOString());

      return {
        metrics: {
          monthlyRevenue,
          dealsClosedCount,
          newContactsCount,
          conversionRate
        },
        monthlyTrend: monthlyTrendData,
        topPerformers,
        pipelineStats: pipelineStats || {},
        activitySummary: {
          tasksCreated: tasksCount?.length || 0,
          contactsAdded: newContactsCount,
          dealsClosed: dealsClosedCount
        }
      };
    },
    enabled: !!currentOrganization?.id,
  });

  // Realtime invalidation: update reports when deals change
  useEffect(() => {
    if (!currentOrganization?.id) return;

    const channel = supabase
      .channel(`reports-deals-${currentOrganization.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "deals",
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        () => {
          // Invalidate cached reports so tiles refresh
          queryClient.invalidateQueries({ queryKey: ["reports", currentOrganization.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id, queryClient]);

  return {
    ...reportsData,
    loading: isLoading
  };
}