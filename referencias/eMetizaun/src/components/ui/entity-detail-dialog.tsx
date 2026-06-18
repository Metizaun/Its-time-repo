import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Edit, Calendar, User, Building2, Mail, Phone, FileText, Heart, Gift } from "lucide-react";
import { format, differenceInYears } from "date-fns";
import { ReactNode } from "react";

interface EntityDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  avatar?: {
    src?: string;
    fallback: string;
    className?: string;
  };
  editButton?: {
    onClick: () => void;
    label?: string;
  };
  sections: {
    title: string;
    icon: ReactNode;
    content: ReactNode;
    show?: boolean;
  }[];
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    customText?: string;
  };
  children?: ReactNode;
}

export function EntityDetailDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  avatar,
  editButton,
  sections,
  metadata,
  children,
}: EntityDetailDialogProps) {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMMM d, yyyy 'at' h:mm a");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center space-x-4">
            {avatar && (
              <Avatar className={avatar.className}>
                <AvatarImage src={avatar.src} alt={title} />
                <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                  {avatar.fallback}
                </AvatarFallback>
              </Avatar>
            )}
            <div className="flex-1">
              <DialogTitle className="text-xl">{title}</DialogTitle>
              {subtitle && (
                <DialogDescription className="text-base">
                  {subtitle}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6">
            {children}

            {sections.map((section, index) => (
              section.show !== false && (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="flex items-center text-lg">
                      {section.icon}
                      <span className="ml-2">{section.title}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {section.content}
                  </CardContent>
                </Card>
              )
            ))}

            {/* Edit Button - positioned at bottom for better UX */}
            {editButton && (
              <div className="flex justify-center pt-4">
                <Button onClick={editButton.onClick} size="sm" className="min-w-[100px]">
                  <Edit className="h-4 w-4 mr-2" />
                  {editButton.label || "Edit"}
                </Button>
              </div>
            )}

            {(metadata?.createdAt || metadata?.updatedAt || metadata?.customText) && (
              <>
                <Separator />
                <div className="text-xs text-muted-foreground text-center">
                  {metadata.customText ||
                   (metadata.createdAt && `Created on ${formatDate(metadata.createdAt)}`) ||
                   (metadata.updatedAt && `Updated on ${formatDate(metadata.updatedAt)}`)}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// Helper components for consistent styling
export function DetailField({
  icon,
  label,
  value,
  className = ""
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{value}</div>
      </div>
    </div>
  );
}

export function DetailList({
  items,
  emptyText = "No items found"
}: {
  items: { label: string; value: ReactNode; icon?: ReactNode }[];
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={index} className="flex items-center space-x-3">
          {item.icon && <div className="text-muted-foreground">{item.icon}</div>}
          <div className="flex-1">
            <div className="text-sm font-medium">{item.label}</div>
            <div className="text-sm text-muted-foreground">{item.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
