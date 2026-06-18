import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) {
        setChecking(false);
        return;
      }
      try {
        // Check if user has verified TOTP factor
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const totpFactors = factorsData?.totp || [];
        const hasVerifiedTotp = totpFactors.some((f: any) => f.status === 'verified');

        // Get current AAL (authenticator assurance level)
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const isAal1 = aalData?.currentLevel === 'aal1';

        if (!active) return;
        setNeedsMfa(Boolean(hasVerifiedTotp && isAal1));
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (needsMfa) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}