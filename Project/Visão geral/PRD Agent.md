// ============================================================
// SDR Bento Agent — TypeScript
// Convertido fielmente do fluxo n8n: Sdr_bento_copy.json
//
// Fluxo original:
//  Webhook → If (fromMe) → freeze/Bloq
//                        → Var → Search_lead → Switch
//                                              ├─ Primeiro contato → Create row → Verifica variavel
//                                              └─ Continua       → Verifica variavel
//                                 → If1 → Última mensagem (atualiza last_message_at)
//  Verifica variavel (tipo de msg):
//    ├─ audioMessage  → Base → ConvertBase → Transcribe → Save_audio → var audio
//    ├─ conversation  → Save_text → var text
//    └─ imageMessage  → Imagem → Image edit → Analyze image → Save_text1 → var mensagem
//  Merge1 (3 inputs) → Recorder (Redis push) → Wait1(15s) → Recupera (Redis get)
//    → msg_checker → Delete (Redis) → All_messages → AI Agent
//    → Array → Split Out → Loop (send 1/s) → Enviar texto1 → msg_outbound
// ============================================================

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import Redis from 'ioredis'
import axios from 'axios'

// ─── Tipos ────────────────────────────────────────────────────

export interface AgentConfig {
  // Credenciais
  openaiApiKey: string
  supabaseUrl: string
  supabaseKey: string
  redisUrl: string
  evolutionApiUrl: string
  evolutionApiKey: string
  // Configurações editáveis pelo front
  instanceName: string        // ex: "{conectar com o app}"
  acesId: number              // ex: 1
  systemMessage: string       // prompt do sistema (editável)
  userMessageTemplate: string // template da mensagem do usuário (editável)
  bufferWaitMs: number        // ms do buffer (default: 15000)
  model: 'gpt-4.1-mini' | 'gpt-4o' | 'gpt-4o-mini' | string
}

export interface WebhookPayload {
  event: string
  instance: string
  data: {
    key: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    pushName: string
    message: {
      conversation?: string
      base64?: string
      imageMessage?: { base64?: string; caption?: string }
      audioMessage?: { base64?: string }
    }
    messageType: 'conversation' | 'audioMessage' | 'imageMessage' | string
    messageTimestamp: number
  }
}

interface MensagemBuffer {
  text: string
  id: string
  hour: string
  remoteid: string
}

// ─── Classe principal ─────────────────────────────────────────

export class SdrAgent {
  private gemini: Gemini
  private supabase: ReturnType<typeof createClient>
  private redis: Redis
  private config: AgentConfig

