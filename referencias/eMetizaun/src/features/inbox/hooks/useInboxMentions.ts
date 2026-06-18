import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';

export function useInboxMentions() {
  const [mentionsByConversation, setMentionsByConversation] = useState<Record<string, number>>({});
  const [totalUnreadMentions, setTotalUnreadMentions] = useState(0);
  const [loading, setLoading] = useState(false);

  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const refreshMentionStats = useCallback(async () => {
    if (!user?.id || !currentOrganization?.id) {
      setMentionsByConversation({});
      setTotalUnreadMentions(0);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('inbox')
        .from('mentions')
        .select('conversation_id')
        .eq('organization_id', currentOrganization.id)
        .eq('mentioned_user_id', user.id)
        .eq('is_read', false);

      if (error) {
        throw error;
      }

      const map: Record<string, number> = {};
      for (const row of data || []) {
        map[row.conversation_id] = (map[row.conversation_id] || 0) + 1;
      }

      setMentionsByConversation(map);
      setTotalUnreadMentions(Object.values(map).reduce((acc, value) => acc + value, 0));
    } catch (error) {
      console.error('Failed to refresh mention stats:', error);
      setMentionsByConversation({});
      setTotalUnreadMentions(0);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, user?.id]);

  useEffect(() => {
    void refreshMentionStats();
  }, [refreshMentionStats]);

  useEffect(() => {
    if (!user?.id || !currentOrganization?.id) {
      return;
    }

    const channel = supabase
      .channel(`inbox-mentions-${currentOrganization.id}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'inbox',
          table: 'mentions',
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        () => {
          void refreshMentionStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentOrganization?.id, refreshMentionStats, user?.id]);

  return {
    mentionsByConversation,
    totalUnreadMentions,
    loading,
    refreshMentionStats,
  };
}

