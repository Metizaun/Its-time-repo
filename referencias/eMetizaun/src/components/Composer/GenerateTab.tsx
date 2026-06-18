import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Copy, Loader2, Plus, Save, Sparkles } from 'lucide-react';

interface GenerateTabProps {
  placeholder: string;
  suggestions: string[];
  prompt: string;
  context: string;
  isGenerating: boolean;
  generatedContent: string;
  templateName: string;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onSuggestionClick: (suggestion: string) => void;
  onGenerate: () => void;
  onCopyContent: () => void;
  onAddSequenceStep: () => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
}

export const GenerateTab = ({
  placeholder,
  suggestions,
  prompt,
  context,
  isGenerating,
  generatedContent,
  templateName,
  onPromptChange,
  onContextChange,
  onSuggestionClick,
  onGenerate,
  onCopyContent,
  onAddSequenceStep,
  onTemplateNameChange,
  onSaveTemplate
}: GenerateTabProps) => {
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
        <Label htmlFor="prompt">Content Prompt</Label>
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

      <Button onClick={onGenerate} disabled={isGenerating} className="w-full">
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Content
          </>
        )}
      </Button>

      {generatedContent && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Generated Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="p-4 bg-muted rounded-lg prose prose-sm max-w-none leading-relaxed [&>p]:mb-3 [&>ul]:mb-3 [&>li]:mb-1 [&>h3]:mb-2 [&>h4]:mb-2"
              dangerouslySetInnerHTML={{ __html: generatedContent }}
            />

            <div className="flex flex-wrap gap-2">
              <Button onClick={onCopyContent} variant="outline" size="sm">
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>

              <Button
                onClick={onAddSequenceStep}
                variant="outline"
                size="sm"
                className="bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add to Sequence
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="template-name">Save as Template</Label>
              <div className="flex gap-2">
                <Input
                  id="template-name"
                  placeholder="Template name..."
                  value={templateName}
                  onChange={(e) => onTemplateNameChange(e.target.value)}
                />
                <Button onClick={onSaveTemplate} variant="outline">
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