  constructor(config: AgentConfig) {
    this.config = config
    this.gemini = new gemini({ apiKey: config.geminiApiKey })
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey)
    this.redis = new Redis(config.redisUrl)
  }

  // ═══════════════════════════════════════════════════════════
  // ENTRY POINT — equivale ao nó Webhook
  // ═══════════════════════════════════════════════════════════
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    // ── If: fromMe → freeze (bloqueia, não processa) ──────────
    if (payload.data.key.fromMe === true) {
      await this.setFreeze(payload.data.key.remoteJid)
      return // Stop — equivale ao nó Stop
    }

    // ── Checar se está bloqueado (agente humano assumiu) ──────
    const isFrozen = await this.getFreeze(payload.data.key.remoteJid)
    if (isFrozen) return // Bloq — filtra e para

    // ── Var — extrai variáveis do payload ─────────────────────
    const vars = this.extractVars(payload)

    // ── Search_lead + If1 (atualiza last_message_at) ──────────
    const lead = await this.searchOrCreateLead(vars, payload)

    // ── Verifica variavel — roteamento por tipo de mensagem ───
    const mensagem = await this.processMessageType(payload, lead)
    if (!mensagem) return

    // ── Buffer: Recorder → Wait → Recupera → msg_checker ─────
    await this.bufferAndProcess(mensagem, lead, payload)
  }

  // ═══════════════════════════════════════════════════════════
  // FREEZE — Redis TTL 1h (nó freeze / Get_freeze / Bloq)
  // ═══════════════════════════════════════════════════════════
  private async setFreeze(remoteJid: string): Promise<void> {
    // freeze: SET key_bloqueado "true" EX 3600
    await this.redis.set(`${remoteJid}_bloqueado`, 'true', 'EX', 3600)
  }

  private async getFreeze(remoteJid: string): Promise<boolean> {
    // Get_freeze → Bloq (filtra se vazio)
    const val = await this.redis.get(`${remoteJid}_bloqueado`)
    return !!val
  }

  // ═══════════════════════════════════════════════════════════
  // VAR — extrai campos do webhook
  // ═══════════════════════════════════════════════════════════
  private extractVars(payload: WebhookPayload) {
    const remoteJid = payload.data.key.remoteJid
    return {
      Lead_whats: remoteJid.substring(0, remoteJid.indexOf('@')),
      instance_name: this.config.instanceName,
      Api_key_evo: this.config.evolutionApiKey,
      Redis: remoteJid,
      Lead_name: payload.data.pushName,
      Aces_id: this.config.acesId,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEARCH_LEAD → Switch → Create a row / Verifica variavel
  // ═══════════════════════════════════════════════════════════
  private async searchOrCreateLead(
    vars: ReturnType<typeof this.extractVars>,
    payload: WebhookPayload
  ) {
    // Search_lead: SELECT * FROM crm.leads WHERE contact_phone = ? AND aces_id = ?
    const { data: leads } = await this.supabase
      .schema('crm')
      .from('leads')
      .select('*')
      .eq('contact_phone', vars.Lead_whats)
      .eq('aces_id', vars.Aces_id)

    // If1: atualiza last_message_at independente de novo ou não
    await this.supabase
      .schema('crm')
      .from('leads')
      .update({ last_message_at: new Date().toISOString() })
      .eq('contact_phone', vars.Lead_whats)
      .eq('aces_id', vars.Aces_id)

    // Switch: isEmpty → Primeiro contato
    if (!leads || leads.length === 0) {
      // Create a row
      const fonte =
        (payload.data as any)?.contextInfo?.conversionSource ?? 'Whatsapp'
      const { data: newLead } = await this.supabase
        .schema('crm')
        .from('leads')
        .insert({
          name: payload.data.pushName,
          contact_phone: vars.Lead_whats,
          aces_id: vars.Aces_id,
          Fonte: fonte,
          instancia: this.config.instanceName,
        })
        .select()
        .single()
      return newLead
    }

    return leads[0]
  }

  // ═══════════════════════════════════════════════════════════
  // VERIFICA VARIAVEL — roteamento por messageType
  // ═══════════════════════════════════════════════════════════
  private async processMessageType(
    payload: WebhookPayload,
    lead: any
  ): Promise<MensagemBuffer | null> {
    const messageType = payload.data.messageType
    const remoteJid = payload.data.key.remoteJid
    const hour = new Date(payload.data.messageTimestamp * 1000).toISOString()
    const msgId = payload.data.key.id

    // ── audioMessage → Base → ConvertBase → Transcribe → Save_audio ─
    if (messageType === 'audioMessage') {
      const base64 = payload.data.message.base64 ?? ''
      const transcribed = await this.transcribeAudio(base64)

      // Save_audio1: salva em message_history
      await this.saveMessageHistory({
        lead_id: lead?.id,
        conversation_id: remoteJid,
        content: `${transcribed} \n- audio`,
        direction: 'inbound',
        sent_at: hour,
      })

      // var audio1 → Merge (input 0)
      return { text: transcribed, id: msgId, hour, remoteid: remoteJid }
    }

    // ── conversation → Save_text → var text ───────────────────
    if (messageType === 'conversation') {
      const text = payload.data.message.conversation ?? ''

      // Save_text: salva em message_history
      await this.saveMessageHistory({
        lead_id: lead?.id,
        conversation_id: msgId,
        content: text,
        direction: 'inbound',
        sent_at: hour,
      })

      // var text → Merge (input 1)
      return { text, id: msgId, hour, remoteid: remoteJid }
    }

    // ── imageMessage → Imagem → Image edit → Analyze image → Save_text1 ─
    if (messageType === 'imageMessage') {
      const base64 = payload.data.message.base64 ?? ''
      const analyzed = await this.analyzeImage(base64)
      const content = `[imagem]\n${analyzed}\n`

      // Save_text1
      await this.saveMessageHistory({
        lead_id: lead?.id,
        conversation_id: remoteJid,
        content,
        direction: 'inbound',
        sent_at: hour,
      })

      // var mensagem → Merge (input 2)
      return { text: content, id: msgId, hour, remoteid: remoteJid }
    }

    return null
  }

  // ═══════════════════════════════════════════════════════════
  // BUFFER — Recorder → Wait1(15s) → Recupera → msg_checker
  //          → Delete → All_messages → AI Agent
  // ═══════════════════════════════════════════════════════════
  private async bufferAndProcess(
    mensagem: MensagemBuffer,
    lead: any,
    payload: WebhookPayload
  ): Promise<void> {
    // Recorder: RPUSH remoteid JSON(mensagem)
    await this.redis.rpush(
      mensagem.remoteid,
      JSON.stringify({ text: mensagem.text })
    )

    // Wait1: aguarda 15s para acumular mensagens rápidas (buffer)
    await this.sleep(this.config.bufferWaitMs ?? 15000)

    // Recupera: LRANGE remoteid 0 -1
    const rawMessages = await this.redis.lrange(mensagem.remoteid, 0, -1)

    // msg_checker: só continua se array não vazio
    if (!rawMessages || rawMessages.length === 0) return

    // Delete: DEL remoteid (limpa o buffer)
    await this.redis.del(mensagem.remoteid)

    // All_messages: junta todas as mensagens do buffer
    const allMsg = rawMessages
      .map((item) => {
        try { return JSON.parse(item).text } catch { return item }
      })
      .join('\n')

    // AI Agent
    const aiResponse = await this.runAIAgent(allMsg, lead, payload)
    if (!aiResponse) return

    // Array: split por \n\n (parágrafos viram mensagens separadas)
    const paragraphs = aiResponse.split('\n\n').filter((p) => p.trim())

    // Loop Over Items: envia um por um com delay de 1s
    await this.sendMessages(paragraphs, lead, payload)
  }

  // ═══════════════════════════════════════════════════════════
  // AI AGENT — Gemini 2.5 Pro (primário) / GPT-4.1-mini (fallback)
  // com memória PostgreSQL via langchain (aqui: histórico manual)
  // ═══════════════════════════════════════════════════════════
  private async runAIAgent(
    allMessages: string,
    lead: any,
    payload: WebhookPayload
  ): Promise<string | null> {
    // Busca histórico de memória (equivale ao nó ChatMemory)
    const history = await this.getChatHistory(payload.data.key.remoteJid)

    // Monta a userMessage com o template editável
    const userMessage = this.config.userMessageTemplate
      .replace('{allMessages}', allMessages)
      .replace('{leadName}', payload.data.pushName ?? '')
      .replace('{leadPhone}', payload.data.key.remoteJid.split('@')[0] ?? '')
      .replace('{leadVoucher}', lead?.Voucher ?? '')
      .replace('{leadReceita}', lead?.receita ?? '')

    try {
      // Tentativa principal: OpenAI (GPT-4.1-mini ou modelo configurado)
      const completion = await this.openai.chat.completions.create({
        model: this.config.model ?? 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: this.config.systemMessage },
          ...history,
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1500,
      })
      return completion.choices[0]?.message?.content ?? null
    } catch (err) {
      console.error('[AI Agent] OpenAI falhou, tentando fallback Gemini:', err)
      return await this.runGeminiFallback(userMessage, history)
    }
  }

  // Fallback Gemini (nó Gen — gemini-2.5-pro)
  private async runGeminiFallback(
    userMessage: string,
    history: Array<{ role: string; content: string }>
  ): Promise<string | null> {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' })

      const historyText = history
        .map((h) => `${h.role}: ${h.content}`)
        .join('\n')
      const prompt = `${this.config.systemMessage}\n\n${historyText}\nuser: ${userMessage}`

      const result = await model.generateContent(prompt)
      return result.response.text() ?? null
    } catch (err) {
      console.error('[AI Agent] Gemini fallback também falhou:', err)
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEND MESSAGES — Loop Over Items → Wait(1s) → Enviar texto1
  //                 → msg_outbound (Supabase)
  // ═══════════════════════════════════════════════════════════
  private async sendMessages(
    paragraphs: string[],
    lead: any,
    payload: WebhookPayload
  ): Promise<void> {
    const vars = this.extractVars(payload)

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue

      // Wait: 1s entre mensagens (humaniza o envio)
      await this.sleep(1000)

      // Enviar texto1: Evolution API
      await this.sendViaEvolution(vars.Lead_whats, paragraph)

      // msg_outbound: salva saída em message_history
      await this.saveMessageHistory({
        conversation_id: payload.data.key.remoteJid,
        content: paragraph,
        direction: 'outbound',
        lead_id: lead?.id,
        sent_at: new Date().toISOString(),
      })
    }

    // HTTP Request3: token tracking (Bento_tokens webhook)
    await this.trackTokens()
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private async transcribeAudio(base64: string): Promise<string> {
    // Convert Base → Transcribe a recording1 (Whisper)
    const buffer = Buffer.from(base64, 'base64')
    const blob = new Blob([buffer], { type: 'audio/ogg' })
    const file = new File([blob], 'audio.ogg', { type: 'audio/ogg' })

    const transcription = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    })
    return transcription.text
  }

  private async analyzeImage(base64: string): Promise<string> {
    // Image edit → Analyze image (GPT-4o vision)
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
            {
              type: 'text',
              text: 'Descreva esta imagem detalhadamente para ser usada em uma conversa de atendimento.',
            },
          ],
        },
      ],
      max_tokens: 500,
    })
    return response.choices[0]?.message?.content ?? '[imagem recebida]'
  }

  private async sendViaEvolution(phone: string, text: string): Promise<void> {
    // Enviar texto1 — Evolution API
    await axios.post(
      `${this.config.evolutionApiUrl}/message/sendText/${this.config.instanceName}`,
      {
        number: `${phone}@s.whatsapp.net`,
        text,
        delay: 1000,
      },
      { headers: { apikey: this.config.evolutionApiKey } }
    )
  }

  private async saveMessageHistory(data: {
    lead_id?: string
    conversation_id: string
    content: string
    direction: 'inbound' | 'outbound'
    sent_at?: string
  }): Promise<void> {
    await this.supabase.schema('crm').from('message_history').insert({
      lead_id: data.lead_id,
      conversation_id: data.conversation_id,
      content: data.content,
      direction: data.direction,
      sent_at: data.sent_at ?? new Date().toISOString(),
      instance: this.config.instanceName,
      aces_id: this.config.acesId,
    })
  }

  private async getChatHistory(
    remoteJid: string
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    // ChatMemory: equivale ao PostgresChatMemory do n8n (tabela sdr_bento)
    const { data } = await this.supabase
      .schema('crm')
      .from('message_history')
      .select('content, direction')
      .eq('conversation_id', remoteJid)
      .order('sent_at', { ascending: true })
      .limit(20)

    if (!data) return []
    return data.map((row) => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: row.content,
    }))
  }


  // Expõe para o frontend poder atualizar configs em runtime
  updateConfig(partial: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  getConfig(): Readonly<AgentConfig> {
    return { ...this.config }
  }
}

