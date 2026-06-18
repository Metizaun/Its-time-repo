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
    PostgrestVersion: "14.1"
  }
  inbox: {
    Tables: {
      agents: {
        Row: {
          avatar_url: string | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          metadata: Json
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          created_at: string
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          muted: boolean
          organization_id: string
          role: Database["inbox"]["Enums"]["participant_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          muted?: boolean
          organization_id: string
          role?: Database["inbox"]["Enums"]["participant_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          muted?: boolean
          organization_id?: string
          role?: Database["inbox"]["Enums"]["participant_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          created_by_user_id: string | null
          tag_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by_user_id?: string | null
          tag_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by_user_id?: string | null
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_id: string | null
          archived_at: string | null
          assigned_to_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          external_conversation_id: string | null
          id: string
          last_message_at: string | null
          last_message_id: string | null
          last_message_preview: string | null
          metadata: Json
          organization_id: string
          status: Database["inbox"]["Enums"]["conversation_status"]
          title: string | null
          type: Database["inbox"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          archived_at?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          external_conversation_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          metadata?: Json
          organization_id: string
          status?: Database["inbox"]["Enums"]["conversation_status"]
          title?: string | null
          type?: Database["inbox"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          archived_at?: string | null
          assigned_to_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          external_conversation_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          metadata?: Json
          organization_id?: string
          status?: Database["inbox"]["Enums"]["conversation_status"]
          title?: string | null
          type?: Database["inbox"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_read: boolean
          mentioned_user_id: string
          message_id: string
          organization_id: string
          read_at: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          mentioned_user_id: string
          message_id: string
          organization_id: string
          read_at?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          mentioned_user_id?: string
          message_id?: string
          organization_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mentions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          bucket: string
          conversation_id: string
          created_at: string
          created_by_user_id: string | null
          file_name: string
          id: string
          message_id: string
          mime_type: string
          organization_id: string
          path: string
          size_bytes: number
        }
        Insert: {
          bucket?: string
          conversation_id: string
          created_at?: string
          created_by_user_id?: string | null
          file_name: string
          id?: string
          message_id: string
          mime_type: string
          organization_id: string
          path: string
          size_bytes: number
        }
        Update: {
          bucket?: string
          conversation_id?: string
          created_at?: string
          created_by_user_id?: string | null
          file_name?: string
          id?: string
          message_id?: string
          mime_type?: string
          organization_id?: string
          path?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          external_message_id: string | null
          format: Database["inbox"]["Enums"]["message_format"]
          id: string
          metadata: Json
          organization_id: string
          reply_to_message_id: string | null
          sender_agent_id: string | null
          sender_external_id: string | null
          sender_kind: Database["inbox"]["Enums"]["sender_kind"]
          sender_user_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          external_message_id?: string | null
          format?: Database["inbox"]["Enums"]["message_format"]
          id?: string
          metadata?: Json
          organization_id: string
          reply_to_message_id?: string | null
          sender_agent_id?: string | null
          sender_external_id?: string | null
          sender_kind: Database["inbox"]["Enums"]["sender_kind"]
          sender_user_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          external_message_id?: string | null
          format?: Database["inbox"]["Enums"]["message_format"]
          id?: string
          metadata?: Json
          organization_id?: string
          reply_to_message_id?: string | null
          sender_agent_id?: string | null
          sender_external_id?: string | null
          sender_kind?: Database["inbox"]["Enums"]["sender_kind"]
          sender_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_agent_id_fkey"
            columns: ["sender_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_events: {
        Row: {
          attempts: number
          conversation_id: string
          created_at: string
          error: string | null
          event_type: string
          external_event_id: string | null
          id: string
          last_attempt_at: string | null
          message_id: string
          next_attempt_at: string | null
          organization_id: string
          payload: Json
          sent_at: string | null
          status: Database["inbox"]["Enums"]["outbound_status"]
          target: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          conversation_id: string
          created_at?: string
          error?: string | null
          event_type: string
          external_event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          message_id: string
          next_attempt_at?: string | null
          organization_id: string
          payload?: Json
          sent_at?: string | null
          status?: Database["inbox"]["Enums"]["outbound_status"]
          target: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          conversation_id?: string
          created_at?: string
          error?: string | null
          event_type?: string
          external_event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          message_id?: string
          next_attempt_at?: string | null
          organization_id?: string
          payload?: Json
          sent_at?: string | null
          status?: Database["inbox"]["Enums"]["outbound_status"]
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      refresh_conversation_last_message: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      seed_default_tags_for_org: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
    }
    Enums: {
      conversation_status: "open" | "archived"
      conversation_type: "direct" | "group" | "channel" | "ai_agent"
      message_format: "text" | "markdown" | "system"
      outbound_status: "pending" | "processing" | "sent" | "failed"
      participant_role: "owner" | "member"
      sender_kind: "user" | "agent" | "system" | "external"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  research: {
    Tables: {
      project_ai_notes: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          input_context: Json
          organization_id: string
          output_text: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          input_context?: Json
          organization_id: string
          output_text: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          input_context?: Json
          organization_id?: string
          output_text?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_ai_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_ai_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          content_md: string
          created_at: string
          created_by_user_id: string
          doc_type: string
          id: string
          organization_id: string
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content_md?: string
          created_at?: string
          created_by_user_id: string
          doc_type: string
          id?: string
          organization_id: string
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          content_md?: string
          created_at?: string
          created_by_user_id?: string
          doc_type?: string
          id?: string
          organization_id?: string
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_saved_items: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          project_id: string
          scrape_item_id: string
          selected_by_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          project_id: string
          scrape_item_id: string
          selected_by_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          project_id?: string
          scrape_item_id?: string
          selected_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_saved_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_saved_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_saved_items_scrape_item_id_fkey"
            columns: ["scrape_item_id"]
            isOneToOne: false
            referencedRelation: "scrape_items"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          competitor_username: string
          created_at: string
          created_by_user_id: string
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          competitor_username: string
          created_at?: string
          created_by_user_id: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          competitor_username?: string
          created_at?: string
          created_by_user_id?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_items: {
        Row: {
          caption: string | null
          comments: Json | null
          comments_count: number | null
          created_at: string
          display_url: string | null
          id: string
          likes_count: number | null
          organization_id: string
          permalink: string
          platform_post_id: string | null
          posted_at: string | null
          profile_username: string
          raw_metrics: Json
          scrape_job_id: string
          thumbnail_url: string | null
          type: string
          video_url: string | null
          views_count: number | null
        }
        Insert: {
          caption?: string | null
          comments?: Json | null
          comments_count?: number | null
          created_at?: string
          display_url?: string | null
          id?: string
          likes_count?: number | null
          organization_id: string
          permalink: string
          platform_post_id?: string | null
          posted_at?: string | null
          profile_username: string
          raw_metrics?: Json
          scrape_job_id: string
          thumbnail_url?: string | null
          type: string
          video_url?: string | null
          views_count?: number | null
        }
        Update: {
          caption?: string | null
          comments?: Json | null
          comments_count?: number | null
          created_at?: string
          display_url?: string | null
          id?: string
          likes_count?: number | null
          organization_id?: string
          permalink?: string
          platform_post_id?: string | null
          posted_at?: string | null
          profile_username?: string
          raw_metrics?: Json
          scrape_job_id?: string
          thumbnail_url?: string | null
          type?: string
          video_url?: string | null
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_items_scrape_job_id_fkey"
            columns: ["scrape_job_id"]
            isOneToOne: false
            referencedRelation: "scrape_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_jobs: {
        Row: {
          apify_run_id: string
          created_at: string
          created_by_user_id: string
          error: string | null
          filters: Json
          id: string
          organization_id: string
          profile_username: string
          result_count: number
          status: string
          updated_at: string
        }
        Insert: {
          apify_run_id: string
          created_at?: string
          created_by_user_id: string
          error?: string | null
          filters?: Json
          id?: string
          organization_id: string
          profile_username: string
          result_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          apify_run_id?: string
          created_at?: string
          created_by_user_id?: string
          error?: string | null
          filters?: Json
          id?: string
          organization_id?: string
          profile_username?: string
          result_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_queue: {
        Row: {
          created_at: string
          error: string | null
          id: string
          metadata: Json
          organization_id: string
          payload_text: string
          processed_at: string | null
          project_id: string
          source_id: string
          source_type: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          payload_text: string
          processed_at?: string | null
          project_id: string
          source_id: string
          source_type: string
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          payload_text?: string
          processed_at?: string | null
          project_id?: string
          source_id?: string
          source_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vector_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
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
  public: {
    Tables: {
      calendar_events: {
        Row: {
          all_day: boolean
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by_user_id: string | null
          deal_id: string | null
          deleted_at: string | null
          description: string | null
          end_time: string
          external_event_id: string | null
          followup_1h_enabled: boolean
          followup_1h_error: string | null
          followup_1h_last_attempt_at: string | null
          followup_1h_sent_at: string | null
          followup_1h_status: string
          id: string
          lead_id: string | null
          location: string | null
          meeting_url: string | null
          metadata: Json
          organization_id: string
          owner_user_id: string | null
          source: string
          start_time: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          description?: string | null
          end_time: string
          external_event_id?: string | null
          followup_1h_enabled?: boolean
          followup_1h_error?: string | null
          followup_1h_last_attempt_at?: string | null
          followup_1h_sent_at?: string | null
          followup_1h_status?: string
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          metadata?: Json
          organization_id: string
          owner_user_id?: string | null
          source?: string
          start_time: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deal_id?: string | null
          deleted_at?: string | null
          description?: string | null
          end_time?: string
          external_event_id?: string | null
          followup_1h_enabled?: boolean
          followup_1h_error?: string | null
          followup_1h_last_attempt_at?: string | null
          followup_1h_sent_at?: string | null
          followup_1h_status?: string
          id?: string
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          metadata?: Json
          organization_id?: string
          owner_user_id?: string | null
          source?: string
          start_time?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          annual_revenue: number | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          employee_count: number | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          organization_id: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          annual_revenue?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          employee_count?: number | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          annual_revenue?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          employee_count?: number | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      composer_sequences: {
        Row: {
          content_type: string
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          steps: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          content_type: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          steps?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          content_type?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          steps?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "composer_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      composer_templates: {
        Row: {
          content: string
          content_type: string
          created_at: string
          id: string
          metadata: Json | null
          name: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          content_type: string
          created_at?: string
          id?: string
          metadata?: Json | null
          name: string
          organization_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          content_type?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          name?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "composer_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          anniversary: string | null
          birthday: string | null
          company: string | null
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          important_dates: Json | null
          last_name: string
          notes: string | null
          organization_id: string | null
          personal_notes: string | null
          phone: string | null
          position: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anniversary?: string | null
          birthday?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          important_dates?: Json | null
          last_name: string
          notes?: string | null
          organization_id?: string | null
          personal_notes?: string | null
          phone?: string | null
          position?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anniversary?: string | null
          birthday?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          important_dates?: Json | null
          last_name?: string
          notes?: string | null
          organization_id?: string | null
          personal_notes?: string | null
          phone?: string | null
          position?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      database_metadata_cache: {
        Row: {
          cached_at: string
          column_default: string | null
          column_name: string
          data_type: string
          id: string
          is_nullable: boolean
          schema_name: string
          table_name: string
        }
        Insert: {
          cached_at?: string
          column_default?: string | null
          column_name: string
          data_type: string
          id?: string
          is_nullable?: boolean
          schema_name: string
          table_name: string
        }
        Update: {
          cached_at?: string
          column_default?: string | null
          column_name?: string
          data_type?: string
          id?: string
          is_nullable?: boolean
          schema_name?: string
          table_name?: string
        }
        Relationships: []
      }
      deals: {
        Row: {
          actual_close_date: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          description: string | null
          expected_close_date: string | null
          id: string
          notes: string | null
          organization_id: string | null
          probability: number | null
          stage: string
          status: string
          title: string
          updated_at: string
          user_id: string
          value: number | null
        }
        Insert: {
          actual_close_date?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          probability?: number | null
          stage?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
          value?: number | null
        }
        Update: {
          actual_close_date?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          probability?: number | null
          stage?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          author_id: string
          category_id: string | null
          content: string
          created_at: string
          id: string
          is_published: boolean
          organization_id: string
          tags: string[] | null
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id: string
          category_id?: string | null
          content: string
          created_at?: string
          id?: string
          is_published?: boolean
          organization_id: string
          tags?: string[] | null
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string
          category_id?: string | null
          content?: string
          created_at?: string
          id?: string
          is_published?: boolean
          organization_id?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_list_members: {
        Row: {
          added_at: string
          added_by: string
          id: string
          lead_id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          id?: string
          lead_id: string
          list_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          id?: string
          lead_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_list_members_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          created_at: string
          criteria: Json | null
          description: string | null
          id: string
          name: string
          organization_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          criteria?: Json | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          criteria?: Json | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          industry: string | null
          last_name: string
          location: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          score: number | null
          source: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          industry?: string | null
          last_name: string
          location?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          industry?: string | null
          last_name?: string
          location?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          score?: number | null
          source?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_settings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_tokens: number
          model: string
          organization_id: string | null
          provider: string
          system_prompt: string | null
          temperature: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          organization_id?: string | null
          provider?: string
          system_prompt?: string | null
          temperature?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          organization_id?: string | null
          provider?: string
          system_prompt?: string | null
          temperature?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_hidden: boolean
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          company_id: string | null
          contact_id: string | null
          content: string | null
          created_at: string
          id: string
          is_pinned: boolean
          organization_id: string
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          is_pinned?: boolean
          organization_id: string
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          is_pinned?: boolean
          organization_id?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string
          id: string
          message: string
          metadata: Json | null
          organization_id: string
          read: boolean
          read_at: string | null
          severity: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          organization_id: string
          read?: boolean
          read_at?: string | null
          severity?: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          organization_id?: string
          read?: boolean
          read_at?: string | null
          severity?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      partner_contracts: {
        Row: {
          contract_number: string | null
          contract_type: string | null
          contract_value: number | null
          created_at: string
          currency: string | null
          description: string | null
          end_date: string | null
          file_url: string | null
          id: string
          notes: string | null
          organization_id: string
          partner_id: string
          payment_terms: string | null
          renewal_date: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_number?: string | null
          contract_type?: string | null
          contract_value?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          end_date?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          partner_id: string
          payment_terms?: string | null
          renewal_date?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_number?: string | null
          contract_type?: string | null
          contract_value?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          end_date?: string | null
          file_url?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          partner_id?: string
          payment_terms?: string | null
          renewal_date?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_contracts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          address: string | null
          city: string | null
          company_name: string | null
          contact_person: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          organization_id: string
          partnership_type: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          organization_id: string
          partnership_type?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          partnership_type?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_automation_rules: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          name: string
          organization_id: string
          task_template: Json
          trigger_conditions: Json | null
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          name: string
          organization_id: string
          task_template: Json
          trigger_conditions?: Json | null
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          name?: string
          organization_id?: string
          task_template?: Json
          trigger_conditions?: Json | null
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          due_date: string | null
          id: string
          notes: string | null
          organization_id: string | null
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      execute_safe_query: { Args: { query_text: string }; Returns: Json }
      get_database_metadata: {
        Args: never
        Returns: {
          column_default: string
          column_name: string
          data_type: string
          is_nullable: boolean
          schema_name: string
          table_name: string
        }[]
      }
      get_user_role: {
        Args: { org_id: string; user_uuid: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_minimum_role: {
        Args: {
          min_role: Database["public"]["Enums"]["user_role"]
          org_id: string
          user_uuid: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      user_role: "owner" | "admin" | "member" | "viewer"
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
  inbox: {
    Enums: {
      conversation_status: ["open", "archived"],
      conversation_type: ["direct", "group", "channel", "ai_agent"],
      message_format: ["text", "markdown", "system"],
      outbound_status: ["pending", "processing", "sent", "failed"],
      participant_role: ["owner", "member"],
      sender_kind: ["user", "agent", "system", "external"],
    },
  },
  research: {
    Enums: {},
  },
  public: {
    Enums: {
      user_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const

