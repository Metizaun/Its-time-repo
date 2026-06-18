import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { toast } from 'sonner';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isHidden?: boolean;
  queryResult?: QueryResult | null;
}

export interface QueryResult {
  operation?: string;
  rowCount?: number;
  data?: Array<Record<string, any>>;
}

const AUTO_EXECUTE_TAG = '[AUTO_EXECUTE]';
const MAX_VISIBLE_COLUMNS = 8;
const MAX_VISIBLE_ROWS = 20;

export function useNaturalLanguageChat() {
  const { user, session } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    setConversationId(null);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    if (!user || !currentOrganization) {
      toast.error('Nao foi possivel enviar agora.');
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent('');

    let activeConversationId = conversationId;
    let assistantMessageId: string | null = null;
    let assistantMessageContent = '';

    try {
      const accessToken = await getLatestAccessToken();
      if (!accessToken) {
        throw new Error('auth_missing');
      }

      if (!activeConversationId) {
        try {
          activeConversationId = await createConversation(currentOrganization.id, user.id, content);
          setConversationId(activeConversationId);
        } catch (error) {
          console.error('Conversation create error:', error);
          activeConversationId = null;
        }
      }

      if (activeConversationId) {
        try {
          await createMessage(activeConversationId, 'user', content, false);
        } catch (error) {
          console.error('Message create error:', error);
        }
      }

      if (activeConversationId && messages.length === 0) {
        const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        try {
          await updateConversationTitle(activeConversationId, title);
        } catch (error) {
          console.error('Conversation title error:', error);
        }
      }

      const apiMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ];

      const response = await sendChatMessage(apiMessages, activeConversationId || undefined, accessToken);

      if (!response.ok) {
        const responseData = await safeReadJson(response);
        const errorCode = String(responseData?.error || responseData?.message || responseData?.code || '');

        console.error('[useNaturalLanguageChat] chat_request_failed', {
          status: response.status,
          errorCode,
          hasResponseData: Boolean(responseData),
        });

        if (response.status === 401) {
          throw new Error(errorCode || 'auth_invalid');
        }

        throw new Error(errorCode || 'chat_request_failed');
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.includes('text/event-stream')) {
        const fallbackMessage = await readNonStreamResponse(response);
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fallbackMessage,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        return;
      }

      const { visibleContent, sql } = await readStream(response.body, (text) => {
        setStreamingContent(cleanMessageContent(text));
      });
      const cleanedContent = cleanMessageContent(visibleContent);
      console.log('[useNaturalLanguageChat] parsed_response', {
        hasVisibleContent: Boolean(cleanedContent.trim()),
        hasSql: Boolean(sql),
        sqlPreview: sql ? sql.slice(0, 160) : null,
      });

      if (cleanedContent.trim() || sql) {
        assistantMessageContent = cleanedContent.trim();
        assistantMessageContent = ensureInsightFirstResponse(assistantMessageContent, content, Boolean(sql));

        if (assistantMessageContent) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: assistantMessageContent,
            timestamp: new Date(),
          };
          assistantMessageId = assistantMessage.id;
          setMessages((prev) => [...prev, assistantMessage]);

          if (activeConversationId) {
            try {
              await createMessage(activeConversationId, 'assistant', assistantMessage.content, false);
            } catch (error) {
              console.error('Message create error:', error);
            }
          }
        }
      }

      if (!cleanedContent.trim() && !sql) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Nao consegui interpretar seu pedido com clareza ainda. Se quiser, eu reformulo e tento novamente.',
            timestamp: new Date(),
          },
        ]);
      }

      if (sql) {
        setIsExecuting(true);
        const execResult = await executeQuery(sql, accessToken);
        console.log('[useNaturalLanguageChat] execute_result', execResult);
        setIsExecuting(false);

        if (execResult?.success) {
          const executionData = (execResult.data || null) as QueryResult | null;
          const safeExecutionData = sanitizeQueryResultForDisplay(executionData);

          if (!assistantMessageContent) {
            const synthesizedContent = buildConversationalReplyFromQuery(safeExecutionData, content);
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: synthesizedContent,
              timestamp: new Date(),
              queryResult: safeExecutionData,
            };

            assistantMessageId = assistantMessage.id;
            setMessages((prev) => [...prev, assistantMessage]);

            if (activeConversationId) {
              try {
                await createMessage(activeConversationId, 'assistant', assistantMessage.content, false);
              } catch (error) {
                console.error('Message create error:', error);
              }
            }
          }

          if (assistantMessageId && safeExecutionData) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, queryResult: safeExecutionData }
                  : message
              )
            );
          }
          if (executionData?.data?.length) {
            toast.success('Acao concluida com sucesso.');
          }
        } else {
          const friendly = mapErrorToMessage(execResult?.code);
          toast.error(friendly);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorCode = error instanceof Error ? error.message : '';
      if (isAuthErrorCode(errorCode)) {
        await supabase.auth.signOut({ scope: 'local' });
        clearLocalAuthArtifacts();
        toast.error('Sessao expirada ou invalida. Entre novamente para continuar.');
      } else {
        toast.error('Nao foi possivel concluir agora.');
      }
    } finally {
      setIsLoading(false);
      setStreamingContent('');
      setIsExecuting(false);
    }
  }, [conversationId, currentOrganization, isLoading, messages, session?.access_token, user]);

  return {
    messages,
    isLoading,
    isExecuting,
    streamingContent,
    sendMessage,
    clearMessages,
  };
}

