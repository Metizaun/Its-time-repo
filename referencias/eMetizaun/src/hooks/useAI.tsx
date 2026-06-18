import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export const useAI = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const historyLimit = 10;

  const sendMessage = async (message: string, useDeepSearch: boolean = false) => {
    if (!message.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    const history = messages
      .slice(-historyLimit)
      .map(({ role, content }) => ({ role, content }));

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const { data: functionData, error: functionError } = await supabase.functions.invoke('ai', {
        body: { 
          message,
          history,
          deepSearch: useDeepSearch,
          model: useDeepSearch ? 'openai/gpt-5' : 'google/gemini-2.5-flash'
        }
      });

      if (functionError) {
        throw new Error(functionError.message || "Failed to get AI response");
      }

      const aiResponse = functionData?.response;

      if (aiResponse) {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date(),
        };

        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('AI Error:', error);
      toast.error('Failed to get AI response. Please try again.');
      
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  // Quick AI helper function for simple queries
  const askAI = async (question: string): Promise<string> => {
    try {
      const { data: functionData, error: functionError } = await supabase.functions.invoke('ai', {
        body: { message: question }
      });

      if (functionError) {
        throw new Error(functionError.message || "Failed to get AI response");
      }

      return functionData?.response || 'No response received';
    } catch (error) {
      console.error('AI Error:', error);
      throw error;
    }
  };

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    askAI,
    searchMode,
    setSearchMode,
  };
};
