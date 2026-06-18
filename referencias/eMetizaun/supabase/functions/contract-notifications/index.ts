import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting contract notifications check...");

    // Calculate date 2 months from now
    const twoMonthsFromNow = new Date();
    twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);
    const notificationDate = twoMonthsFromNow.toISOString().split('T')[0];

    console.log(`Checking for contracts ending or renewing by: ${notificationDate}`);

    // Get contracts that are ending or renewing in 2 months
    const { data: contractsEndingSoon, error: endError } = await supabase
      .from('partner_contracts')
      .select(`
        id,
        title,
        end_date,
        renewal_date,
        user_id,
        organization_id,
        partner_id,
        partners!inner(name)
      `)
      .or(`end_date.eq.${notificationDate},renewal_date.eq.${notificationDate}`)
      .eq('status', 'active');

    if (endError) {
      console.error("Error fetching contracts:", endError);
      throw endError;
    }

    console.log(`Found ${contractsEndingSoon?.length || 0} contracts requiring notifications`);

    if (!contractsEndingSoon || contractsEndingSoon.length === 0) {
      return new Response(
        JSON.stringify({ message: "No contracts requiring notifications" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Create notifications for each contract
    const notifications = [];
    
    for (const contract of contractsEndingSoon) {
      const partner = contract.partners as any;
      const partnerName = partner?.name || 'Unknown Partner';

      // Check if this is an end date or renewal date notification
      const isEndDate = contract.end_date === notificationDate;
      const isRenewalDate = contract.renewal_date === notificationDate;

      if (isEndDate) {
        notifications.push({
          user_id: contract.user_id,
          organization_id: contract.organization_id,
          title: "Contract Expiring Soon",
          message: `Contract "${contract.title}" with ${partnerName} expires in 2 months (${contract.end_date}).`,
          type: "contract_expiring",
          severity: "warning",
          action_url: "/partners",
          metadata: {
            contract_id: contract.id,
            contract_title: contract.title,
            partner_name: partnerName,
            partner_id: contract.partner_id,
            end_date: contract.end_date,
            notification_type: "expiring"
          }
        });
      }

      if (isRenewalDate) {
        notifications.push({
          user_id: contract.user_id,
          organization_id: contract.organization_id,
          title: "Contract Renewal Due Soon",
          message: `Contract "${contract.title}" with ${partnerName} is due for renewal in 2 months (${contract.renewal_date}).`,
          type: "contract_renewal_due",
          severity: "info",
          action_url: "/partners",
          metadata: {
            contract_id: contract.id,
            contract_title: contract.title,
            partner_name: partnerName,
            partner_id: contract.partner_id,
            renewal_date: contract.renewal_date,
            notification_type: "renewal"
          }
        });
      }
    }

    console.log(`Creating ${notifications.length} notifications`);

    // Insert all notifications
    if (notifications.length > 0) {
      const { data: insertedNotifications, error: insertError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (insertError) {
        console.error("Error inserting notifications:", insertError);
        throw insertError;
      }

      console.log(`Successfully created ${notifications.length} notifications`);
    }

    // Also notify organization admins and owners about all contracts
    const { data: adminNotifications, error: adminError } = await supabase
      .from('user_roles')
      .select('user_id, organization_id')
      .in('role', ['admin', 'owner'])
      .in('organization_id', [...new Set(contractsEndingSoon.map(c => c.organization_id))]);

    if (adminError) {
      console.error("Error fetching admin users:", adminError);
    } else if (adminNotifications && adminNotifications.length > 0) {
      const adminNotificationInserts = [];
      
      for (const admin of adminNotifications) {
        const orgContracts = contractsEndingSoon.filter(c => c.organization_id === admin.organization_id);
        const expiring = orgContracts.filter(c => c.end_date === notificationDate);
        const renewing = orgContracts.filter(c => c.renewal_date === notificationDate);
        
        if (expiring.length > 0) {
          adminNotificationInserts.push({
            user_id: admin.user_id,
            organization_id: admin.organization_id,
            title: "Team Contracts Expiring Soon",
            message: `${expiring.length} contract(s) in your organization are expiring in 2 months.`,
            type: "admin_contracts_expiring",
            severity: "warning",
            action_url: "/partners",
            metadata: {
              expiring_count: expiring.length,
              contracts: expiring.map(c => ({
                id: c.id,
                title: c.title,
                partner_name: (c.partners as any)?.name
              }))
            }
          });
        }

        if (renewing.length > 0) {
          adminNotificationInserts.push({
            user_id: admin.user_id,
            organization_id: admin.organization_id,
            title: "Team Contract Renewals Due Soon",
            message: `${renewing.length} contract(s) in your organization are due for renewal in 2 months.`,
            type: "admin_contracts_renewal",
            severity: "info",
            action_url: "/partners",
            metadata: {
              renewal_count: renewing.length,
              contracts: renewing.map(c => ({
                id: c.id,
                title: c.title,
                partner_name: (c.partners as any)?.name
              }))
            }
          });
        }
      }

      if (adminNotificationInserts.length > 0) {
        const { error: adminInsertError } = await supabase
          .from('notifications')
          .insert(adminNotificationInserts);

        if (adminInsertError) {
          console.error("Error inserting admin notifications:", adminInsertError);
        } else {
          console.log(`Created ${adminNotificationInserts.length} admin notifications`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        message: "Contract notifications processed successfully",
        contracts_checked: contractsEndingSoon.length,
        notifications_created: notifications.length
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );

  } catch (error: any) {
    console.error("Error in contract-notifications function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);