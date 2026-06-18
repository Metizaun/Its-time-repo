import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, ImageUp, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';

interface InstagramGenerateTabProps {
  placeholder: string;
  suggestions: string[];
  prompt: string;
  context: string;
  isGenerating: boolean;
  sourceImageUrl: string | null;
  generatedImageUrl: string | null;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onSuggestionClick: (suggestion: string) => void;
  onGenerate: () => void;
  onUploadImage: (file: File) => void;
  onClearSourceImage: () => void;
  onDownloadGenerated: () => void;
  onUseGeneratedAsSource: () => void;
  onAddSequenceStep: () => void;
}

export const InstagramGenerateTab = ({
  placeholder,
  suggestions,
  prompt,
  context,
  isGenerating,
  sourceImageUrl,
  generatedImageUrl,
  onPromptChange,
  onContextChange,
  onSuggestionClick,
  onGenerate,
  onUploadImage,
  onClearSourceImage,
  onDownloadGenerated,
  onUseGeneratedAsSource,
  onAddSequenceStep
}: InstagramGenerateTabProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUploadImage(file);
      event.target.value = '';
    }
  };

  const promptLabel = sourceImageUrl ? 'Instruções de Edição' : 'Descreva a imagem';

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">Quick Suggestions</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {suggestions.map((suggestion, index) => (
            <Badge
              key={index}
              variant="outline"
              className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
              onClick={() => onSuggestionClick(suggestion)}
            >
              {suggestion}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="prompt">{promptLabel}</Label>
        <Textarea
          id="prompt"
          placeholder={placeholder}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          className="min-h-[100px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="context">Additional Context (Optional)</Label>
        <Textarea
          id="context"
          placeholder="Provide additional context, target audience details, or specific requirements..."
          value={context}
          onChange={(e) => onContextChange(e.target.value)}
          className="min-h-[80px]"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-medium">Imagem de origem</h4>
                <p className="text-xs text-muted-foreground">Opcional para edição</p>
              </div>
              {sourceImageUrl && (
                <Button onClick={onClearSourceImage} variant="ghost" size="sm">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
            {sourceImageUrl ? (
              <img
                src={sourceImageUrl}
                alt="Imagem de origem"
                className="w-full rounded-lg border"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 border border-dashed rounded-lg py-8">
                <ImageUp className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Envie uma imagem para edição</p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm">
                  Upload Image
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <h4 className="text-sm font-medium">Resultado</h4>
              <p className="text-xs text-muted-foreground">A imagem gerada aparecerá aqui</p>
            </div>
            {generatedImageUrl ? (
              <img
                src={generatedImageUrl}
                alt="Imagem gerada"
                className="w-full rounded-lg border"
              />
            ) : (
              <div className="flex items-center justify-center border border-dashed rounded-lg py-16 text-sm text-muted-foreground">
                A imagem gerada aparecerá aqui
              </div>
            )}

            {generatedImageUrl && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={onDownloadGenerated} variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button onClick={onUseGeneratedAsSource} variant="outline" size="sm">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Editar esta imagem
                </Button>
                <Button onClick={onAddSequenceStep} variant="outline" size="sm">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Add to Sequence
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Button onClick={onGenerate} disabled={isGenerating} className="w-full">
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Image
          </>
        )}
      </Button>
    </div>
  );
};
