import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Save, Trash2 } from 'lucide-react';

export interface SequenceStep {
  title: string;
  content: string;
  media_url?: string;
  delay?: number;
}

interface SequenceBuilderProps {
  steps: SequenceStep[];
  sequenceName: string;
  onSequenceNameChange: (value: string) => void;
  onSaveSequence: () => void;
  onRemoveStep: (index: number) => void;
  renderHtmlContent: boolean;
}

export const SequenceBuilder = ({
  steps,
  sequenceName,
  onSequenceNameChange,
  onSaveSequence,
  onRemoveStep,
  renderHtmlContent
}: SequenceBuilderProps) => {
  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Plus className="h-5 w-5 text-blue-600" />
          Sequence Builder
          {steps.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {steps.length} step{steps.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Build multi-step content sequences. Generate content and click "Add to Sequence" to build your sequence.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Plus className="h-8 w-8 text-muted-foreground/50" />
              <p>No steps in sequence yet</p>
              <p className="text-sm">Generate content above and click "Add to Sequence" to start building</p>
            </div>
          </div>
        ) : (
          <>
            {steps.map((step, index) => (
              <div key={index} className="p-4 border rounded-lg bg-white space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step {index + 1}</Badge>
                    <h4 className="font-medium">{step.title}</h4>
                  </div>
                  <Button onClick={() => onRemoveStep(index)} variant="ghost" size="sm">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Delay: {step.delay === 0 ? 'Immediate' : `${step.delay} hours`}
                </p>
                {step.media_url && (
                  <img
                    src={step.media_url}
                    alt={`Sequence step ${index + 1}`}
                    className="w-full rounded-lg border bg-background"
                  />
                )}
                {step.content && !step.media_url && renderHtmlContent && (
                  <div
                    className="p-3 bg-muted rounded text-sm prose prose-sm max-w-none leading-relaxed [&>p]:mb-2 [&>ul]:mb-2 [&>li]:mb-1"
                    dangerouslySetInnerHTML={{ __html: step.content }}
                  />
                )}
                {step.content && (!renderHtmlContent || step.media_url) && (
                  <div className="p-3 bg-muted rounded text-sm">
                    <p className="leading-relaxed whitespace-pre-wrap">{step.content}</p>
                  </div>
                )}
              </div>
            ))}

            <div className="space-y-2 pt-4 border-t">
              <Label htmlFor="sequence-name">Save Sequence</Label>
              <div className="flex gap-2">
                <Input
                  id="sequence-name"
                  placeholder="Sequence name..."
                  value={sequenceName}
                  onChange={(e) => onSequenceNameChange(e.target.value)}
                />
                <Button onClick={onSaveSequence} variant="outline">
                  <Save className="w-4 h-4 mr-2" />
                  Save Sequence
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