function cleanMessageContent(content: string) {
  return content
    .replace(/\[AUTO_EXECUTE\]/gi, '')
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function createConversation(organizationId: string, userId: string, titleSeed: string) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      organization_id: organizationId,
      user_id: userId,
      title: titleSeed ? titleSeed.slice(0, 50) : 'Nova conversa',
    })
    .select()
    .single();

  if (error) throw error;
  return data.id as string;
}

async function updateConversationTitle(conversationId: string, title: string) {
  await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);
}

async function createMessage(conversationId: string, role: string, content: string, isHidden: boolean) {
  await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      is_hidden: isHidden,
    });
}

function getSupabaseFunctionConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('config_missing');
  }

  return { supabaseUrl, supabaseKey };
}

async function getLatestAccessToken() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('[useNaturalLanguageChat] getSession error:', error);
      return undefined;
    }

    const candidateToken = normalizeAccessToken(data.session?.access_token);
    if (!candidateToken) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      const refreshedToken = normalizeAccessToken(refreshData.session?.access_token);
      if (refreshError || !refreshedToken || !isLikelyJwt(refreshedToken)) {
        return undefined;
      }
      return refreshedToken;
    }

    if (!isLikelyJwt(candidateToken)) {
      console.warn('[useNaturalLanguageChat] candidate access token is not a JWT, trying refreshSession');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      const refreshedToken = normalizeAccessToken(refreshData.session?.access_token);
      if (refreshError || !refreshedToken || !isLikelyJwt(refreshedToken)) {
        return undefined;
      }
      return refreshedToken;
    }

    // Validate token before calling protected Edge Functions.
    const { data: userData, error: userError } = await supabase.auth.getUser(candidateToken);
    if (!userError && userData?.user) {
      return candidateToken;
    }

    console.warn('[useNaturalLanguageChat] token validation failed, trying refreshSession', {
      userErrorMessage: userError?.message,
    });

    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    const refreshedToken = normalizeAccessToken(refreshData.session?.access_token);
    if (refreshError || !refreshedToken) {
      return undefined;
    }

    const { data: refreshedUserData, error: refreshedUserError } = await supabase.auth.getUser(refreshedToken);
    if (refreshedUserError || !refreshedUserData?.user) {
      return undefined;
    }

    return refreshedToken;
  } catch (error) {
    console.error('[useNaturalLanguageChat] getSession exception:', error);
    return undefined;
  }
}