// ─── Valores padrão (colados do fluxo original) ───────────────

export const DEFAULT_SYSTEM_MESSAGE = `🎯 Regras Invioláveis do Consultor Virtual
Formato da Mensagem (OBRIGATÓRIO):
- Toda mensagem deve ter no máximo 120 caracteres.
- Use blocos curtos; adicione uma quebra de linha VERDADEIRA entre cada parágrafo, ≤ 120 caracteres cada.
- Construa mensagens objetivas, com textos curtos e impactantes.
- Para uma melhor experiência do usuário no canal de Whatsapp, mantenha suas mensagens objetivas e diretas.
- Estruture a mensagem em blocos curtos e separados, simulando falas naturais. Evite monólogos em um único balão.
- Em toda vez que for falar sobre preço e valores, passe o valor 'a partir de R$'.

Uso do Nome do Lead:
Não chame o lead pelo nome em todas as mensagens. Use com moderação para criar impacto. Consulte o histórico para evitar repetições.

🧭 Diretriz Principal
Você é Bento, o consultor virtual especialista do Arquem.

Personalidade:
Bento é um consultor de ótica entusiasmado, apaixonado pelo que faz e naturalmente envolvente. Sua missão é despertar no cliente a curiosidade e o desejo genuíno de viver a experiência da Arquem.

Tom de voz:
Inspirador, visual e sensorial — transmite emoção sem exageros, fazendo o cliente imaginar, sentir e se encantar.

[REGRAS COMPLETAS DO SISTEMA — Cole aqui o system message completo]`

export const DEFAULT_USER_MESSAGE_TEMPLATE = `Contexto do lead:
- Nome: {leadName}
- Voucher: {leadVoucher}
- Receita: {leadReceita}

Mensagens recebidas:
{allMessages}`

export const DEFAULT_CONFIG: Partial<AgentConfig> = {
  instanceName: 'bento',
  acesId: 1,
  model: 'gpt-4.1-mini',
  bufferWaitMs: 15000,
  systemMessage: DEFAULT_SYSTEM_MESSAGE,
  userMessageTemplate: DEFAULT_USER_MESSAGE_TEMPLATE,
}