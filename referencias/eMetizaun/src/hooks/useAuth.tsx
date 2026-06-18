import * as React from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  mfaChallenge: string | null;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updatePassword: (password: string, mfaCode?: string) => Promise<{ error: any; requiresMfa: boolean }>;
  verifyMfa: (factorId: string, challengeId: string, code: string) => Promise<{ error: any }>;
  enrollMfa: (factorName: string) => Promise<{ data: any | null; error: any }>;
  challengeMfa: (factorId: string) => Promise<{ data: any; error: any }>;
  unenrollMfa: (factorId: string) => Promise<{ error: any }>;
  getMfaFactors: () => Promise<{ data: any; error: any }>;
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mfaChallenge, setMfaChallenge] = React.useState<string | null>(null);
  const { toast } = useToast();

  React.useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          display_name: displayName
        }
      }
    });

    if (error) {
      toast({
        title: "Sign Up Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Account Created!",
        description: "You can now sign in with your credentials.",
      });
    }

    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Check if it's an MFA challenge
      if (error.message === 'MFA challenge expired' || error.message?.includes('MFA')) {
        // Handle MFA challenge separately
        return { error, needsMfa: true };
      }
      
      toast({
        title: "Sign In Failed",
        description: error.message,
        variant: "destructive",
      });
    } else if (data.session) {
      toast({
        title: "Welcome back!",
        description: "Successfully signed in.",
      });
    }

    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Sign Out Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Signed Out",
        description: "You have been successfully signed out.",
      });
    }
  };

  const resetPassword = async (email: string) => {
    const redirectUrl = `${window.location.origin}/reset-password`;
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    if (error) {
      toast({
        title: "Password Reset Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Check Your Email",
        description: "We've sent you a password reset link.",
      });
    }

    return { error };
  };

  const updatePassword = async (password: string, mfaCode?: string) => {
    // Check if user has MFA enabled
    const { data: factors } = await getMfaFactors();
    const hasMfa = factors?.totp && factors.totp.length > 0;

    if (hasMfa && mfaCode) {
      // User has MFA and provided a code, verify it first to get AAL2
      const factorId = factors.totp[0].id;
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) {
        toast({
          title: "MFA Challenge Failed",
          description: challengeError.message,
          variant: "destructive",
        });
        return { error: challengeError, requiresMfa: true };
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });

      if (verifyError) {
        toast({
          title: "Invalid 2FA Code",
          description: "Please check your authenticator app and try again.",
          variant: "destructive",
        });
        return { error: verifyError, requiresMfa: true };
      }
    } else if (hasMfa && !mfaCode) {
      // User has MFA but didn't provide a code
      return { error: null, requiresMfa: true };
    }

    // Now update the password
    const { error } = await supabase.auth.updateUser({
      password: password
    });

    if (error) {
      toast({
        title: "Password Update Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Password Updated",
        description: "Your password has been successfully updated.",
      });
    }

    return { error, requiresMfa: false };
  };

  // MFA Methods
  const enrollMfa = async (factorName: string) => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: factorName,
    });

    if (error) {
      toast({
        title: "MFA Enrollment Failed",
        description: error.message,
        variant: "destructive",
      });
    }

    return { data, error };
  };

  const verifyMfa = async (factorId: string, challengeId: string, code: string) => {
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });

    if (error) {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Verification Successful",
        description: "Successfully verified two-factor authentication.",
      });
      setMfaChallenge(null);
    }

    return { data, error };
  };

  const challengeMfa = async (factorId: string) => {
    const { data, error } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (error) {
      toast({
        title: "Challenge Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setMfaChallenge(data.id);
    }

    return { data, error };
  };

  const unenrollMfa = async (factorId: string) => {
    const { data, error } = await supabase.auth.mfa.unenroll({
      factorId,
    });

    if (error) {
      toast({
        title: "Unenroll Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "2FA Disabled",
        description: "Two-factor authentication has been disabled.",
      });
    }

    return { data, error };
  };

  const getMfaFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    
    if (error) {
      console.error('Error fetching MFA factors:', error);
    }

    return { data, error };
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      mfaChallenge,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      verifyMfa,
      enrollMfa,
      challengeMfa,
      unenrollMfa,
      getMfaFactors,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}