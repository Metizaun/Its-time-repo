import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useOrganizationContext } from "./useOrganizationContext";

export interface Note {
  id: string;
  user_id: string;
  organization_id: string;
  title: string;
  content?: string;
  tags?: string[];
  is_pinned: boolean;
  contact_id?: string;
  company_id?: string;
  created_at: string;
  updated_at: string;
}

export const useNotes = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchNotes = async () => {
    if (!user || !currentOrganization) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [user, currentOrganization]);

  const createNote = async (noteData: Omit<Note, "id" | "user_id" | "organization_id" | "created_at" | "updated_at">) => {
    if (!user || !currentOrganization) throw new Error("User or organization not found");

    const { data, error } = await supabase
      .from("notes")
      .insert({
        ...noteData,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) throw error;

    setNotes(prev => [data, ...prev]);
    return data;
  };

  const updateNote = async (noteData: Partial<Note> & { id: string }) => {
    const { data, error } = await supabase
      .from("notes")
      .update(noteData)
      .eq("id", noteData.id)
      .select()
      .single();

    if (error) throw error;

    setNotes(prev => prev.map(note => note.id === data.id ? data : note));
    return data;
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", id);

    if (error) throw error;

    setNotes(prev => prev.filter(note => note.id !== id));
  };

  return {
    notes,
    loading,
    fetchNotes,
    createNote,
    updateNote,
    deleteNote,
  };
};