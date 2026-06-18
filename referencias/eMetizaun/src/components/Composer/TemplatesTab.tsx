import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Trash2 } from 'lucide-react';
import type { ComposerTemplate } from '@/hooks/useComposer';
import { toast } from 'sonner';

interface TemplatesTabProps {
  templates: ComposerTemplate[];
  onDeleteTemplate: (id: string) => void;
}

export const TemplatesTab = ({ templates, onDeleteTemplate }: TemplatesTabProps) => {
  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-muted-foreground">No templates saved yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {templates.map((template) => (
        <Card key={template.id}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-base">{template.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{template.title}</p>
              </div>
              <Button
                onClick={() => onDeleteTemplate(template.id!)}
                variant="ghost"
                size="sm"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="p-3 bg-muted rounded text-sm mb-3 prose prose-sm max-w-none leading-relaxed [&>p]:mb-2 [&>ul]:mb-2 [&>li]:mb-1"
              dangerouslySetInnerHTML={{ __html: template.content }}
            />
            <Button
              onClick={() => {
                navigator.clipboard.writeText(template.content);
                toast.success('Template copied to clipboard');
              }}
              variant="outline"
              size="sm"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
