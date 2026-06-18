import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import type { ComposerSequence } from '@/hooks/useComposer';
import { toast } from 'sonner';

interface SequencesTabProps {
  sequences: ComposerSequence[];
  onDeleteSequence: (id: string) => void;
}

export const SequencesTab = ({ sequences, onDeleteSequence }: SequencesTabProps) => {
  if (sequences.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <div className="flex flex-col items-center gap-2">
            <Plus className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground font-medium">No sequences created yet</p>
            <p className="text-sm text-muted-foreground">
              Build sequences by generating content and adding steps in the Generate tab
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {sequences.map((sequence) => (
        <Card key={sequence.id}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-base">{sequence.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {sequence.steps.length} steps • {sequence.description}
                </p>
              </div>
              <Button
                onClick={() => onDeleteSequence(sequence.id!)}
                variant="ghost"
                size="sm"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sequence.steps.map((step, index) => (
                <div key={index} className="p-4 border rounded-lg bg-background space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Step {index + 1}</Badge>
                      <h5 className="font-medium">{step.title}</h5>
                    </div>
                    <Button
                      onClick={() => {
                        const textToCopy = step.media_url
                          ? `${step.title}\n${step.media_url}\n${step.content || ''}`
                          : step.content;
                        navigator.clipboard.writeText(textToCopy);
                        toast.success('Step content copied to clipboard');
                      }}
                      variant="ghost"
                      size="sm"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Delay: {step.delay === 0 ? 'Immediate' : `${step.delay} hours`}
                  </p>
                  {step.media_url && (
                    <img
                      src={step.media_url}
                      alt={`Sequence step ${index + 1}`}
                      className="w-full rounded-lg border"
                    />
                  )}
                  {step.content && !step.media_url && (
                    <div
                      className="p-3 bg-muted rounded text-sm prose prose-sm max-w-none leading-relaxed [&>p]:mb-3 [&>ul]:mb-3 [&>li]:mb-1 [&>h3]:mb-2 [&>h4]:mb-2"
                      dangerouslySetInnerHTML={{ __html: step.content }}
                    />
                  )}
                  {step.content && step.media_url && (
                    <div className="p-3 bg-muted rounded text-sm">
                      <p className="leading-relaxed whitespace-pre-wrap">{step.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button
              onClick={() => {
                const sequenceText = sequence.steps
                  .map((step, i) => {
                    const delayText = step.delay === 0 ? 'Immediate' : `${step.delay} hours`;
                    const mediaText = step.media_url ? `Media: ${step.media_url}\n` : '';
                    return `Step ${i + 1}: ${step.title}\nDelay: ${delayText}\n${mediaText}\n${step.content || ''}`;
                  })
                  .join('\n\n---\n\n');
                navigator.clipboard.writeText(sequenceText);
                toast.success('Sequence copied to clipboard');
              }}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Sequence
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
