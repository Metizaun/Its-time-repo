import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ACES_ID = 5;

// Mapeamento confirmado em producao em 27/07/2026. O lead curto e o chat que
// recebeu a resposta do WhatsApp; o lead longo recebeu o disparo da cobranca.
const RECOVERIES = [
  ["7a02f3e6-b74d-447f-a66f-54aceca5ff71", "f7130f22-7097-4cc8-8523-4256f1359741"],
  ["c416adc7-17f7-4146-8337-995e9c8a2459", "f46fad09-f04f-49b3-898d-bd54710afbd6"],
  ["d8da85ad-a484-4647-a86a-bef9a17cadd6", "d5e179b6-e8bd-4866-9bac-762a29bc486f"],
  ["8e6e30b2-3990-4969-a8c1-64a201e1294a", "aeb6e399-8b22-4e55-866c-2406937ff63e"],
  ["6085e916-1afe-4ba8-85c6-d922e0921bf1", "fd8897a1-3a8f-47a8-8403-f438486dcaa6"],
  ["afb447de-f128-4dbb-be95-e93b4bfada5a", "c97be4fd-08ad-4c5b-84fc-7802628a013b"],
  ["afd6f78d-348e-4b6f-a181-145992bb516d", "dfab9207-81c9-4412-ac2a-56930cbbbb26"],
  ["fad784c0-65bb-4d7b-8480-cde7b9194ddc", "aa5aa5fa-483b-4dbb-bae9-4b60270be7e4"],
  ["ed839e54-9d92-4e7f-881c-9d957a3ed991", "f92159be-9cd7-4af8-96db-06ad9c732d50"],
  ["f77a6024-175b-454a-87d4-febdd3ed9fed", "f2d0a71a-a0de-44ac-98da-8c8f8e6e8783"],
  ["9a790c56-d322-456b-91f1-d7783f51c6f3", "c6db12ac-6544-456f-b2fd-464999ceb558"],
  ["7751165e-8984-4932-b5cd-1dcab11b34ac", "3381e390-2a52-4b52-9384-971d72797261"],
  ["ff2b456f-02df-4f4c-9674-422ad0e28a40", "d953caf8-86a1-4484-81b9-09a733ccb231"],
  ["69cfb9d9-349c-49a6-b421-6c58431f9afc", "4883baf3-4b6e-43e7-9e9c-61de4c8d91d2"],
  ["ca406ba2-6b3e-444f-aa43-fb78e41eab0f", "b2deb7a0-8339-4156-ae88-35e351855135"],
  ["c5b41afa-9989-4d44-aacf-305fcc50dd31", "7cfcc82f-2520-438f-b0b5-5907aeb32360"],
  ["2e3ef0fc-46dd-4bc5-be7a-76e1b9423edb", "cb29f3b5-8c31-4c77-8fc6-a3648973e7ca"],
  ["31e725cf-2336-496a-b06b-fd623e64d93b", "53506f52-c26e-4c55-8d0a-f62676d12abd"],
  ["7842b621-24e6-40df-8a58-b369e786e093", "dc552aa5-48bf-4e1f-bcc7-977f54da432f"],
  ["8da35da8-fe0e-420f-95cf-779404c65d57", "d468fad8-debb-4266-bf19-b9028f663c1d"],
  ["0d923856-ef0d-4c2f-9c55-1f6485e2fbf4", "ea2f3976-c447-411f-9f17-cb2bb8f0deb1"],
];

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function brazilPhoneIdentity(value) {
  let phone = digits(value);
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13)) {
    phone = phone.slice(2);
  }
  if (phone.length === 11 && phone[2] === "9") {
    phone = `${phone.slice(0, 2)}${phone.slice(3)}`;
  }
  return phone.length === 10 ? `br:${phone}` : null;
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios");
}

