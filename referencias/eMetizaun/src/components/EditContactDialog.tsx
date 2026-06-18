import { useState, useEffect } from "react";
import { Edit, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Contact, ContactUpdate } from "@/hooks/useContacts";

interface EditContactDialogProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditContact: (id: string, contact: ContactUpdate) => void;
}

export function EditContactDialog({ 
  contact, 
  open, 
  onOpenChange, 
  onEditContact 
}: EditContactDialogProps) {
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company: "",
    position: "",
    notes: "",
    birthday: "",
    anniversary: "",
    personal_notes: "",
  });
  const [importantDates, setImportantDates] = useState<{ label: string; date: string }[]>([]);

  useEffect(() => {
    if (contact) {
      setFormData({
        first_name: contact.first_name || "",
        last_name: contact.last_name || "",
        email: contact.email || "",
        phone: contact.phone || "",
        company: contact.company || "",
        position: contact.position || "",
        notes: contact.notes || "",
        birthday: contact.birthday || "",
        anniversary: contact.anniversary || "",
        personal_notes: contact.personal_notes || "",
      });
      setImportantDates(contact.important_dates || []);
    }
  }, [contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (contact) {
      // Convert empty strings to null for nullable date fields
      const updatedData = {
        ...formData,
        birthday: formData.birthday || undefined,
        anniversary: formData.anniversary || undefined,
        important_dates: importantDates.length > 0 ? importantDates : undefined,
      };
      onEditContact(contact.id, updatedData);
      onOpenChange(false);
    }
  };

  const addImportantDate = () => {
    setImportantDates([...importantDates, { label: "", date: "" }]);
  };

  const updateImportantDate = (index: number, field: 'label' | 'date', value: string) => {
    const updated = [...importantDates];
    updated[index][field] = value;
    setImportantDates(updated);
  };

  const removeImportantDate = (index: number) => {
    setImportantDates(importantDates.filter((_, i) => i !== index));
  };

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>
            Update the contact information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Professional Information */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_first_name">First Name</Label>
                <Input
                  id="edit_first_name"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_last_name">Last Name</Label>
                <Input
                  id="edit_last_name"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_phone">Phone</Label>
              <Input
                id="edit_phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_company">Company</Label>
              <Input
                id="edit_company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_position">Position</Label>
              <Input
                id="edit_position"
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_notes">Business Notes</Label>
              <Textarea
                id="edit_notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <Separator />

          {/* Personal Information */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Personal Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_birthday">Birthday</Label>
                <Input
                  id="edit_birthday"
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_anniversary">Anniversary</Label>
                <Input
                  id="edit_anniversary"
                  type="date"
                  value={formData.anniversary}
                  onChange={(e) => setFormData({ ...formData, anniversary: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_personal_notes">Personal Notes</Label>
              <Textarea
                id="edit_personal_notes"
                value={formData.personal_notes}
                onChange={(e) => setFormData({ ...formData, personal_notes: e.target.value })}
                rows={2}
                placeholder="Personal interests, hobbies, preferences..."
              />
            </div>

            {/* Important Dates */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Important Dates</Label>
                <Button type="button" onClick={addImportantDate} size="sm" variant="outline">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Date
                </Button>
              </div>
              {importantDates.map((date, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    placeholder="Label (e.g., First Meeting)"
                    value={date.label}
                    onChange={(e) => updateImportantDate(index, 'label', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="date"
                    value={date.date}
                    onChange={(e) => updateImportantDate(index, 'date', e.target.value)}
                    className="w-40"
                  />
                  <Button
                    type="button"
                    onClick={() => removeImportantDate(index)}
                    size="sm"
                    variant="outline"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Update Contact</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}