async function sendAuthenticatedFunctionRequest(
  functionName: string,
  payload: Record<string, unknown>,
  accessToken?: string,
) {
  const { supabaseUrl, supabaseKey } = getSupabaseFunctionConfig();
  const resolvedAccessToken = normalizeAccessToken(accessToken || (await getLatestAccessToken()));

  if (!resolvedAccessToken) {
    throw new Error('auth_missing');
  }

  if (!isLikelyJwt(resolvedAccessToken)) {
    throw new Error('auth_invalid');
  }

  const tokenDebug = getTokenDebug(resolvedAccessToken, supabaseUrl);
  console.log(`[useNaturalLanguageChat] ${functionName} token_debug`, tokenDebug);
  if (tokenDebug.projectRefMismatch) {
    console.error('[useNaturalLanguageChat] token project mismatch', tokenDebug);
    throw new Error('auth_project_mismatch');
  }
  if (tokenDebug.expired) {
    throw new Error('auth_invalid');
  }

  const sendRequest = (token: string) =>
    fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

  const response = await sendRequest(resolvedAccessToken);
  if (response.status !== 401) {
    return response;
  }

  const firstAttemptBody = await safeReadJson(response);
  console.warn(`[useNaturalLanguageChat] ${functionName} returned 401, trying session refresh`);
  if (firstAttemptBody) {
    console.warn(`[useNaturalLanguageChat] ${functionName} first 401 body`, firstAttemptBody);
  }

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  const refreshedToken = normalizeAccessToken(refreshData.session?.access_token);

  if (refreshError || !refreshedToken) {
    return response;
  }

  const retried = await sendRequest(refreshedToken);
  if (retried.status === 401) {
    const secondAttemptBody = await safeReadJson(retried);
    if (secondAttemptBody) {
      console.warn(`[useNaturalLanguageChat] ${functionName} second 401 body`, secondAttemptBody);
    }
  }

  return retried;
}

async function sendChatMessage(
  messages: { role: string; content: string }[],
  conversationId?: string,
  accessToken?: string,
) {
  return sendAuthenticatedFunctionRequest('chat', { messages, conversationId }, accessToken);
}

async function executeQuery(query: string, accessToken?: string) {
  try {
    getSupabaseFunctionConfig();
  } catch {
    return { success: false, code: 'config_missing' };
  }

  console.log('[useNaturalLanguageChat] sql_before_execute', {
    preview: query ? query.slice(0, 160) : null,
  });

  const prepared = prepareExecutableSql(query);
  console.log('[useNaturalLanguageChat] sql_after_prepare', {
    preparedSqlPreview: prepared.query ? prepared.query.slice(0, 160) : null,
    startsWithKeyword: prepared.startsWithKeyword,
  });

  if (!prepared.query) {
    return { success: false, code: 'operation_not_allowed' };
  }

  let queryToExecute = prepared.query;
  let executionRetryCount = 0;

  while (true) {
    let response: Response;
    try {
      response = await sendAuthenticatedFunctionRequest(
        'execute-query',
        { query: queryToExecute, executionRetryCount },
        accessToken,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'auth_missing') {
        return { success: false, code: 'auth_missing' };
      }
      return { success: false, code: 'internal_error' };
    }

    const result = await safeReadJson(response);
    if (!response.ok) {
      const code = String(result?.code || result?.error || result?.message || 'internal_error');

      if (response.status === 400 && code === 'operation_not_allowed' && executionRetryCount === 0) {
        const repaired = repairSelectQueryForExecution(queryToExecute);
        if (repaired && repaired !== queryToExecute) {
          executionRetryCount = 1;
          queryToExecute = repaired;
          console.warn('[useNaturalLanguageChat] execute_retry_applied', {
            executionRetryCount,
            repairedSqlPreview: repaired.slice(0, 160),
          });
          continue;
        }
      }

      if (response.status === 401) {
        return { success: false, code: 'auth_invalid', stage: result?.stage, retryApplied: result?.retryApplied };
      }

      return { success: false, code, stage: result?.stage, retryApplied: result?.retryApplied };
    }

    if (!result) {
      return { success: false, code: 'internal_error' };
    }

    return result;
  }
}

