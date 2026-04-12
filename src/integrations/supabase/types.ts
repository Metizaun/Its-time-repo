export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      token_usage: {
        Row: {
          analysis_cost_brl: number | null
          Cliente: string | null
          created_at: string | null
          execution_id: string | null
          executions_with_tokens: number | null
          id: number
          image_edit_cost_brl: number | null
          input_cost_brl: number | null
          input_tokens: number | null
          model_node: string | null
          models_used: string | null
          output_cost_brl: number | null
          output_tokens: number | null
          timestamp: string | null
          Tipo: string | null
          total_cost_brl: number | null
          total_cost_image_brl: number | null
          total_tokens: number | null
          workflow_id: string | null
          workflow_name: string | null
        }
        Insert: {
          analysis_cost_brl?: number | null
          Cliente?: string | null
          created_at?: string | null
          execution_id?: string | null
          executions_with_tokens?: number | null
          id?: number
          image_edit_cost_brl?: number | null
          input_cost_brl?: number | null
          input_tokens?: number | null
          model_node?: string | null
          models_used?: string | null
          output_cost_brl?: number | null
          output_tokens?: number | null
          timestamp?: string | null
          Tipo?: string | null
          total_cost_brl?: number | null
          total_cost_image_brl?: number | null
          total_tokens?: number | null
          workflow_id?: string | null
          workflow_name?: string | null
        }
        Update: {
          analysis_cost_brl?: number | null
          Cliente?: string | null
          created_at?: string | null
          execution_id?: string | null
          executions_with_tokens?: number | null
          id?: number
          image_edit_cost_brl?: number | null
          input_cost_brl?: number | null
          input_tokens?: number | null
          model_node?: string | null
          models_used?: string | null
          output_cost_brl?: number | null
          output_tokens?: number | null
          timestamp?: string | null
          Tipo?: string | null
          total_cost_brl?: number | null
          total_cost_image_brl?: number | null
          total_tokens?: number | null
          workflow_id?: string | null
          workflow_name?: string | null
        }
        Relationships: []
      }
      Vendas: {
        Row: {
          Acesso: string | null
          CANCELADO: boolean | null
          criado_em: string | null
          "DT. ORÇAMENTO": string | null
          "DT. VENDA": string | null
          Envelope: number | null
          "Forma de Pagamento": string | null
          id: number
          "Indicativo de Brinde": boolean | null
          "Ja Recebido": number | null
          "MULTI CREDITO": boolean | null
          "Nº Pedido Terceiro": number | null
          "Nota Fiscal": string | null
          Número: number | null
          Observação: string | null
          ORIGEM: string | null
          PACIENTE: string | null
          "Pagador(a) - Apelido": string | null
          "Pagador(a) - Nome": string | null
          "Previsão Entrega": string | null
          "Produto ou Serviço": string | null
          "Status Entrega": string | null
          Tipo: string | null
          "Valor Brinde": number | null
          "VENDEDOR(A)": string | null
          "Vl. Consolidado Bruto": number | null
          "Vl. Consolidado Líquido": number | null
          "Vl. Liquido": number | null
        }
        Insert: {
          Acesso?: string | null
          CANCELADO?: boolean | null
          criado_em?: string | null
          "DT. ORÇAMENTO"?: string | null
          "DT. VENDA"?: string | null
          Envelope?: number | null
          "Forma de Pagamento"?: string | null
          id?: number
          "Indicativo de Brinde"?: boolean | null
          "Ja Recebido"?: number | null
          "MULTI CREDITO"?: boolean | null
          "Nº Pedido Terceiro"?: number | null
          "Nota Fiscal"?: string | null
          Número?: number | null
          Observação?: string | null
          ORIGEM?: string | null
          PACIENTE?: string | null
          "Pagador(a) - Apelido"?: string | null
          "Pagador(a) - Nome"?: string | null
          "Previsão Entrega"?: string | null
          "Produto ou Serviço"?: string | null
          "Status Entrega"?: string | null
          Tipo?: string | null
          "Valor Brinde"?: number | null
          "VENDEDOR(A)"?: string | null
          "Vl. Consolidado Bruto"?: number | null
          "Vl. Consolidado Líquido"?: number | null
          "Vl. Liquido"?: number | null
        }
        Update: {
          Acesso?: string | null
          CANCELADO?: boolean | null
          criado_em?: string | null
          "DT. ORÇAMENTO"?: string | null
          "DT. VENDA"?: string | null
          Envelope?: number | null
          "Forma de Pagamento"?: string | null
          id?: number
          "Indicativo de Brinde"?: boolean | null
          "Ja Recebido"?: number | null
          "MULTI CREDITO"?: boolean | null
          "Nº Pedido Terceiro"?: number | null
          "Nota Fiscal"?: string | null
          Número?: number | null
          Observação?: string | null
          ORIGEM?: string | null
          PACIENTE?: string | null
          "Pagador(a) - Apelido"?: string | null
          "Pagador(a) - Nome"?: string | null
          "Previsão Entrega"?: string | null
          "Produto ou Serviço"?: string | null
          "Status Entrega"?: string | null
          Tipo?: string | null
          "Valor Brinde"?: number | null
          "VENDEDOR(A)"?: string | null
          "Vl. Consolidado Bruto"?: number | null
          "Vl. Consolidado Líquido"?: number | null
          "Vl. Liquido"?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      workflow_costs_summary: {
        Row: {
          avg_cost_per_execution: number | null
          first_execution: string | null
          last_execution: string | null
          total_cost_usd: number | null
          total_executions: number | null
          total_input_tokens: number | null
          total_output_tokens: number | null
          total_tokens: number | null
          workflow_id: string | null
          workflow_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
