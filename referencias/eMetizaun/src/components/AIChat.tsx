import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Sparkles, Trash2, ArrowDown, ListTodo, BarChart3, Users, FileText, Search, MessageSquare, Globe, Paperclip, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { useNaturalLanguageChat, type ChatMessage } from '@/hooks/useNaturalLanguageChat';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { DynamicDataGrid } from '@/components/DynamicDataGrid';

interface AIChatProps {
  className?: string;
  placeholder?: string;
  suggestions?: string[];
}

export function AIChat({
  className,
  placeholder = "Pergunte alguma coisa...",
  suggestions = [
    "Quantas tasks em aberto eu tenho?",
    "Empresa Acme tem quantas tasks em aberto?",
    "Mostre meus leads mais recentes",
    "Quais sao meus contatos mais recentes?"
  ]
}: AIChatProps) {
  const { messages, isLoading, isExecuting, streamingContent, sendMessage, clearMessages } = useNaturalLanguageChat();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const userName = useMemo(() => {
    const meta = user?.user_metadata;
    const name = meta?.display_name || meta?.full_name || meta?.name || '';
    return typeof name === 'string' ? name.split(' ')[0] : '';
  }, [user]);

  // Icons for suggestion cards
  const SUGGESTION_ICONS = [ListTodo, BarChart3, Search, Users, FileText, MessageSquare];

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const messageToSend = input;
    setInput('');
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    await sendMessage(messageToSend);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize the textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= 1000) {
      setInput(val);
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Detect if scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollDown(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <div className={cn("flex flex-col h-full overflow-hidden relative bg-[#f8f9fa] dark:bg-background", className)}>
      {/* Scrollable messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {!hasMessages ? (
          /* Empty state / Welcome screen */
          <div className="flex flex-col min-h-full px-6 sm:px-8 pt-12 sm:pt-20 pb-32 max-w-[52rem] mx-auto w-full">
            {/* Personalized greeting — left-aligned exactly like reference */}
            <h1 className="text-4xl sm:text-[3.25rem] font-bold text-zinc-900 dark:text-foreground tracking-tight leading-[1.1] mb-0">
              Olá, <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">{userName}</span>
            </h1>
            <h2 className="text-4xl sm:text-[3.25rem] font-bold text-zinc-900 dark:text-foreground tracking-tight leading-[1.1] mb-4">
              <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">O que gostaria de saber?</span>
            </h2>
            <p className="text-muted-foreground text-[15px] sm:text-base mb-8 max-w-2xl leading-snug">
              Use uma das sugestões abaixo ou escreva sua própria pergunta.
            </p>

            {/* Suggestion cards — horizontal row / grid like reference */}
            <div className="w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {suggestions.map((suggestion, index) => {
                  const Icon = SUGGESTION_ICONS[index % SUGGESTION_ICONS.length];
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="flex flex-col justify-between text-left p-5 rounded-2xl
                        bg-white/60 dark:bg-card border border-zinc-200/60 dark:border-border shadow-sm
                        hover:bg-white dark:hover:bg-accent/40 hover:border-zinc-300 dark:hover:border-border/80
                        transition-all duration-200 group min-h-[140px]"
                    >
                      <span className="text-[14px] font-medium text-zinc-800 dark:text-foreground/90 group-hover:text-zinc-950 dark:group-hover:text-foreground leading-snug">
                        {suggestion}
                      </span>
                      <div className="mt-4 flex justify-start">
                        <Icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-500 transition-colors" strokeWidth={1.5} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Refresh Prompts button */}
              <button className="flex items-center gap-2 mt-4 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors">
                <RefreshCw className="w-4 h-4" />
                Atualizar sugestões
              </button>
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="max-w-3xl mx-auto px-4 py-8 pb-40">
            <div className="space-y-8">
              {messages.filter((m) => !m.isHidden).map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {streamingContent && (
                <MessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingContent,
                    timestamp: new Date(),
                  }}
                />
              )}

              {isLoading && <LoadingIndicator />}

              {isExecuting && !isLoading && (
                <div className="text-sm text-muted-foreground animate-pulse pl-1">
                  Processando resultados...
                </div>
              )}
            </div>
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollDown && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-36 z-20
            w-10 h-10 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl
            flex items-center justify-center hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowDown className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
        </button>
      )}

      {/* Structured Floating Input Box */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pt-12 bg-gradient-to-t from-[#f8f9fa] via-[#f8f9fa]/80 dark:from-background dark:via-background/80 to-transparent pointer-events-none">
        <div className="max-w-[52rem] mx-auto pointer-events-auto">
          <form onSubmit={handleSubmit} className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)] overflow-hidden transition-shadow focus-within:shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:focus-within:shadow-[0_8px_30px_rgb(0,0,0,0.4)]">

            {/* Top row: textarea and Web dropdown */}
            <div className="flex items-start px-4 pt-4 pb-2 gap-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={isLoading}
                rows={1}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-[15px] sm:text-base
                  placeholder:text-zinc-400 dark:placeholder:text-zinc-500 min-h-[44px] max-h-[160px] leading-relaxed text-zinc-800 dark:text-zinc-100 p-0 overflow-y-auto"
              />
              <button
                type="button"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 transition-colors mt-0.5"
              >
                <Globe className="w-3.5 h-3.5" />
                All Web <span className="text-[10px] ml-1 opacity-50">▼</span>
              </button>
            </div>

            {/* Bottom actions row */}
            <div className="flex items-center justify-between px-4 pb-3 pt-1">
              <div className="flex items-center gap-4">
                <button type="button" className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors">
                  <div className="w-5 h-5 rounded-full border border-zinc-300 dark:border-zinc-600 flex items-center justify-center">
                    <Paperclip className="w-3 h-3" />
                  </div>
                  Add Attachment
                </button>
                <button type="button" className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors">
                  <ImageIcon className="w-4 h-4" />
                  Use Image
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  {input.length}/1000
                </span>
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="shrink-0 w-8 h-8 rounded-lg bg-[#5b32f2] text-white
                    flex items-center justify-center disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 disabled:cursor-not-allowed
                    hover:bg-[#4b28cc] transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

          </form>

          {/* Footer note */}
          <div className="flex items-center justify-between mt-3 px-2">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium tracking-wide">
              IA pode cometer erros. Verifique informações importantes.
            </p>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearMessages}
                className="flex items-center gap-1 text-[11px] font-medium text-red-400 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Limpar conversa
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Message Bubble ─────────────── */

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const safeContent = cleanMessageContent(message.content);
  const resultRows = message.queryResult?.data;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div className="bg-[#5b32f2] text-white rounded-[20px] rounded-br-[4px] px-5 py-3 shadow-sm">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{safeContent}</p>
          </div>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-right mt-1.5 mr-1 font-medium">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="max-w-full">
      <div className="prose prose-zinc sm:prose-base max-w-none dark:prose-invert
        prose-headings:mt-4 prose-headings:mb-3 prose-headings:font-bold prose-headings:tracking-tight
        prose-p:my-2.5 prose-p:leading-[1.6] prose-p:text-zinc-800 dark:prose-p:text-zinc-200
        prose-li:text-zinc-800 dark:prose-li:text-zinc-200 prose-strong:text-zinc-900 dark:prose-strong:text-white prose-strong:font-semibold">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            code: ({ inline, className, children, ...props }: any) => {
              return !inline ? (
                <div className="relative group my-4 shadow-sm border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <div className="bg-zinc-100 dark:bg-zinc-900 px-4 py-2 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-xs font-mono text-zinc-500">código</span>
                    <button
                      type="button"
                      onClick={() => {
                        const text = String(children).replace(/\n$/, '');
                        navigator.clipboard.writeText(text);
                      }}
                      className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-1"
                    >
                      Copiar
                    </button>
                  </div>
                  <pre className="bg-zinc-950 text-zinc-100 p-4 overflow-x-auto text-[13px] leading-relaxed m-0 rounded-none">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
              ) : (
                <code className="bg-zinc-100 dark:bg-zinc-800 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded-md text-[13px] font-mono border border-zinc-200 dark:border-zinc-700" {...props}>
                  {children}
                </code>
              );
            },
            table: ({ children }) => (
              <div className="overflow-x-auto my-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <table className="min-w-full text-sm m-0">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 text-left font-semibold text-[13px] text-zinc-600 dark:text-zinc-300 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
                {children}
              </td>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-purple-500 pl-4 py-1 my-4 text-zinc-600 dark:text-zinc-400 bg-purple-50 dark:bg-purple-950/20 rounded-r-lg italic m-0">
                {children}
              </blockquote>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-outside pl-5 space-y-1.5 my-3 marker:text-zinc-400">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-outside pl-5 space-y-1.5 my-3 marker:text-zinc-400">{children}</ol>
            ),
          }}
        >
          {safeContent}
        </ReactMarkdown>
      </div>

      {!!resultRows?.length && (
        <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-card p-4 shadow-sm">
          <DynamicDataGrid data={resultRows} />
        </div>
      )}

      <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mt-2 ml-1">
        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

/* ─────────────── Loading Indicator ─────────────── */

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 py-3">
      <div className="flex space-x-1.5">
        <div className="w-2 h-2 bg-purple-500/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-purple-500/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-purple-500/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-[13px] font-medium text-zinc-500">Pensando...</span>
    </div>
  );
}

/* ─────────────── Helpers ─────────────── */

function cleanMessageContent(content: string) {
  return content
    .replace(/\[AUTO_EXECUTE\]/gi, '')
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
