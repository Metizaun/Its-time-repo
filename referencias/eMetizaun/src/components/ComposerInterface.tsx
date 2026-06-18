import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useComposer } from '@/hooks/useComposer';
import { toast } from 'sonner';
import { GenerateTab } from '@/components/Composer/GenerateTab';
import { InstagramGenerateTab } from '@/components/Composer/InstagramGenerateTab';
import { TemplatesTab } from '@/components/Composer/TemplatesTab';
import { SequencesTab } from '@/components/Composer/SequencesTab';
import { SequenceBuilder, type SequenceStep } from '@/components/Composer/SequenceBuilder';

interface ComposerInterfaceProps {
  contentType: 'instagram' | 'email' | 'sms' | 'custom';
  placeholder: string;
  suggestions: string[];
}

export const ComposerInterface = ({ contentType, placeholder, suggestions }: ComposerInterfaceProps) => {
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sequenceName, setSequenceName] = useState('');
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);

  const {
    isGenerating,
    generatedContent,
    setGeneratedContent,
    generatedMediaUrl,
    setGeneratedMediaUrl,
    templates,
    sequences,
    generateContent,
    uploadImage,
    saveTemplate,
    loadTemplates,
    saveSequence,
    loadSequences,
    deleteTemplate,
    deleteSequence
  } = useComposer();

  useEffect(() => {
    loadTemplates();
    loadSequences();
  }, []);

  const isInstagram = contentType === 'instagram';

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    try {
      await generateContent(prompt, contentType, context, undefined, sourceImageUrl || undefined);
    } catch (error) {
      // Error already handled in hook
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setPrompt(suggestion);
  };

  const handleCopyContent = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      toast.success('Content copied to clipboard');
    }
  };

  const handleSaveTemplate = async () => {
    if (isInstagram) return;

    if (!generatedContent || !templateName.trim()) {
      toast.error('Please provide a template name and generate content first');
      return;
    }

    try {
      await saveTemplate({
        name: templateName,
        content_type: contentType,
        title: prompt,
        content: generatedContent
      });
      setTemplateName('');
    } catch (error) {
      // Error already handled in hook
    }
  };

  const handleSaveSequence = async () => {
    if (sequenceSteps.length === 0 || !sequenceName.trim()) {
      toast.error('Please provide a sequence name and add at least one step');
      return;
    }

    try {
      await saveSequence({
        name: sequenceName,
        content_type: contentType,
        description: `${sequenceSteps.length}-step ${contentType} sequence`,
        steps: sequenceSteps
      });
      setSequenceName('');
      setSequenceSteps([]);
    } catch (error) {
      // Error already handled in hook
    }
  };

  const addSequenceStep = () => {
    if (isInstagram) {
      if (!generatedMediaUrl) {
        toast.error('Please generate an image first');
        return;
      }

      setSequenceSteps(prev => [
        ...prev,
        {
          title: `Frame ${prev.length + 1}`,
          content: prompt || 'Instagram image',
          media_url: generatedMediaUrl,
          delay: prev.length === 0 ? 0 : 24
        }
      ]);
      setGeneratedMediaUrl('');
      setPrompt('');
      toast.success('Image added to sequence');
      return;
    }

    if (!generatedContent) {
      toast.error('Please generate content first');
      return;
    }

    setSequenceSteps(prev => [
      ...prev,
      {
        title: `Step ${prev.length + 1}`,
        content: generatedContent,
        delay: prev.length === 0 ? 0 : 24
      }
    ]);
    setGeneratedContent('');
    setPrompt('');
    toast.success('Step added to sequence');
  };

  const removeSequenceStep = (index: number) => {
    setSequenceSteps(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadImage = async (file: File) => {
    try {
      const uploadedUrl = await uploadImage(file);
      if (uploadedUrl) {
        setSourceImageUrl(uploadedUrl);
      }
    } catch (error) {
      // Error already handled in hook
    }
  };

  const handleDownloadGenerated = () => {
    if (!generatedMediaUrl) return;

    const link = document.createElement('a');
    link.href = generatedMediaUrl;
    link.download = `instagram-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleUseGeneratedAsSource = () => {
    if (!generatedMediaUrl) return;

    setSourceImageUrl(generatedMediaUrl);
    setGeneratedMediaUrl('');
  };

  const filteredTemplates = templates.filter(t => t.content_type === contentType);
  const filteredSequences = sequences.filter(s => s.content_type === contentType);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className={`grid w-full ${isInstagram ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          {!isInstagram && (
            <TabsTrigger value="templates">Templates ({filteredTemplates.length})</TabsTrigger>
          )}
          <TabsTrigger value="sequences">Sequences ({filteredSequences.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          {isInstagram ? (
            <InstagramGenerateTab
              placeholder={placeholder}
              suggestions={suggestions}
              prompt={prompt}
              context={context}
              isGenerating={isGenerating}
              sourceImageUrl={sourceImageUrl}
              generatedImageUrl={generatedMediaUrl || null}
              onPromptChange={setPrompt}
              onContextChange={setContext}
              onSuggestionClick={handleSuggestionClick}
              onGenerate={handleGenerate}
              onUploadImage={handleUploadImage}
              onClearSourceImage={() => setSourceImageUrl(null)}
              onDownloadGenerated={handleDownloadGenerated}
              onUseGeneratedAsSource={handleUseGeneratedAsSource}
              onAddSequenceStep={addSequenceStep}
            />
          ) : (
            <GenerateTab
              placeholder={placeholder}
              suggestions={suggestions}
              prompt={prompt}
              context={context}
              isGenerating={isGenerating}
              generatedContent={generatedContent}
              templateName={templateName}
              onPromptChange={setPrompt}
              onContextChange={setContext}
              onSuggestionClick={handleSuggestionClick}
              onGenerate={handleGenerate}
              onCopyContent={handleCopyContent}
              onAddSequenceStep={addSequenceStep}
              onTemplateNameChange={setTemplateName}
              onSaveTemplate={handleSaveTemplate}
            />
          )}

          <SequenceBuilder
            steps={sequenceSteps}
            sequenceName={sequenceName}
            onSequenceNameChange={setSequenceName}
            onSaveSequence={handleSaveSequence}
            onRemoveStep={removeSequenceStep}
            renderHtmlContent={!isInstagram}
          />
        </TabsContent>

        {!isInstagram && (
          <TabsContent value="templates" className="space-y-4">
            <TemplatesTab templates={filteredTemplates} onDeleteTemplate={deleteTemplate} />
          </TabsContent>
        )}

        <TabsContent value="sequences" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Your Sequences</h3>
              <p className="text-sm text-muted-foreground">
                Multi-step content sequences for {contentType} campaigns
              </p>
            </div>
          </div>
          <SequencesTab sequences={filteredSequences} onDeleteSequence={deleteSequence} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