function prepareExecutableSql(query: string) {
  if (!query) return { query: '', startsWithKeyword: false };

  let normalized = query.trim();
  normalized = normalized.replace(/\[AUTO_EXECUTE\]/gi, '').trim();

  const fencedSql = normalized.match(/```sql\s*([\s\S]*?)```/i);
  if (fencedSql?.[1]) {
    normalized = fencedSql[1].trim();
  } else {
    const fencedAny = normalized.match(/```\s*([\s\S]*?)```/);
    if (fencedAny?.[1]) {
      normalized = fencedAny[1].trim();
    }
  }

  normalized = normalized.replace(/^sql\s*/i, '').trim();

  const firstKeywordIndex = normalized.search(/\b(SELECT|WITH|INSERT\s+INTO|UPDATE)\b/i);
  if (firstKeywordIndex > 0) {
    normalized = normalized.slice(firstKeywordIndex).trim();
  }

  normalized = normalized.replace(/;\s*$/g, '').trim();

  return {
    query: normalized,
    startsWithKeyword: /^(SELECT|WITH|INSERT\s+INTO|UPDATE)\b/i.test(normalized),
  };
}

function repairSelectQueryForExecution(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return '';
  if (trimmed.includes(';')) return '';
  if (!/^\s*FROM\b/i.test(trimmed)) return '';
  if (/\b(DROP|TRUNCATE|ALTER|GRANT|REVOKE|DELETE|EXEC|EXECUTE)\b/i.test(trimmed)) return '';

  return `SELECT * ${trimmed.replace(/^\s*FROM\b/i, 'FROM').trim()}`;
}

async function readStream(
  body: ReadableStream<Uint8Array> | null,
  onStream: (text: string) => void,
) {
  if (!body) return { visibleContent: '', sql: '' };

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let visibleContent = '';
  let sqlBuffer = '';
  let pending = '';
  let foundTag = false;

  const appendText = (text: string) => {
    pending += text;

    if (!foundTag) {
      const index = pending.indexOf(AUTO_EXECUTE_TAG);
      if (index >= 0) {
        visibleContent += pending.slice(0, index);
        pending = pending.slice(index + AUTO_EXECUTE_TAG.length);
        foundTag = true;
      }
    }

    if (foundTag) {
      sqlBuffer += pending;
      pending = '';
    } else if (pending.length > AUTO_EXECUTE_TAG.length) {
      const flushPoint = pending.length - AUTO_EXECUTE_TAG.length;
      visibleContent += pending.slice(0, flushPoint);
      pending = pending.slice(flushPoint);
    }

    onStream(visibleContent);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          appendText(content);
        }
      } catch {
        // ignore
      }
    }
  }

  if (foundTag) {
    sqlBuffer += pending;
  } else {
    visibleContent += pending;
  }

  let sql = extractSql(sqlBuffer);
  if (!foundTag && !sql) {
    const fallbackSql = extractSqlFromFenced(visibleContent);
    if (fallbackSql) {
      sql = fallbackSql;
      visibleContent = cleanMessageContent(visibleContent);
    }
  }

  return { visibleContent, sql };
}

function extractSql(sqlBuffer: string) {
  if (!sqlBuffer) return '';

  const fencedSql = sqlBuffer.match(/```sql\s*([\s\S]*?)```/i);
  if (fencedSql?.[1]) {
    return fencedSql[1].trim();
  }

  const fenced = sqlBuffer.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return sqlBuffer.replace(AUTO_EXECUTE_TAG, '').trim();
}

function extractSqlFromFenced(content: string) {
  const fencedSql = content.match(/```sql\s*([\s\S]*?)```/i);
  if (fencedSql?.[1]) {
    return fencedSql[1].trim();
  }
  return '';
}

async function readNonStreamResponse(response: Response) {
  try {
    const data = await response.json();
    if (data?.error || data?.message || data?.code) {
      return mapErrorToMessage(data?.error || data?.message || data?.code) || 'Nao foi possivel concluir agora.';
    }
  } catch {
    // ignore
  }
  return 'Nao foi possivel concluir agora.';
}

