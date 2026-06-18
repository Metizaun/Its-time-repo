import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useOrganizations, Organization } from './useOrganizations';
import { useAuth } from './useAuth';

interface OrganizationContextType {
  currentOrganization: Organization | null;
  organizations: Organization[];
  setCurrentOrganization: (org: Organization) => void;
  loading: boolean;
  refetchOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { user } = useAuth();
  const { fetchUserOrganizations } = useOrganizations();

  // Use useCallback to memoize loadOrganizations and avoid re-creating it on every render
  const loadOrganizations = useCallback(async () => {
    if (!user) {
      console.log('OrganizationContext: No user logged in, skipping organization load');
      return;
    }

    try {
      setLoading(true);
      console.log('OrganizationContext: Loading organizations for user:', user.email, 'ID:', user.id);
      
      const orgs = await fetchUserOrganizations();
      console.log('OrganizationContext: Found organizations:', orgs);
      
      setOrganizations(orgs);

      // Ensure current organization belongs to the signed-in user
      if (orgs.length > 0) {
        const stillValid = currentOrganization && orgs.some(o => o.id === currentOrganization.id);
        if (!stillValid) {
          console.log('OrganizationContext: Setting current organization to:', orgs[0]);
          setCurrentOrganization(orgs[0]);
        }
      } else {
        console.warn('OrganizationContext: No organizations found for user:', user.email);
        setCurrentOrganization(null);
      }
    } catch (error) {
      console.error('OrganizationContext: Error loading organizations:', error);
      // Optionally set organizations to empty array on error
      setOrganizations([]);
      setCurrentOrganization(null);
    } finally {
      setLoading(false);
    }
  }, [user, fetchUserOrganizations, currentOrganization]);

  useEffect(() => {
    if (!user?.id) {
      setOrganizations([]);
      setCurrentOrganization(null);
      setLoading(false);
      return;
    }
  
    loadOrganizations();
  }, [user?.id]);
  

  const refetchOrganizations = useCallback(async () => {
    await loadOrganizations();
  }, [loadOrganizations]);

  return (
    <OrganizationContext.Provider value={{
      currentOrganization,
      organizations,
      setCurrentOrganization,
      loading,
      refetchOrganizations
    }}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganizationContext() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganizationContext must be used within an OrganizationProvider');
  }
  return context;
}