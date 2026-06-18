import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search, Building2, User, DollarSign, CheckSquare, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useContacts } from '@/hooks/useContacts';
import { useCompanies } from '@/hooks/useCompanies';
import { useDeals } from '@/hooks/useDeals';
import { useTasks } from '@/hooks/useTasks';
import { MobileHeader } from '@/components/ui/mobile-header';
import { useBreakpoint } from '@/hooks/use-mobile';

type SearchResult = {
  id: string;
  type: 'contact' | 'company' | 'deal' | 'task';
  [key: string]: any;
};

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [searchTerm, setSearchTerm] = useState(query);
  const [activeTab, setActiveTab] = useState('all');
  const { isMobile } = useBreakpoint();
  
  // State for real data
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Hooks to fetch data
  const { fetchContacts } = useContacts();
  const { fetchCompanies } = useCompanies();
  const { fetchDeals } = useDeals();
  const { fetchTasks } = useTasks();

  // Load all data on component mount
  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);
      try {
        const [contactsData, companiesData, dealsData, tasksData] = await Promise.all([
          fetchContacts().catch(() => []),
          fetchCompanies().catch(() => []), 
          fetchDeals().catch(() => []),
          fetchTasks().catch(() => [])
        ]);
        
        setContacts(contactsData || []);
        setCompanies(companiesData || []);
        setDeals(dealsData || []);
        setTasks(tasksData || []);
      } catch (error) {
        console.error('Error loading search data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, [fetchContacts, fetchCompanies, fetchDeals, fetchTasks]);

  // Transform data to searchable format
  const searchableContacts = (contacts || []).map(contact => ({
    ...contact,
    type: 'contact' as const,
    name: `${contact.first_name} ${contact.last_name}`.trim(),
    searchText: `${contact.first_name} ${contact.last_name} ${contact.email || ''} ${contact.company || ''} ${contact.phone || ''}`.toLowerCase()
  }));

  const searchableCompanies = (companies || []).map(company => ({
    ...company,
    type: 'company' as const,
    searchText: `${company.name} ${company.industry || ''} ${company.website || ''} ${company.email || ''}`.toLowerCase()
  }));

  const searchableDeals = (deals || []).map(deal => ({
    ...deal,
    type: 'deal' as const,
    searchText: `${deal.title} ${deal.description || ''} ${deal.stage} ${deal.status}`.toLowerCase()
  }));

  const searchableTasks = (tasks || []).map(task => ({
    ...task,
    type: 'task' as const,
    searchText: `${task.title} ${task.description || ''} ${task.priority} ${task.status}`.toLowerCase()
  }));

  const allResults: SearchResult[] = [
    ...searchableContacts,
    ...searchableCompanies,
    ...searchableDeals,
    ...searchableTasks
  ];

  const filteredResults = allResults.filter(item => {
    if (!searchTerm.trim()) return true;
    return item.searchText.includes(searchTerm.toLowerCase());
  });

  const resultsByType = {
    all: filteredResults,
    contacts: filteredResults.filter(item => item.type === 'contact'),
    companies: filteredResults.filter(item => item.type === 'company'),
    deals: filteredResults.filter(item => item.type === 'deal'),
    tasks: filteredResults.filter(item => item.type === 'task')
  };

  const handleSearch = (newQuery: string) => {
    setSearchTerm(newQuery);
    setSearchParams({ q: newQuery });
  };

  useEffect(() => {
    setSearchTerm(query);
  }, [query]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'contact':
        return <User className="h-4 w-4" />;
      case 'company':
        return <Building2 className="h-4 w-4" />;
      case 'deal':
        return <DollarSign className="h-4 w-4" />;
      case 'task':
        return <CheckSquare className="h-4 w-4" />;
      default:
        return <Search className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'contact':
        return 'bg-blue-100 text-blue-800';
      case 'company':
        return 'bg-green-100 text-green-800';
      case 'deal':
        return 'bg-purple-100 text-purple-800';
      case 'task':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const renderResult = (result: SearchResult) => {
    return (
      <Card key={`${result.type}-${result.id}`} className="hover:shadow-md transition-shadow">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="mt-1">
                {getTypeIcon(result.type)}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="font-medium">
                    {result.name || result.title}
                  </h3>
                  <Badge className={getTypeColor(result.type)} variant="secondary">
                    {result.type}
                  </Badge>
                </div>
                
                {result.type === 'contact' && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{result.email}</p>
                    {result.company && <p>{result.company}</p>}
                    {result.phone && <p>{result.phone}</p>}
                  </div>
                )}
                
                {result.type === 'company' && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    {result.industry && <p>Industry: {result.industry}</p>}
                    {result.website && <p>Website: {result.website}</p>}
                    {result.email && <p>Email: {result.email}</p>}
                  </div>
                )}
                
                {result.type === 'deal' && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    {result.description && <p>{result.description}</p>}
                    {result.value && <p>Value: ${Number(result.value).toLocaleString()}</p>}
                    <p>Stage: {result.stage}</p>
                  </div>
                )}
                
                {result.type === 'task' && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    {result.description && <p>{result.description}</p>}
                    <p>Priority: {result.priority}</p>
                    <p>Status: {result.status}</p>
                    {result.due_date && <p>Due: {new Date(result.due_date).toLocaleDateString()}</p>}
                  </div>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/${result.type === 'contact' ? 'contacts' : result.type === 'company' ? 'companies' : result.type === 'deal' ? 'deals' : 'tasks'}`}>
                View
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
      <div className="space-y-6">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search contacts, companies, deals..."
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    className={`pl-10 ${isMobile ? 'h-10 text-base' : 'text-lg h-12'}`}
                    autoFocus={isMobile}
                  />
                </div>
              </div>
              {!isMobile && (
                <Button variant="outline" size="icon">
                  <Filter className="h-4 w-4" />
                </Button>
              )}
            </div>

            {searchTerm && (
              <MobileHeader
                title={`Search Results`}
                subtitle={`Found ${filteredResults.length} results for "${searchTerm}"`}
              />
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className={`${isMobile ? 'grid w-full grid-cols-2' : ''}`}>
                <TabsTrigger value="all">
                  All ({resultsByType.all.length})
                </TabsTrigger>
                <TabsTrigger value="contacts">
                  Contacts ({resultsByType.contacts.length})
                </TabsTrigger>
                {!isMobile && (
                  <>
                    <TabsTrigger value="companies">
                      Companies ({resultsByType.companies.length})
                    </TabsTrigger>
                    <TabsTrigger value="deals">
                      Deals ({resultsByType.deals.length})
                    </TabsTrigger>
                    <TabsTrigger value="tasks">
                      Tasks ({resultsByType.tasks.length})
                    </TabsTrigger>
                  </>
                )}
              </TabsList>
              
              {isMobile && (
                <div className="flex gap-2 mt-2 overflow-x-auto">
                  <Button 
                    variant={activeTab === 'companies' ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setActiveTab('companies')}
                  >
                    Companies ({resultsByType.companies.length})
                  </Button>
                  <Button 
                    variant={activeTab === 'deals' ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setActiveTab('deals')}
                  >
                    Deals ({resultsByType.deals.length})
                  </Button>
                  <Button 
                    variant={activeTab === 'tasks' ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setActiveTab('tasks')}
                  >
                    Tasks ({resultsByType.tasks.length})
                  </Button>
                </div>
              )}

              {Object.entries(resultsByType).map(([type, results]) => (
                <TabsContent key={type} value={type} className="space-y-4">
                  {results.length === 0 ? (
                    <Card>
                      <CardContent className="pt-6 text-center">
                        <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium">No results found</h3>
                        <p className="text-muted-foreground">
                          {searchTerm ? "Try adjusting your search terms or browse other categories" : "Enter a search term above to find contacts, companies, deals, and tasks"}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    results.map(renderResult)
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </div>
  );
}