import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, DollarSign, TrendingUp, Users, Eye, Edit, MoreHorizontal, Trash2, Grid3X3, LayoutGrid, AlertCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDeals, Deal, DealInsert } from "@/hooks/useDeals";
import { AddDealDialog } from "@/components/AddDealDialog";
import { EditDealDialog } from "@/components/EditDealDialog";
import { DealDetailDialog } from "@/components/DealDetailDialog";
import { DealFilterDialog, DealFilterOptions } from "@/components/DealFilterDialog";
import { DealsKanban } from "@/components/DealsKanban";
import { ImportDealsDialog } from "@/components/ImportDealsDialog";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

export default function Deals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<DealFilterOptions>({ statuses: [], stages: [] });
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewingDeal, setViewingDeal] = useState<Deal | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);
  const { toast } = useToast();
  const { fetchDeals, createDeal, updateDeal, deleteDeal: deleteDealAPI } = useDeals();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();

  useEffect(() => {
    if (!orgLoading && currentOrganization) {
      loadDeals();
    }
  }, [currentOrganization, orgLoading]);

  const loadDeals = async () => {
    try {
      setLoading(true);
      const data = await fetchDeals();
      setDeals(data);
    } catch (error) {
      console.error('Error loading deals:', error);
      toast({
        title: "Error",
        description: "Failed to load deals. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Apply search and filters
  const filteredDeals = deals.filter(deal => {
    const matchesSearch = 
      deal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (deal.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(deal.status);
    const matchesStage = filters.stages.length === 0 || filters.stages.includes(deal.stage);
    
    return matchesSearch && matchesStatus && matchesStage;
  });

  // Calculate metrics
  const totalValue = filteredDeals.reduce((sum, deal) => sum + (deal.value || 0), 0);
  const avgDealSize = filteredDeals.length > 0 ? totalValue / filteredDeals.length : 0;
  const winRate = filteredDeals.length > 0 
    ? (filteredDeals.filter(deal => deal.stage === 'Closed Won').length / filteredDeals.length) * 100 
    : 0;

  const handleAddDeal = async (newDealData: DealInsert) => {
    try {
      const newDeal = await createDeal(newDealData);
      setDeals([newDeal, ...deals]);
      toast({
        title: "Deal added",
        description: `${newDeal.title} has been added to your pipeline.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add deal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEditDeal = async (id: string, updatedDealData: Partial<DealInsert>) => {
    try {
      const updatedDeal = await updateDeal(id, updatedDealData);
      setDeals(deals.map(deal => 
        deal.id === id ? updatedDeal : deal
      ));
      toast({
        title: "Deal updated",
        description: "Deal information has been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update deal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateDeal = async (id: string, updatedDeal: Partial<Deal>) => {
    try {
      const updated = await updateDeal(id, updatedDeal);
      setDeals(deals.map(deal => 
        deal.id === id ? updated : deal
      ));
      toast({
        title: "Deal updated",
        description: `${updated.title} has been moved to ${updated.stage}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update deal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDeal = async (id: string) => {
    try {
      await deleteDealAPI(id);
      const dealToDelete = deals.find(d => d.id === id);
      setDeals(deals.filter(deal => deal.id !== id));
      setDeletingDealId(null);
      toast({
        title: "Deal deleted",
        description: `${dealToDelete?.title} has been removed from your pipeline.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete deal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (deal: Deal) => {
    setEditingDeal(deal);
    setIsEditDialogOpen(true);
  };

  const openDetailDialog = (deal: Deal) => {
    setViewingDeal(deal);
    setIsDetailDialogOpen(true);
  };

  const handleEditFromDetail = () => {
    if (viewingDeal) {
      setEditingDeal(viewingDeal);
      setIsEditDialogOpen(true);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Won':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'Lost':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'On Hold':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'Closed Won':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'Closed Lost':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'Negotiation':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'Proposal':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  if (orgLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
            <p className="text-muted-foreground">
              Manage your sales pipeline and track deal progress
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">Loading organization...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
            <p className="text-muted-foreground">
              Manage your sales pipeline and track deal progress
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center space-y-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">No organization selected</p>
              <p className="text-sm text-muted-foreground">
                Please select an organization to view deals.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
            <p className="text-muted-foreground">
              Manage your sales pipeline and track deal progress
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">Loading deals...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
          <p className="text-muted-foreground">
            Manage your sales pipeline and track deal progress
          </p>
        </div>
        <div className="flex space-x-2">
          <ImportDealsDialog onImportDeals={async (importedDeals) => {
            const errors: string[] = [];
            let success = 0;
            for (const dealData of importedDeals) {
              try {
                const sanitized: DealInsert = {
                  title: dealData.title,
                  description: dealData.description,
                  value: dealData.value,
                  status: dealData.status,
                  stage: dealData.stage,
                  probability: dealData.probability,
                  contact_id: dealData.contact_id,
                  company_id: dealData.company_id,
                  expected_close_date: dealData.expected_close_date,
                  actual_close_date: dealData.actual_close_date,
                  notes: dealData.notes,
                };
                const newDeal = await createDeal(sanitized);
                setDeals(prev => [newDeal, ...prev]);
                success++;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push(`Failed to import ${dealData.title}: ${message}`);
              }
            }
            if (errors.length > 0) {
              toast({
                title: "Partial import completed",
                description: `${success} deals imported successfully. ${errors.length} failed.\n${errors.slice(0,3).join('\n')}${errors.length>3?'\n…':''}`,
                variant: "destructive",
              });
            } else if (success > 0) {
              toast({
                title: "Import successful",
                description: `Successfully imported ${success} deals.`,
              });
            }
          }} />
          <AddDealDialog onAddDeal={handleAddDeal} />
        </div>
      </div>

      {/* Pipeline Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pipeline Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground">
              {filteredDeals.length} deals in pipeline
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Deal Size</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(avgDealSize)}</div>
            <p className="text-xs text-muted-foreground">
              Per deal average
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{winRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Closed won percentage
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline View */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search deals..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-80"
                />
              </div>
              <DealFilterDialog 
                filters={filters}
                onFiltersChange={setFilters}
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex rounded-lg border p-1">
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                  className="h-8 px-3"
                >
                  <Grid3X3 className="h-4 w-4 mr-2" />
                  Table
                </Button>
                <Button
                  variant={viewMode === "kanban" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("kanban")}
                  className="h-8 px-3"
                >
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  Kanban
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "kanban" ? (
            <DealsKanban
              deals={filteredDeals}
              loading={loading}
              onUpdateDeal={async (dealId, updates) => {
                try {
                  const updated = await updateDeal(dealId, updates);
                  setDeals(deals.map(d => d.id === dealId ? updated : d));
                  toast({
                    title: "Deal updated",
                    description: `Deal has been updated successfully.`,
                  });
                  return updated;
                } catch (error) {
                  console.error('Error updating deal:', error);
                  toast({
                    title: "Error",
                    description: "Failed to update deal. Please try again.",
                    variant: "destructive",
                  });
                  throw error;
                }
              }}
              onEditDeal={(deal) => openEditDialog(deal)}
              onViewDeal={(deal) => openDetailDialog(deal)}
              onDeleteDeal={async (dealId) => {
                try {
                  await deleteDealAPI(dealId);
                  setDeals(deals.filter(d => d.id !== dealId));
                  toast({
                    title: "Deal deleted",
                    description: "Deal has been deleted successfully.",
                  });
                } catch (error) {
                  console.error('Error deleting deal:', error);
                  toast({
                    title: "Error",
                    description: "Failed to delete deal. Please try again.",
                    variant: "destructive",
                  });
                }
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Probability</TableHead>
                  <TableHead>Close Date</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex flex-col items-center space-y-4">
                        <p className="text-muted-foreground">No deals found.</p>
                        {deals.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Add your first deal to get started with your sales pipeline.
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Try adjusting your search or filters.
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDeals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell>
                        <div>
                          <div 
                            className="font-medium cursor-pointer hover:text-primary transition-colors"
                            onClick={() => openDetailDialog(deal)}
                          >
                            {deal.title}
                          </div>
                          {deal.description && (
                            <div className="text-sm text-muted-foreground truncate max-w-xs">
                              {deal.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {deal.value ? formatCurrency(deal.value) : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStageColor(deal.stage)}>
                          {deal.stage}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(deal.status)}>
                          {deal.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {deal.probability !== undefined ? `${deal.probability}%` : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(deal.expected_close_date)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetailDialog(deal)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEditDialog(deal)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit Deal
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeletingDealId(deal.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Deal
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DealDetailDialog
        deal={viewingDeal}
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        onEdit={handleEditFromDetail}
      />

      <EditDealDialog
        deal={editingDeal}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onEditDeal={handleEditDeal}
      />

      <AlertDialog open={deletingDealId !== null} onOpenChange={() => setDeletingDealId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this deal? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deletingDealId && handleDeleteDeal(deletingDealId)}
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