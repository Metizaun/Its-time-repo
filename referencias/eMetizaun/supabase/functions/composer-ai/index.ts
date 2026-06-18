import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message, contentType, context, crmData, sourceImageUrl } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Get user info from authorization header
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Construct context-aware user message
    let contextualMessage = message;
    if (context) {
      contextualMessage += `\n\nContext: ${context}`;
    }
    if (crmData) {
      contextualMessage += `\n\nCRM Data: ${JSON.stringify(crmData)}`;
    }

    if (contentType === 'instagram') {
      if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured");
      }
      if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
      }

      const parts: Array<Record<string, unknown>> = [{ text: contextualMessage }];

      if (sourceImageUrl) {
        const imageResponse = await fetch(sourceImageUrl);
        if (!imageResponse.ok) {
          throw new Error("Failed to fetch source image");
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const mimeType = imageResponse.headers.get('content-type') || 'image/png';
        const base64Image = base64Encode(new Uint8Array(imageBuffer));
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64Image
          }
        });
      }

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
        {
          method: "POST",
          headers: {
            "x-goog-api-key": GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["Image"]
            }
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API error:", response.status, errorText);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      type InlineData = { data?: string; mimeType?: string; mime_type?: string };
      type ImagePart = { inlineData?: InlineData; inline_data?: InlineData };

      const responseParts: ImagePart[] = data.candidates?.[0]?.content?.parts || [];
      const imagePart = responseParts.find((part) => part.inlineData || part.inline_data);
      const inlineData = imagePart?.inlineData || imagePart?.inline_data;
      const imageBase64 = inlineData?.data;
      const outputMimeType = inlineData?.mimeType || inlineData?.mime_type || 'image/png';

      if (!imageBase64) {
        throw new Error("No image generated");
      }

      const imageBytes = base64Decode(imageBase64);

      const extension = outputMimeType.includes('jpeg')
        ? 'jpg'
        : outputMimeType.includes('webp')
          ? 'webp'
          : 'png';

      const storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const filePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await storageClient.storage
        .from('composer-images')
        .upload(filePath, imageBytes, {
          contentType: outputMimeType,
          upsert: true
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: publicUrlData } = storageClient.storage
        .from('composer-images')
        .getPublicUrl(filePath);

      return new Response(JSON.stringify({
        media_url: publicUrlData.publicUrl,
        contentType,
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Create content type specific system prompts
    const systemPrompts: Record<string, string> = {
      email: `You are an expert email marketing composer. Generate effective email sequences with HTML markup for formatting. Your output should:
        - Have compelling subject lines
        - Use personalization effectively
        - Follow email marketing best practices
        - Include clear value propositions
        - Have strong call-to-actions
        - Be mobile-friendly and scannable
        - Use HTML tags like <p>, <strong>, <em>, <br>, <ul>, <li>, <h3> for structure
        - Format subject lines with <strong> tags
        - Use bullet points <ul><li> for key benefits
        - Include proper paragraph breaks with <p> tags`,
      
      sms: `You are an expert SMS marketing composer. Generate concise, effective text messages with minimal HTML markup for formatting. Your output should:
        - Respect character limits (160-320 chars)
        - Be direct and action-oriented
        - Include clear value propositions
        - Use personalization appropriately
        - Follow SMS compliance best practices
        - Have clear call-to-actions
        - Use minimal HTML like <strong> for emphasis and <br> for line breaks only
        - Keep formatting simple due to character constraints`,
      
      custom: `You are an expert content composer. Generate high-quality content with HTML markup for formatting based on the specific requirements and context provided. Use appropriate HTML tags like <p>, <strong>, <em>, <br>, <ul>, <li>, <h3>, <h4> to structure and format the content for better readability and visual appeal.`
    };

    const systemPrompt = systemPrompts[contentType] || systemPrompts.custom;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextualMessage }
        ],
        temperature: 0.7,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const generatedContent = data.choices?.[0]?.message?.content;

    if (!generatedContent) {
      throw new Error("No content generated");
    }

    return new Response(JSON.stringify({ 
      content: generatedContent,
      contentType,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Composer AI Error:', error);
    return new Response(JSON.stringify({ 
      error: (error as Error).message || "Failed to generate content" 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
