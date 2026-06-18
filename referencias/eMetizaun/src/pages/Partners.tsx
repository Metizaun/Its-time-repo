import { useState, useEffect } from "react";
import { Search, MoreHorizontal, Trash2, Edit, Handshake, Globe, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { usePartners, Partner, PartnerInsert } from "@/hooks/usePartners";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";
import { AddPartnerDialog } from "@/components/AddPartnerDialog";
import { EditPartnerDialog } from "@/components/EditPartnerDialog";
import { PartnerDetailDialog } from "@/components/PartnerDetailDialog";

interface PartnerFilterOptions {
  types: string[];
  statuses: string[];
}

export default function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<PartnerFilterOptions>({ types: [], statuses: [] });
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewingPartner, setViewingPartner] = useState<Partner | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [deletingPartnerId, setDeletingPartnerId] = useState<string | null>(null);
  const { toast } = useToast();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();
  const { fetchPartners, createPartner, updatePartner, deletePartner: deletePartnerAPI } = usePartners();

  useEffect(() => {
    if (currentOrganization && !orgLoading) {
      loadPartners();
    }
  }, [currentOrganization, orgLoading]);

  const loadPartners = async () => {
    try {
      setLoading(true);
      const data = await fetchPartners();
      setPartners(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load partners. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Apply search and filters
  const filteredPartners = partners.filter(partner => {
    const matchesSearch = 
      partner.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (partner.company_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (partner.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (partner.industry || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = filters.types.length === 0 || 
      (partner.partnership_type && filters.types.includes(partner.partnership_type));
    
    const matchesStatus = filters.statuses.length === 0 || 
      filters.statuses.includes(partner.status);
    
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleAddPartner = async (newPartnerData: PartnerInsert) => {
    try {
      const newPartner = await createPartner(newPartnerData);
      setPartners([newPartner, ...partners]);
      toast({
        title: "Partner added",
        description: `${newPartner.name} has been added to your partners.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add partner. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEditPartner = async (id: string, updatedPartnerData: Partial<PartnerInsert>) => {
    try {
      const updatedPartner = await updatePartner(id, updatedPartnerData);
      setPartners(partners.map(partner => 
        partner.id === id ? updatedPartner : partner
      ));
      toast({
        title: "Partner updated",
        description: "Partner information has been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update partner. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeletePartner = async (id: string) => {
    try {
      await deletePartnerAPI(id);
      const partnerToDelete = partners.find(p => p.id === id);
      setPartners(partners.filter(partner => partner.id !== id));
      setDeletingPartnerId(null);
      toast({
        title: "Partner deleted",
        description: `${partnerToDelete?.name} has been removed from your partners.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete partner. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (partner: Partner) => {
    setEditingPartner(partner);
    setIsEditDialogOpen(true);
  };

  const openDetailDialog = (partner: Partner) => {
    setViewingPartner(partner);
    setIsDetailDialogOpen(true);
  };

  const handleEditFromDetail = (partner: Partner) => {
    setEditingPartner(partner);
    setIsEditDialogOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'default';
      case 'inactive':
        return 'secondary';
      case 'pending':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getPartnershipTypeBadge = (type?: string) => {
    if (!type) return null;
    
    const colors = {
      technology: 'bg-blue-100 text-blue-800',
      vendor: 'bg-green-100 text-green-800',
      distributor: 'bg-purple-100 text-purple-800',
      strategic: 'bg-orange-100 text-orange-800',
    };

    return (
      <Badge variant="outline" className={colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800'}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </Badge>
    );
  };

  if (loading || orgLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Partners</h1>
            <p className="text-muted-foreground">
              Manage your business partnerships and contracts
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Partners</h1>
          <p className="text-muted-foreground">
            Manage your business partnerships and contracts
          </p>
        </div>
        <div className="flex space-x-2">
          <AddPartnerDialog onAddPartner={handleAddPartner} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search partners..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPartners.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No partners found. Add your first partner to get started.
                  </TableCell>
                </TableRow>
              ) : (
                filteredPartners.map((partner) => (
                  <TableRow key={partner.id}>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
                          <Handshake className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div 
                            className="font-medium cursor-pointer hover:text-primary transition-colors"
                            onClick={() => openDetailDialog(partner)}
                          >
                            {partner.name}
                          </div>
                          {partner.company_name && (
                            <div className="text-sm text-muted-foreground">
                              {partner.company_name}
                            </div>
                          )}
                          {partner.website && (
                            <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                              <Globe className="h-3 w-3" />
                              <span>{partner.website}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getPartnershipTypeBadge(partner.partnership_type)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {partner.email && (
                          <div className="text-sm text-muted-foreground">{partner.email}</div>
                        )}
                        {partner.phone && (
                          <div className="text-sm text-muted-foreground">{partner.phone}</div>
                        )}
                        {!partner.email && !partner.phone && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(partner.status)}>
                        {partner.status.charAt(0).toUpperCase() + partner.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDetailDialog(partner)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(partner)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Partner
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletingPartnerId(partner.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Partner
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PartnerDetailDialog
        partner={viewingPartner}
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        onEdit={handleEditFromDetail}
      />

      <EditPartnerDialog
        partner={editingPartner}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onEditPartner={handleEditPartner}
      />

      <AlertDialog open={deletingPartnerId !== null} onOpenChange={() => setDeletingPartnerId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Partner</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this partner? This action cannot be undone and will also delete all associated contracts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deletingPartnerId && handleDeletePartner(deletingPartnerId)}
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