const crm = createClient(url, serviceRoleKey, {
  db: { schema: "crm" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const audit = [];

for (const [sourceLeadId, targetLeadId] of RECOVERIES) {
  const { data: leads, error: leadsError } = await crm
    .from("leads")
    .select("id, aces_id, name, contact_phone, instancia, view")
    .in("id", [sourceLeadId, targetLeadId]);
  if (leadsError) throw leadsError;
  if (leads?.length !== 2) throw new Error(`Par incompleto: ${sourceLeadId} -> ${targetLeadId}`);

  const source = leads.find((lead) => lead.id === sourceLeadId);
  const target = leads.find((lead) => lead.id === targetLeadId);
  const sourceIdentity = brazilPhoneIdentity(source?.contact_phone);
  const targetIdentity = brazilPhoneIdentity(target?.contact_phone);
  if (
    !source ||
    !target ||
    source.aces_id !== ACES_ID ||
    target.aces_id !== ACES_ID ||
    source.instancia !== target.instancia ||
    !sourceIdentity ||
    sourceIdentity !== targetIdentity ||
    digits(source.contact_phone).length !== 13 ||
    digits(target.contact_phone).length !== 10
  ) {
    throw new Error(`Guard de identidade falhou: ${sourceLeadId} -> ${targetLeadId}`);
  }

  const { data: messages, error: messagesError } = await crm
    .from("message_history")
    .select("id, lead_id, sent_at")
    .eq("aces_id", ACES_ID)
    .eq("lead_id", sourceLeadId)
    .order("sent_at");
  if (messagesError) throw messagesError;

  const messageIds = (messages ?? []).map((message) => message.id);
  const entry = {
    sourceLeadId,
    sourceName: source.name,
    targetLeadId,
    targetName: target.name,
    identity: sourceIdentity,
    messageIds,
    applied: false,
    archivedSource: source.view === false,
  };

  if (APPLY && messageIds.length > 0) {
    const { data: moved, error: moveError } = await crm
      .from("message_history")
      .update({ lead_id: targetLeadId })
      .eq("aces_id", ACES_ID)
      .eq("lead_id", sourceLeadId)
      .in("id", messageIds)
      .select("id");
    if (moveError) throw moveError;
    if (moved?.length !== messageIds.length) {
      throw new Error(`Movimento parcial em ${sourceLeadId}: ${moved?.length ?? 0}/${messageIds.length}`);
    }

    const { error: attachmentError } = await crm
      .from("message_attachments")
      .update({ lead_id: targetLeadId })
      .eq("aces_id", ACES_ID)
      .eq("lead_id", sourceLeadId)
      .in("message_id", messageIds);
    if (attachmentError) throw attachmentError;
  }

  const { data: sourceTags, error: sourceTagsError } = await crm
    .from("lead_tags")
    .select("tag_id, tag_name, created_at")
    .eq("lead_id", sourceLeadId);
  if (sourceTagsError) throw sourceTagsError;
  entry.sourceTagCount = sourceTags?.length ?? 0;

  if (APPLY && sourceTags?.length) {
    const { error: tagError } = await crm.from("lead_tags").upsert(
      sourceTags.map((tag) => ({
        lead_id: targetLeadId,
        tag_id: tag.tag_id,
        tag_name: tag.tag_name,
        created_at: tag.created_at,
      })),
      { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
    );
    if (tagError) throw tagError;
  }

  if (APPLY && source.view !== false) {
    const { data: archived, error: archiveError } = await crm
      .from("leads")
      .update({ view: false })
      .eq("id", sourceLeadId)
      .eq("aces_id", ACES_ID)
      .eq("view", true)
      .select("id, view");
    if (archiveError) throw archiveError;
    if (archived?.length !== 1 || archived[0].view !== false) {
      throw new Error(`Falha ao arquivar lead duplicado ${sourceLeadId}`);
    }
    entry.archivedSource = true;
  }

  entry.applied = APPLY;

  const { count: remaining, error: countError } = await crm
    .from("message_history")
    .select("id", { count: "exact", head: true })
    .eq("aces_id", ACES_ID)
    .eq("lead_id", sourceLeadId);
  if (countError) throw countError;
  entry.remainingSourceMessages = remaining;
  audit.push(entry);
}

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", recoveries: audit }, null, 2));
