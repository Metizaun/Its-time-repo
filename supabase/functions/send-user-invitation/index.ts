// index.ts (debug-friendly)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const ALLOWED_ORIGINS = ["http://localhost:8080", Deno.env.get("SITE_URL") ?? ""].filter(Boolean);
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "*";

  const corsBase = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
  };
  const corsHeaders = allowOrigin === "*" 
    ? { ...corsBase, "Access-Control-Allow-Origin": "*" } 
    : { ...corsBase, "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Credentials": "true" };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    // Log headers for debugging
    console.log("REQ HEADERS:", Object.fromEntries(req.headers.entries()));

    // Try to parse JSON safely
    let body: any = null;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        body = await req.json();
      } catch (e) {
        console.error("JSON parse error:", e);
        return new Response(JSON.stringify({ success: false, error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
      }
    } else {
      // If content-type missing or different, read text for diagnosis
      const text = await req.text();
      console.warn("Non-JSON body:", text);
      return new Response(JSON.stringify({ success: false, error: "Content-Type must be application/json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    console.log("REQ BODY:", body);

    const { email, invitationId } = body ?? {};
    if (!email || !invitationId) {
      return new Response(JSON.stringify({ success: false, error: "Missing email or invitationId", received: { email, invitationId } }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Buscar convite
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .schema("crm")
      .from("user_invitations")
      .select("*")
      .eq("id", invitationId)
      .single();

    if (invitationError || !invitation) {
      console.error("Invitation not found:", invitationError);
      return new Response(JSON.stringify({ success: false, error: "Convite não encontrado", details: invitationError?.message ?? null }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // Checagem de email
    const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers();
    if (usersErr) {
      console.error("listUsers error:", usersErr);
      return new Response(JSON.stringify({ success: false, error: "Erro ao verificar usuários", details: usersErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    const emailExists = usersData?.users?.some((u) => u.email === email);
    if (emailExists) {
      return new Response(JSON.stringify({ success: false, error: "Email já cadastrado" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { name: invitation.name, role: invitation.role, aces_id: invitation.aces_id, invitation_id: invitationId },
      redirectTo: `${Deno.env.get("SITE_URL") ?? ""}/auth/callback`,
    });

    if (authError) {
      console.error("inviteUserByEmail error:", authError);
      return new Response(JSON.stringify({ success: false, error: "Erro ao enviar convite", details: authError.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    console.log("Invite OK:", { email, userId: authData.user?.id });
    return new Response(JSON.stringify({ success: true, userId: authData.user?.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }});

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }});
  }
});
