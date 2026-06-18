import { useState, useEffect } from "react";
import { Search, MoreHorizontal, Trash2, Edit, Mail, Eye, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TableCell } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useContacts, Contact, ContactInsert } from "@/hooks/useContacts";
import { useCompanies } from "@/hooks/useCompanies";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";
import { AddContactDialog } from "@/components/AddContactDialog";
import { EditContactDialog } from "@/components/EditContactDialog";
import { ContactFilterDialog, FilterOptions } from "@/components/ContactFilterDialog";
import { ContactDetailDialog } from "@/components/ContactDetailDialog";
import { ImportContactsDialog } from "@/components/ImportContactsDialog";
import { MobileTable } from "@/components/ui/mobile-table";
import { MobileHeader } from "@/components/ui/mobile-header";

export default function Contacts() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<FilterOptions>({ companies: [] });
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const { toast } = useToast();
  const { contacts, loading, fetchContacts, createContact, updateContact, deleteContact: deleteContactAPI } = useContacts();
  const { companies } = useCompanies();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();

  useEffect(() => {
    const loadContacts = async () => {
      if (!currentOrganization) return;
      try {
        await fetchContacts();
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to load contacts. Please try again.",
          variant: "destructive",
        });
      }
    };

    loadContacts();
  }, [fetchContacts, currentOrganization?.id]);

  // Get unique company names for filter options from the centralized companies list
  const availableCompanies = companies.map(company => company.name);

  // Apply search and filters
  const filteredContacts = contacts.filter(contact => {
    const fullName = `${contact.first_name} ${contact.last_name}`;
    const matchesSearch = 
      fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.company || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCompany = filters.companies.length === 0 || 
      (contact.company && filters.companies.includes(contact.company));
    
    return matchesSearch && matchesCompany;
  });

  const handleAddContact = async (newContactData: ContactInsert) => {
    try {
      const newContact = await createContact(newContactData);
      toast({
        title: "Contact added",
        description: `${newContact.first_name} ${newContact.last_name} has been added to your contacts.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add contact. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleImportContacts = async (importedContacts: ContactInsert[]) => {
    const createdContacts: Contact[] = [];
    const errors: string[] = [];

    for (const contactData of importedContacts) {
      try {
        const sanitized: ContactInsert = {
          first_name: contactData.first_name,
          last_name: contactData.last_name,
          email: contactData.email,
          phone: contactData.phone,
          company: contactData.company,
          position: contactData.position,
          notes: contactData.notes,
          birthday: contactData.birthday,
          anniversary: contactData.anniversary,
          personal_notes: contactData.personal_notes,
          important_dates: contactData.important_dates,
        };
        const newContact = await createContact(sanitized);
        createdContacts.push(newContact);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to import ${contactData.first_name} ${contactData.last_name}: ${message}`);
      }
    }

    if (errors.length > 0) {
      toast({
        title: "Partial import completed",
        description: `${createdContacts.length} contacts imported successfully. ${errors.length} contacts failed.\n${errors.slice(0,3).join('\n')}${errors.length>3?'\n…':''}`,
        variant: "destructive",
      });
    } else if (createdContacts.length > 0) {
      toast({
        title: "Import completed",
        description: `${createdContacts.length} contacts imported successfully.`,
      });
    }
  };

  const handleEditContact = async (id: string, updatedContactData: Partial<ContactInsert>) => {
    try {
      await updateContact(id, updatedContactData);
      toast({
        title: "Contact updated",
        description: "Contact information has been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update contact. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteContact = async (id: string) => {
    try {
      await deleteContactAPI(id);
      const contactToDelete = contacts.find(c => c.id === id);
      setDeletingContactId(null);
      toast({
        title: "Contact deleted",
        description: `${contactToDelete?.first_name} ${contactToDelete?.last_name} has been removed from your contacts.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete contact. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (contact: Contact) => {
    setEditingContact(contact);
    setIsEditDialogOpen(true);
  };

  const openDetailDialog = (contact: Contact) => {
    setViewingContact(contact);
    setIsDetailDialogOpen(true);
  };

  const handleEditFromDetail = (contact: Contact) => {
    setEditingContact(contact);
    setIsEditDialogOpen(true);
  };

  if (loading || orgLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground">
              Manage and organize your contact relationships
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderMobileCard = (contact: Contact) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src="" alt={`${contact.first_name} ${contact.last_name}`} />
            <AvatarFallback>
              {contact.first_name[0]}{contact.last_name[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <div 
              className="font-medium cursor-pointer hover:text-primary transition-colors"
              onClick={() => openDetailDialog(contact)}
            >
              {contact.first_name} {contact.last_name}
            </div>
            {contact.position && (
              <p className="text-sm text-muted-foreground">{contact.position}</p>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openDetailDialog(contact)}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEditDialog(contact)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit Contact
            </DropdownMenuItem>
            {contact.email && (
              <DropdownMenuItem>
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-destructive focus:text-destructive"
              onClick={() => setDeletingContactId(contact.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="grid grid-cols-1 gap-2 text-sm">
        {contact.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{contact.email}</span>
          </div>
        )}
        {contact.phone && (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{contact.phone}</span>
          </div>
        )}
        {contact.company && (
          <div className="flex items-center gap-2">
            <Badge variant="outline">{contact.company}</Badge>
          </div>
        )}
      </div>
    </div>
  );

  const renderRow = (contact: Contact) => (
    <>
      <TableCell>
        <div className="flex items-center space-x-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src="" alt={`${contact.first_name} ${contact.last_name}`} />
            <AvatarFallback>
              {contact.first_name[0]}{contact.last_name[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <div 
              className="font-medium cursor-pointer hover:text-primary transition-colors"
              onClick={() => openDetailDialog(contact)}
            >
              {contact.first_name} {contact.last_name}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {contact.email || '-'}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {contact.phone || '-'}
      </TableCell>
      <TableCell className="font-medium">
        {contact.company || '-'}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {contact.position || '-'}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openDetailDialog(contact)}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEditDialog(contact)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit Contact
            </DropdownMenuItem>
            {contact.email && (
              <DropdownMenuItem>
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-destructive focus:text-destructive"
              onClick={() => setDeletingContactId(contact.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </>
  );

  return (
    <div className="space-y-6">
      <MobileHeader
        title="Contacts"
        subtitle="Manage and organize your contact relationships"
        actions={
          <>
            <ImportContactsDialog onImportContacts={handleImportContacts} />
            <AddContactDialog onAddContact={handleAddContact} />
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <ContactFilterDialog 
              filters={filters}
              onFiltersChange={setFilters}
              availableCompanies={availableCompanies}
            />
          </div>
        </CardHeader>
        <CardContent>
          <MobileTable
            headers={['Contact', 'Email', 'Phone', 'Company', 'Position', '']}
            data={filteredContacts}
            renderRow={renderRow}
            renderMobileCard={renderMobileCard}
            emptyState={
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  No contacts found. Add your first contact to get started.
                </p>
              </div>
            }
          />
        </CardContent>
      </Card>

      <ContactDetailDialog
        contact={viewingContact}
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        onEdit={handleEditFromDetail}
      />

      <EditContactDialog
        contact={editingContact}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onEditContact={handleEditContact}
      />

      <AlertDialog open={deletingContactId !== null} onOpenChange={() => setDeletingContactId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deletingContactId && handleDeleteContact(deletingContactId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}