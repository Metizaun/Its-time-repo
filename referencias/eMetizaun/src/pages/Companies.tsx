import { useState, useEffect } from "react";
import { Search, MoreHorizontal, Trash2, Edit, Building2, Users, DollarSign, Eye, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { useCompanies, Company, CompanyInsert } from "@/hooks/useCompanies";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";
import { AddCompanyDialog } from "@/components/AddCompanyDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { CompanyFilterDialog, CompanyFilterOptions } from "@/components/CompanyFilterDialog";
import { CompanyDetailDialog } from "@/components/CompanyDetailDialog";
import { ImportCompaniesDialog } from "@/components/ImportCompaniesDialog";

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<CompanyFilterOptions>({ industries: [] });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewingCompany, setViewingCompany] = useState<Company | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const { toast } = useToast();
  const { fetchCompanies, createCompany, updateCompany, deleteCompany: deleteCompanyAPI } = useCompanies();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();

  useEffect(() => {
    if (currentOrganization) {
      loadCompanies();
    }
  }, [currentOrganization?.id]);

  const loadCompanies = async () => {
    if (!currentOrganization) return;
    try {
      setLoading(true);
      const data = await fetchCompanies();
      setCompanies(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load companies. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Get unique industries for filter options
  const availableIndustries = [...new Set(companies.map(company => company.industry || '').filter(Boolean))];

  // Apply search and filters
  const filteredCompanies = companies.filter(company => {
    const matchesSearch = 
      company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (company.industry || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (company.email || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesIndustry = filters.industries.length === 0 || 
      (company.industry && filters.industries.includes(company.industry));
    
    return matchesSearch && matchesIndustry;
  });

  const handleAddCompany = async (newCompanyData: CompanyInsert) => {
    try {
      const newCompany = await createCompany(newCompanyData);
      setCompanies([newCompany, ...companies]);
      toast({
        title: "Company added",
        description: `${newCompany.name} has been added to your companies.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add company. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Ensure we never send non-table fields (like errors/rowNumber) to the DB
  const sanitizeCompanyInsert = (input: any): CompanyInsert => {
    return {
      name: input.name,
      industry: input.industry,
      website: input.website,
      phone: input.phone,
      email: input.email,
      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      postal_code: input.postal_code,
      employee_count: input.employee_count,
      annual_revenue: input.annual_revenue,
      notes: input.notes,
    } as CompanyInsert;
  };

  const handleImportCompanies = async (importedCompanies: CompanyInsert[]) => {
    const createdCompanies: Company[] = [];
    const errors: string[] = [];

    console.log('Starting import of companies:', importedCompanies); // Debug log

    for (const companyData of importedCompanies) {
      try {
        const sanitized = sanitizeCompanyInsert(companyData as any);
        const newCompany = await createCompany(sanitized);
        createdCompanies.push(newCompany);
        console.log('Successfully imported:', newCompany.name); // Debug log
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Error importing company:', companyData.name, message);
        errors.push(`Failed to import ${companyData.name}: ${message}`);
      }
    }

    // Refresh the entire companies list from database to ensure consistency
    await loadCompanies();

    if (errors.length > 0) {
      toast({
        title: "Partial import completed",
        description: `${createdCompanies.length} companies imported successfully. ${errors.length} companies failed.\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n…' : ''}`,
        variant: "destructive",
      });
    } else if (createdCompanies.length > 0) {
      // Add success toast when all companies are imported successfully
      toast({
        title: "Import successful",
        description: `Successfully imported ${createdCompanies.length} companies.`,
      });
    } else {
      // No companies were imported
      toast({
        title: "No companies imported",
        description: "No valid companies were found in the CSV file.",
        variant: "destructive",
      });
    }
  };

  const handleEditCompany = async (id: string, updatedCompanyData: Partial<CompanyInsert>) => {
    try {
      const updatedCompany = await updateCompany(id, updatedCompanyData);
      setCompanies(companies.map(company => 
        company.id === id ? updatedCompany : company
      ));
      toast({
        title: "Company updated",
        description: "Company information has been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update company. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCompany = async (id: string) => {
    try {
      await deleteCompanyAPI(id);
      const companyToDelete = companies.find(c => c.id === id);
      setCompanies(companies.filter(company => company.id !== id));
      setDeletingCompanyId(null);
      toast({
        title: "Company deleted",
        description: `${companyToDelete?.name} has been removed from your companies.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete company. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (company: Company) => {
    setEditingCompany(company);
    setIsEditDialogOpen(true);
  };

  const openDetailDialog = (company: Company) => {
    setViewingCompany(company);
    setIsDetailDialogOpen(true);
  };

  const handleEditFromDetail = (company: Company) => {
    setEditingCompany(company);
    setIsEditDialogOpen(true);
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatEmployeeCount = (count?: number) => {
    if (!count) return null;
    return count.toLocaleString();
  };

  if (loading || orgLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
            <p className="text-muted-foreground">
              Manage and organize your company relationships
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
          <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
          <p className="text-muted-foreground">
            Manage and organize your company relationships
          </p>
        </div>
        <div className="flex space-x-2">
          <ImportCompaniesDialog onImportCompanies={handleImportCompanies} />
          <AddCompanyDialog onAddCompany={handleAddCompany} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search companies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <CompanyFilterDialog 
              filters={filters}
              onFiltersChange={setFilters}
              availableIndustries={availableIndustries}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No companies found. Add your first company to get started.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCompanies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div 
                            className="font-medium cursor-pointer hover:text-primary transition-colors"
                            onClick={() => openDetailDialog(company)}
                          >
                            {company.name}
                          </div>
                          {company.website && (
                            <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                              <Globe className="h-3 w-3" />
                              <span>{company.website}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.industry || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {company.email && (
                          <div className="text-sm text-muted-foreground">{company.email}</div>
                        )}
                        {company.phone && (
                          <div className="text-sm text-muted-foreground">{company.phone}</div>
                        )}
                        {!company.email && !company.phone && (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.employee_count ? (
                        <div className="flex items-center space-x-1">
                          <Users className="h-4 w-4" />
                          <span>{formatEmployeeCount(company.employee_count)}</span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.annual_revenue ? (
                        <div className="flex items-center space-x-1">
                          <DollarSign className="h-4 w-4" />
                          <span>{formatCurrency(company.annual_revenue)}</span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDetailDialog(company)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(company)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Company
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletingCompanyId(company.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Company
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

      <CompanyDetailDialog
        company={viewingCompany}
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
        onEdit={handleEditFromDetail}
      />

      <EditCompanyDialog
        company={editingCompany}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onEditCompany={handleEditCompany}
      />

      <AlertDialog open={deletingCompanyId !== null} onOpenChange={() => setDeletingCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Company</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this company? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deletingCompanyId && handleDeleteCompany(deletingCompanyId)}
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