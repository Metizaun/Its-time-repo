import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const enabled = process.env.INSTAGRAM_FOUNDATION_INTEGRATION === "true";
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

test(
  "RPC concorrente cria um unico lead sem telefone para o mesmo IGSID",
  { skip: !enabled },
  async () => {
    assert.ok(supabaseUrl, "SUPABASE_URL obrigatoria");
    assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY obrigatoria");

    const rootClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const crm = rootClient.schema("crm");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const instanceName = `instagram-concurrency-${suffix}`;
    const providerUserId = `igsid-${suffix}`;

    let accountId: number | null = null;
    let channelId: string | null = null;
    let leadId: string | null = null;

    try {
      const { data: account, error: accountError } = await crm
        .from("accounts")
        .insert({ name: `Instagram integration ${suffix}` })
        .select("id")
        .single();
      assert.ifError(accountError);
      accountId = account.id;

      const { error: instanceError } = await crm.from("instance").insert({
        instancia: instanceName,
        aces_id: accountId,
      });
      assert.ifError(instanceError);

      const { data: channel, error: channelError } = await crm
        .from("instance_channels")
        .insert({
          aces_id: accountId,
          instance_name: instanceName,
          channel_type: "instagram",
          provider: "instagram",
          capability: "manual_only",
          status: "active",
        })
        .select("id")
        .single();
      assert.ifError(channelError);
      channelId = channel.id;

      const callers = Array.from({ length: 12 }, () =>
        createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        }).schema("crm")
      );
      const results = await Promise.all(
        callers.map((client) =>
          client.rpc("rpc_find_or_create_channel_lead", {
            p_channel_id: channelId,
            p_provider_user_id: providerUserId,
            p_name: "Lead Instagram concorrente",
          })
        )
      );

      for (const result of results) assert.ifError(result.error);
      const leadIds = new Set(results.map((result) => result.data.lead_id as string));
      assert.equal(leadIds.size, 1);
      leadId = [...leadIds][0];

      const { count: identityCount, error: identityCountError } = await crm
        .from("lead_channel_identities")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", channelId)
        .eq("provider_user_id", providerUserId);
      assert.ifError(identityCountError);
      assert.equal(identityCount, 1);

      const { data: lead, error: leadError } = await crm
        .from("leads")
        .select("contact_phone")
        .eq("id", leadId)
        .single();
      assert.ifError(leadError);
      assert.equal(lead.contact_phone, null);
    } finally {
      if (channelId) {
        await crm.from("lead_channel_identities").delete().eq("channel_id", channelId);
      }
      if (leadId) await crm.from("leads").delete().eq("id", leadId);
      if (channelId) await crm.from("instance_channels").delete().eq("id", channelId);
      await crm.from("instance").delete().eq("instancia", instanceName);
      if (accountId) await crm.from("accounts").delete().eq("id", accountId);
    }
  }
);
