import { Paperclip, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface AttachmentPickerProps {
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  disabled?: boolean;
}

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function AttachmentPicker({ files, onAddFiles, onRemoveFile, disabled = false }: AttachmentPickerProps) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    const valid = selected.filter((file) => file.size > 0 && file.size <= MAX_FILE_SIZE_BYTES);
    if (valid.length) {
      onAddFiles(valid);
    }

    event.target.value = '';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="px-2" asChild>
          <label className="cursor-pointer">
            <Paperclip className="h-4 w-4" />
            <input
              type="file"
              className="hidden"
              multiple
              disabled={disabled}
              accept="image/*,.pdf,.doc,.docx,.txt"
              onChange={handleFileChange}
            />
          </label>
        </Button>
        <span className="text-xs text-muted-foreground">Anexos ate 20MB</span>
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
              <span className="max-w-[220px] truncate">{file.name}</span>
              <button type="button" onClick={() => onRemoveFile(index)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