async function safeReadJson(response: Response): Promise<Record<string, any> | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function sanitizeQueryResultForDisplay(result: QueryResult | null): QueryResult | null {
  if (!result) return null;
  if (!Array.isArray(result.data) || result.data.length === 0) return result;

  const sourceRows = result.data.filter((row): row is Record<string, any> => Boolean(row && typeof row === 'object'));
  if (!sourceRows.length) return { ...result, data: [] };

  const allowTaskDescription = shouldAllowTaskDescription(sourceRows);

  const candidateColumns = Object.keys(sourceRows[0]).filter((key) =>
    shouldKeepColumn(key, allowTaskDescription)
  );
  const rankedColumns = rankColumns(candidateColumns);
  const visibleColumns = rankedColumns.slice(0, MAX_VISIBLE_COLUMNS);

  const fallbackColumns = Object.keys(sourceRows[0])
    .filter((key) => !isSensitiveColumn(key, allowTaskDescription))
    .slice(0, MAX_VISIBLE_COLUMNS);

  const selectedColumns = visibleColumns.length > 0 ? visibleColumns : fallbackColumns;

  const safeRows = sourceRows.slice(0, MAX_VISIBLE_ROWS).map((row) => {
    const safeRow: Record<string, any> = {};
    selectedColumns.forEach((column) => {
      safeRow[column] = sanitizeCellValue(row[column], column);
    });
    return safeRow;
  });

  return {
    ...result,
    data: safeRows,
  };
}

function shouldKeepColumn(column: string, allowTaskDescription: boolean) {
  return !isSensitiveColumn(column, allowTaskDescription) && isUserFacingColumn(column, allowTaskDescription);
}

function isSensitiveColumn(column: string, allowTaskDescription: boolean) {
  const key = column.toLowerCase();

  if (key === 'id' || key.endsWith('_id')) return true;
  if (
    key.includes('password') ||
    key.includes('secret') ||
    key.includes('token') ||
    key.includes('apikey') ||
    key.includes('api_key') ||
    key.includes('key') ||
    key.includes('hash')
  ) {
    return true;
  }
  if (
    key.includes('metadata') ||
    key.includes('internal') ||
    key.includes('raw') ||
    key.includes('payload') ||
    key.includes('json') ||
    key.includes('debug') ||
    key.includes('organization')
  ) {
    return true;
  }
  if (
    key === 'created_at' ||
    key === 'updated_at' ||
    key === 'deleted_at' ||
    key === 'archived_at' ||
    key === 'completed_at'
  ) {
    return true;
  }
  if ((key === 'description' && !allowTaskDescription) || key === 'notes' || key === 'note') {
    return true;
  }

  return false;
}

function isUserFacingColumn(column: string, allowTaskDescription: boolean) {
  const key = column.toLowerCase();
  if (key === 'description' && allowTaskDescription) return true;

  return (
    key.includes('name') ||
    key.includes('title') ||
    key.includes('status') ||
    key.includes('stage') ||
    key.includes('priority') ||
    key.includes('due') ||
    key.includes('date') ||
    key.includes('amount') ||
    key.includes('value') ||
    key.includes('total') ||
    key.includes('email') ||
    key.includes('phone') ||
    key.includes('company') ||
    key.includes('contact') ||
    key.includes('owner') ||
    key.includes('assigned') ||
    key.includes('type') ||
    key.includes('category')
  );
}

function rankColumns(columns: string[]) {
  return [...columns].sort((a, b) => columnWeight(b) - columnWeight(a));
}

function columnWeight(column: string) {
  const key = column.toLowerCase();
  if (key.includes('title') || key.includes('name')) return 100;
  if (key.includes('status') || key.includes('stage') || key.includes('priority')) return 90;
  if (key.includes('due') || key.includes('date')) return 80;
  if (key === 'description') return 75;
  if (key.includes('amount') || key.includes('value') || key.includes('total')) return 70;
  if (key.includes('company') || key.includes('contact') || key.includes('owner') || key.includes('assigned')) return 60;
  return 10;
}

