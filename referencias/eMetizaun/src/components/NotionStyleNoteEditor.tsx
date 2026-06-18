import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Pin, Tag, Building, User, ArrowLeft } from "lucide-react";
import { Note } from "@/hooks/useNotes";
import { useContacts } from "@/hooks/useContacts";
import { useCompanies } from "@/hooks/useCompanies";

interface NotionStyleNoteEditorProps {
  note?: Note | null;
  onSave: (noteData: any) => Promise<void>;
  onCancel: () => void;
}

export const NotionStyleNoteEditor = ({ note, onSave, onCancel }: NotionStyleNoteEditorProps) => {
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    tags: "",
    is_pinned: false,
    contact_id: "",
    company_id: ""
  });

  const { contacts } = useContacts();
  const { companies } = useCompanies();

  useEffect(() => {
    if (note) {
      setFormData({
        title: note.title,
        content: note.content || "",
        tags: note.tags?.join(', ') || "",
        is_pinned: note.is_pinned || false,
        contact_id: note.contact_id || "",
        company_id: note.company_id || ""
      });
    }
  }, [note]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const noteData = {
      ...formData,
      tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
      contact_id: formData.contact_id === "none" ? null : formData.contact_id || null,
      company_id: formData.company_id === "none" ? null : formData.company_id || null
    };

    if (note) {
      await onSave({ ...noteData, id: note.id });
    } else {
      await onSave(noteData);
    }
  };

  const selectedContact = contacts?.find(c => c.id === formData.contact_id);
  const selectedCompany = companies?.find(c => c.id === formData.company_id);

  return (
    <div className="fixed inset-0 bg-background z-50 overflow-y-auto">
      <div className="min-h-screen">
        {/* Header */}
        <div className="sticky top-0 bg-background/80 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {note ? 'Update Note' : 'Save Note'}
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-6 py-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <Input
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Untitled"
                className="text-4xl font-bold border-none px-0 py-4 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
                required
              />
            </div>

            {/* Properties */}
            <div className="flex flex-wrap gap-4 py-4 border-t border-b">
              {/* Pin Toggle */}
              <div className="flex items-center space-x-2">
                <Pin className="w-4 h-4 text-muted-foreground" />
                <Switch
                  id="is_pinned"
                  checked={formData.is_pinned}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_pinned: checked }))}
                />
                <Label htmlFor="is_pinned" className="text-sm">Pinned</Label>
              </div>

              {/* Contact */}
              <div className="flex items-center space-x-2 min-w-48">
                <User className="w-4 h-4 text-muted-foreground" />
                <Select
                  value={formData.contact_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, contact_id: value }))}
                >
                  <SelectTrigger className="border-none h-8">
                    <SelectValue placeholder="Select contact" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No contact</SelectItem>
                    {contacts?.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.first_name} {contact.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Company */}
              <div className="flex items-center space-x-2 min-w-48">
                <Building className="w-4 h-4 text-muted-foreground" />
                <Select
                  value={formData.company_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, company_id: value }))}
                >
                  <SelectTrigger className="border-none h-8">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {companies?.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tags */}
              <div className="flex items-center space-x-2 min-w-64">
                <Tag className="w-4 h-4 text-muted-foreground" />
                <Input
                  value={formData.tags}
                  onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="Add tags (comma separated)"
                  className="border-none h-8"
                />
              </div>
            </div>

            {/* Selected items display */}
            {(selectedContact || selectedCompany || formData.tags) && (
              <div className="flex flex-wrap gap-2">
                {selectedContact && (
                  <Badge variant="secondary" className="gap-1">
                    <User className="w-3 h-3" />
                    {selectedContact.first_name} {selectedContact.last_name}
                  </Badge>
                )}
                {selectedCompany && (
                  <Badge variant="secondary" className="gap-1">
                    <Building className="w-3 h-3" />
                    {selectedCompany.name}
                  </Badge>
                )}
                {formData.tags && formData.tags.split(',').map(tag => tag.trim()).filter(Boolean).map((tag, index) => (
                  <Badge key={index} variant="outline" className="gap-1">
                    <Tag className="w-3 h-3" />
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Content */}
            <div>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Start writing..."
                className="min-h-[400px] border-none px-0 resize-none focus-visible:ring-0 text-base leading-7"
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};