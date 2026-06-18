import { useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface MessageInputProps {
  disabled?: boolean;
  loading?: boolean;
  onSendMessage: (payload: { content: string; files: File[] }) => Promise<void>;
}

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function MessageInput({ disabled = false, loading = false, onSendMessage }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const handleSend = async () => {
    if ((!content.trim() && files.length === 0) || disabled || loading) {
      return;
    }

    const payload = {
      content,
      files,
    };

    setContent('');
    setFiles([]);

    try {
      await onSendMessage(payload);
    } catch (error) {
      setContent(payload.content);
      setFiles(payload.files);
      throw error;
    }
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      await handleSend();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    const valid = selected.filter((file) => file.size > 0 && file.size <= MAX_FILE_SIZE_BYTES);

    if (valid.length) {
      setFiles((prev) => [...prev, ...valid]);
    }

    event.target.value = '';
  };

  return (
    <div className="border-t bg-background p-3">
      <div className="rounded-2xl border border-input bg-card px-3 py-2 shadow-sm">
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || loading}
          placeholder="Send your message..."
          className="min-h-[64px] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
        />

        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                <span className="max-w-[220px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Paperclip className="h-4 w-4" />
            <input
              type="file"
              className="hidden"
              multiple
              disabled={disabled || loading}
              accept="image/*,.pdf,.doc,.docx,.txt"
              onChange={handleFileChange}
            />
          </label>

          <Button
            type="button"
            onClick={() => void handleSend()}
            disabled={disabled || loading || (!content.trim() && files.length === 0)}
            size="icon"
            title="Send"
            aria-label="Send message"
            className="h-9 w-9 rounded-full bg-[var(--accent-orange)] text-white shadow-md transition-colors hover:bg-[var(--accent-orange-hover)] focus-visible:ring-[var(--accent-orange-light)] disabled:bg-muted disabled:text-muted-foreground"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