function shouldAllowTaskDescription(rows: Array<Record<string, any>>) {
  const keys = new Set(
    rows.slice(0, 3).flatMap((row) => Object.keys(row).map((key) => key.toLowerCase()))
  );

  const hasTaskShape =
    keys.has('title') &&
    keys.has('status') &&
    (keys.has('due_date') || keys.has('priority') || keys.has('completed_at') || keys.has('assigned_to'));

  return hasTaskShape && keys.has('description');
}

function sanitizeCellValue(value: unknown, column?: string) {
  if (value === null || value === undefined) return '-';

  if (typeof value === 'string') {
    if (looksLikeUuid(value) || looksLikeJwt(value)) return '[oculto]';
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '-';
    const maxLength = column?.toLowerCase() === 'description' ? 320 : 140;
    if (normalized.length > maxLength) return `${normalized.slice(0, maxLength)}...`;
    return normalized;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  // Prevent nested objects/arrays from leaking raw payloads to end-users.
  if (typeof value === 'object') return '[resumo indisponivel]';

  const fallback = String(value);
  if (looksLikeUuid(fallback) || looksLikeJwt(fallback)) return '[oculto]';
  if (fallback.length > 140) return `${fallback.slice(0, 140)}...`;
  return fallback;
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function looksLikeJwt(value: string) {
  const candidate = value.trim();
  return candidate.split('.').length === 3 && candidate.length > 40;
}

function ensureInsightFirstResponse(reply: string, userPrompt: string, hasSql: boolean) {
  const normalizedReply = reply.trim();
  if (!normalizedReply) return normalizedReply;
  if (hasSql) return normalizedReply;
  if (!looksLikeRefusalResponse(normalizedReply)) return normalizedReply;

  if (isConversionQuestion(userPrompt)) {
    return [
      'Consigo te ajudar com essa analise.',
      'Para dizer se sua taxa de conversao esta boa no seu contexto, preciso destes dados:',
      '1. Periodo analisado (ex.: ultimos 30 dias)',
      '2. Etapa da conversao (lead -> oportunidade, oportunidade -> venda etc.)',
      '3. Volume total e quantidade convertida',
      '4. Canal/origem principal dos leads',
      'Com isso eu te devolvo um diagnostico objetivo com acoes praticas.'
    ].join('\n');
  }

  return [
    'Consigo te ajudar com isso.',
    'Para te entregar um insight confiavel, me passe:',
    '1. Periodo da analise',
    '2. Indicador principal que voce quer otimizar',
    '3. Segmento/filtro (canal, time ou etapa do funil)',
    'Com esses dados eu te retorno leitura do cenario e proximo passo recomendado.'
  ].join('\n');
}

function looksLikeRefusalResponse(text: string) {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('nao consigo') ||
    normalized.includes('não consigo') ||
    normalized.includes('nao posso') ||
    normalized.includes('não posso') ||
    normalized.includes('nao tenho os dados') ||
    normalized.includes('não tenho os dados') ||
    normalized.includes('posso te ajudar a buscar mais dados') ||
    normalized.includes('isso pode variar muito dependendo')
  );
}

function isConversionQuestion(text: string) {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('taxa de convers') ||
    normalized.includes('conversao') ||
    normalized.includes('conversão')
  );
}

function buildConversationalReplyFromQuery(result: QueryResult | null, prompt: string) {
  const normalizedPrompt = prompt.trim();
  const operation = (result?.operation || '').toLowerCase();
  const rowCount = Number(result?.rowCount || 0);
  const rows = Array.isArray(result?.data) ? result.data : [];

  if (operation === 'insert' || operation === 'update' || operation === 'delete') {
    const affected = rowCount > 0 ? `${rowCount} registro(s)` : 'sem alteracoes';
    return `Conclui sua solicitacao com sucesso. Operacao: ${operation.toUpperCase()} (${affected}).`;
  }

  if (!rows.length) {
    return `Consultei os dados para "${normalizedPrompt}" e nao encontrei registros com esse criterio. Quer que eu tente com outro filtro?`;
  }

  const firstRow = rows[0];
  const highlight = summarizeRow(firstRow);
  const summary = rowCount > 0 ? `${rowCount} registro(s)` : `${rows.length} registro(s)`;

  return `Encontrei ${summary} para sua pergunta. ${highlight ? `Exemplo do primeiro resultado: ${highlight}.` : ''}`.trim();
}

