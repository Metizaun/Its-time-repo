import { Calendar, User, Building2, Mail, Phone, FileText, Heart, Gift } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Contact } from "@/hooks/useContacts";
import { differenceInYears } from "date-fns";
import { EntityDetailDialog, DetailField, DetailList } from "@/components/ui/entity-detail-dialog";

interface ContactDetailDialogProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (contact: Contact) => void;
}

export function ContactDetailDialog({
  contact,
  open,
  onOpenChange,
  onEdit
}: ContactDetailDialogProps) {
  if (!contact) return null;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const getAge = (birthday: string) => {
    try {
      return differenceInYears(new Date(), new Date(birthday));
    } catch {
      return null;
    }
  };

  const contactFields = [
    ...(contact.email ? [{ label: "Email", value: contact.email, icon: <Mail className="h-4 w-4" /> }] : []),
    ...(contact.phone ? [{ label: "Phone", value: contact.phone, icon: <Phone className="h-4 w-4" /> }] : []),
    ...(contact.company ? [{ label: "Company", value: contact.company, icon: <Building2 className="h-4 w-4" /> }] : []),
    ...(contact.position ? [{ label: "Position", value: contact.position, icon: <User className="h-4 w-4" /> }] : []),
  ];

  const personalFields = [
    ...(contact.birthday ? [{
      label: `Birthday: ${formatDate(contact.birthday)}`,
      value: getAge(contact.birthday) ? `Age ${getAge(contact.birthday)}` : null,
      icon: <Gift className="h-4 w-4" />
    }] : []),
    ...(contact.anniversary ? [{
      label: `Anniversary: ${formatDate(contact.anniversary)}`,
      value: null,
      icon: <Calendar className="h-4 w-4" />
    }] : []),
  ];

  const importantDates = contact.important_dates && contact.important_dates.length > 0
    ? contact.important_dates.map(date => ({
      label: `${date.label}: ${formatDate(date.date)}`,
      value: null,
      icon: <Calendar className="h-3 w-3" />
    }))
    : [];

  const sections = [
    {
      title: "Contact Information",
      icon: <User className="h-5 w-5" />,
      content: <DetailList items={contactFields} />,
      show: contactFields.length > 0
    },
    {
      title: "Personal Information",
      icon: <Heart className="h-5 w-5" />,
      content: (
        <div className="space-y-4">
          <DetailList
            items={personalFields}
            emptyText="No personal information available"
          />
          {importantDates.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Important Dates</h4>
              <DetailList items={importantDates} />
            </div>
          )}
          {contact.personal_notes && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Personal Notes</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {contact.personal_notes}
              </p>
            </div>
          )}
        </div>
      ),
      show: personalFields.length > 0 || importantDates.length > 0 || !!contact.personal_notes
    },
    {
      title: "Business Notes",
      icon: <FileText className="h-5 w-5" />,
      content: (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {contact.notes}
        </p>
      ),
      show: !!contact.notes
    }
  ];

  return (
    <EntityDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${contact.first_name} ${contact.last_name}`}
      subtitle={
        contact.position && contact.company
          ? `${contact.position} at ${contact.company}`
          : contact.position || contact.company || "Contact Details"
      }
      avatar={{
        fallback: getInitials(contact.first_name, contact.last_name),
        className: "h-16 w-16"
      }}
      editButton={{
        onClick: () => onEdit(contact),
        label: "Edit"
      }}
      sections={sections}
      metadata={{
        createdAt: contact.created_at
      }}
    />
  );
}