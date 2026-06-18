import { useState, useEffect } from "react";
import { Edit, Globe, MapPin, User, Calendar, FileText, Plus, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Partner, PartnerContract, usePartners } from "@/hooks/usePartners";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

import { AddPartnerContractDialog } from "@/components/AddPartnerContractDialog";
import { EditPartnerContractDialog } from "@/components/EditPartnerContractDialog";

interface PartnerDetailDialogProps {
  partner: Partner | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (partner: Partner) => void;
}

export function PartnerDetailDialog({ partner, open, onOpenChange, onEdit }: PartnerDetailDialogProps) {
  const [contracts, setContracts] = useState<PartnerContract[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [editingContract, setEditingContract] = useState<PartnerContract | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { fetchPartnerContracts, downloadContractFile } = usePartners();
  const { toast } = useToast();

  useEffect(() => {
    if (partner && open) {
      loadContracts();
    }
  }, [partner, open]);

  const loadContracts = async () => {
    if (!partner) return;
    
    try {
      setLoadingContracts(true);
      const data = await fetchPartnerContracts(partner.id);
      setContracts(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load partner contracts.",
        variant: "destructive",
      });
    } finally {
      setLoadingContracts(false);
    }
  };

  const handleDownloadFile = async (filePath: string, fileName: string) => {
    try {
      const blob = await downloadContractFile(filePath);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download file.",
        variant: "destructive",
      });
    }
  };

  const handleEditContract = (contract: PartnerContract) => {
    setEditingContract(contract);
    setShowEditDialog(true);
  };

  const handleContractUpdated = () => {
    loadContracts();
    setShowEditDialog(false);
    setEditingContract(null);
  };

  if (!partner) return null;

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

  const getContractStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return <Badge variant="default">Active</Badge>;
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
      case 'terminated':
        return <Badge variant="secondary">Terminated</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatCurrency = (amount?: number, currency = 'USD') => {
    if (!amount) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    return format(new Date(dateString), 'MMM d, yyyy');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl">{partner.name}</DialogTitle>
              {partner.company_name && (
                <DialogDescription className="text-lg text-muted-foreground">
                  {partner.company_name}
                </DialogDescription>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant={getStatusBadgeVariant(partner.status)}>
                {partner.status.charAt(0).toUpperCase() + partner.status.slice(1)}
              </Badge>
              <Button size="sm" onClick={() => onEdit(partner)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <User className="h-5 w-5" />
                <span>Contact Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {partner.email && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                    <p className="text-sm">{partner.email}</p>
                  </div>
                )}
                {partner.phone && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Phone</p>
                    <p className="text-sm">{partner.phone}</p>
                  </div>
                )}
                {partner.website && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Website</p>
                    <p className="text-sm flex items-center space-x-1">
                      <Globe className="h-3 w-3" />
                      <span>{partner.website}</span>
                    </p>
                  </div>
                )}
                {partner.contact_person && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Contact Person</p>
                    <p className="text-sm">{partner.contact_person}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Partnership Details */}
          <Card>
            <CardHeader>
              <CardTitle>Partnership Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                {partner.partnership_type && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Partnership Type</p>
                    <Badge variant="outline">
                      {partner.partnership_type.charAt(0).toUpperCase() + partner.partnership_type.slice(1)}
                    </Badge>
                  </div>
                )}
                {partner.industry && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Industry</p>
                    <p className="text-sm">{partner.industry}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Location Information */}
          {(partner.address || partner.city || partner.state || partner.country) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <MapPin className="h-5 w-5" />
                  <span>Location</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {partner.address && <p className="text-sm">{partner.address}</p>}
                  {(partner.city || partner.state || partner.postal_code) && (
                    <p className="text-sm">
                      {[partner.city, partner.state, partner.postal_code].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {partner.country && <p className="text-sm">{partner.country}</p>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {partner.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{partner.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Partner Contracts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>Contracts ({contracts.length})</span>
                </div>
                <AddPartnerContractDialog 
                  partnerId={partner.id} 
                  onContractAdded={loadContracts}
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingContracts ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No contracts found for this partner.
                </p>
              ) : (
                <div className="space-y-4">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium">{contract.title}</h4>
                            {getContractStatusBadge(contract.status)}
                          </div>
                          {contract.contract_type && (
                            <p className="text-sm text-muted-foreground">
                              Type: {contract.contract_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </p>
                          )}
                          {contract.contract_value && (
                            <p className="text-sm text-muted-foreground">
                              Value: {formatCurrency(contract.contract_value, contract.currency)}
                            </p>
                          )}
                          <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                            {contract.start_date && (
                              <span>Start: {formatDate(contract.start_date)}</span>
                            )}
                            {contract.end_date && (
                              <span>End: {formatDate(contract.end_date)}</span>
                            )}
                          </div>
                          {contract.file_url && (
                            <div className="flex items-center space-x-1 text-xs text-primary">
                              <FileText className="h-3 w-3" />
                              <span>Document attached</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditContract(contract)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {contract.file_url && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadFile(contract.file_url!, `${contract.title}.pdf`)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {contract.description && (
                        <>
                          <Separator className="my-3" />
                          <p className="text-sm text-muted-foreground">{contract.description}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Calendar className="h-5 w-5" />
                <span>Timeline</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Created</p>
                  <p>{format(new Date(partner.created_at), 'MMM d, yyyy')}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Last Updated</p>
                  <p>{format(new Date(partner.updated_at), 'MMM d, yyyy')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>

      <EditPartnerContractDialog
        contract={editingContract}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onContractUpdated={handleContractUpdated}
      />
    </Dialog>
  );
}