function summarizeRow(row: Record<string, any>) {
  const keys = Object.keys(row).slice(0, 3);
  if (!keys.length) return '';

  return keys
    .map((key) => `${key}: ${formatSummaryValue(row[key])}`)
    .join(', ');
}

function formatSummaryValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > 40 ? `${clean.slice(0, 40)}...` : clean;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return '[objeto]';
  return String(value);
}

function mapErrorToMessage(code?: string) {
  switch (code) {
    case '23502':
      return 'Nao foi possivel concluir. Faltou uma informacao obrigatoria.';
    case '23503':
      return 'Nao foi possivel concluir. Um item relacionado nao foi encontrado.';
    case '23505':
      return 'Nao foi possivel concluir. Ja existe um registro parecido.';
    case '22001':
      return 'Nao foi possivel concluir. O texto e muito longo.';
    case 'forbidden_operation':
    case 'write_not_allowed':
    case 'operation_not_allowed':
    case 'multi_statement_not_allowed':
      return 'Nao foi possivel concluir esta solicitacao.';
    case 'config_missing':
      return 'Nao foi possivel concluir agora.';
    case 'auth_missing':
    case 'auth_invalid':
    case 'auth_project_mismatch':
    case 'not_authenticated':
    case 'Invalid JWT':
    case 'JWT expired':
    case 'Missing authorization header':
    case 'Invalid API key':
      return 'Sessao invalida. Entre novamente para continuar.';
    default:
      return 'Nao foi possivel concluir agora.';
  }
}

function isAuthErrorCode(code?: string) {
  if (!code) return false;
  const normalized = code.toLowerCase();
  return (
    normalized === 'auth_missing' ||
    normalized === 'auth_invalid' ||
    normalized === 'auth_project_mismatch' ||
    normalized === 'not_authenticated' ||
    normalized === '401' ||
    normalized.includes('invalid jwt') ||
    normalized.includes('jwt expired') ||
    normalized.includes('invalid api key') ||
    normalized.includes('authorization')
  );
}

function normalizeAccessToken(token?: string) {
  if (!token) return undefined;
  let normalized = token.trim();
  if (!normalized) return undefined;

  if (normalized.toLowerCase().startsWith('bearer ')) {
    normalized = normalized.slice(7).trim();
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized || undefined;
}

function isLikelyJwt(token?: string) {
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function getTokenDebug(token: string, supabaseUrl: string) {
  const payload = decodeJwtPayload(token);
  const expectedProjectRef = extractProjectRef(supabaseUrl);
  const payloadProjectRef = extractPayloadProjectRef(payload);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const expired = typeof exp === 'number' ? exp <= nowInSeconds : false;
  const projectRefMismatch = Boolean(
    expectedProjectRef && payloadProjectRef && payloadProjectRef !== expectedProjectRef,
  );

  return {
    expectedProjectRef,
    payloadProjectRef,
    projectRefMismatch,
    hasExp: typeof exp === 'number',
    expired,
  };
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function extractProjectRef(url: string) {
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1] || null;
}

function extractPayloadProjectRef(payload: Record<string, any> | null) {
  if (!payload) return null;
  if (typeof payload.ref === 'string') {
    return payload.ref;
  }
  const issuer = String(payload.iss || '');
  const match = issuer.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/auth\/v1/i);
  return match?.[1] || null;
}

function clearLocalAuthArtifacts() {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const projectRef = supabaseUrl ? extractProjectRef(supabaseUrl) : null;
    if (projectRef) {
      localStorage.removeItem(`sb-${projectRef}-auth-token`);
    }
    localStorage.removeItem('supabase.auth.token');
  } catch {
    // ignore
  }
}

