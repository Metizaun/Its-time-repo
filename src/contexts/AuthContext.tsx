import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type UserRole = "NENHUM" | "VENDEDOR" | "ADMIN";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userRole: UserRole | null;
  profileName: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  isPendingApproval: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseAcesId(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const claimsRefreshAttemptRef = useRef<string | null>(null);

  const fetchUserProfileBackground = async (userId: string, currentSession?: Session | null) => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, aces_id, role, name")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (!error && data) {
        setUserRole(data.role as UserRole);
        setProfileName(data.name ?? null);

        const appMetadata = currentSession?.user?.app_metadata ?? {};
        const tokenAcesId = parseAcesId(appMetadata.aces_id);
        const claimsOutOfSync =
          appMetadata.crm_user_id !== data.id ||
          appMetadata.crm_role !== data.role ||
          tokenAcesId !== data.aces_id;

        if (!claimsOutOfSync) {
          claimsRefreshAttemptRef.current = null;
          return;
        }

        const refreshKey = `${userId}:${data.id}:${data.aces_id}:${data.role}`;
        if (currentSession?.refresh_token && claimsRefreshAttemptRef.current !== refreshKey) {
          claimsRefreshAttemptRef.current = refreshKey;
          await supabase.auth.refreshSession();
        }

        return;
      }

      if (!error && !data) {
        claimsRefreshAttemptRef.current = null;
        setUserRole(null);
      }
    } catch (error) {
      console.error("Erro silencioso ao buscar perfil:", error);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (mounted) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          setProfileName(currentSession?.user?.user_metadata?.name ?? null);
          setLoading(false);

          if (currentSession?.user) {
            fetchUserProfileBackground(currentSession.user.id, currentSession);
          }
        }
      } catch (error) {
        console.error("Erro no Auth Init:", error);
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      if (!mounted) return;

      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setProfileName(currentSession?.user?.user_metadata?.name ?? null);
      setLoading(false);

      if (currentSession?.user) {
        fetchUserProfileBackground(currentSession.user.id, currentSession);
      } else {
        claimsRefreshAttemptRef.current = null;
        setUserRole(null);
        setProfileName(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error("Erro ao fazer login", { description: error.message });
    return { error };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl, data: { name } },
    });
    if (error) toast.error("Erro ao criar conta", { description: error.message });
    else toast.success("Conta criada!", { description: "Aguarde aprovação." });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    claimsRefreshAttemptRef.current = null;
    setUser(null);
    setSession(null);
    setUserRole(null);
    setProfileName(null);
  };

  const isPendingApproval = userRole === "NENHUM";

  return (
    <AuthContext.Provider
      value={{ user, session, userRole, profileName, loading, signIn, signUp, signOut, isPendingApproval }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
