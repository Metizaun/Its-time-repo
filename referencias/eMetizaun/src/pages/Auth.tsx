import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import CRMLogo from "@/components/CRMLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TwoFactorVerification } from "@/components/TwoFactorVerification";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";

const authSchema = z.object({
  email: z.string()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
  password: z.string()
    .min(8, { message: "Password must be at least 8 characters" })
    .max(128, { message: "Password must be less than 128 characters" })
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, { 
      message: "Password must contain at least one uppercase letter, one lowercase letter, and one number" 
    }),
  displayName: z.string()
    .min(1, { message: "Display name is required" })
    .max(100, { message: "Display name must be less than 100 characters" })
    .optional()
});

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string>("");
  const [mfaChallengeId, setMfaChallengeId] = useState<string>("");
  const { signIn, signUp, resetPassword, user, challengeMfa, getMfaFactors } = useAuth();
  const navigate = useNavigate();

useEffect(() => {
  let active = true;
  (async () => {
    if (!user) return;
    // Check if existing session needs MFA
    const { data: factorsData } = await getMfaFactors();
    const factors = (factorsData?.totp || []).filter((f: any) => f.status === 'verified');
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsMfa = factors.length > 0 && aalData?.currentLevel === 'aal1';
    if (!active) return;
    if (needsMfa) {
      const factor = factors[0];
      const { data: challengeData, error: challengeError } = await challengeMfa(factor.id);
      if (!challengeError && challengeData) {
        setMfaFactorId(factor.id);
        setMfaChallengeId(challengeData.id);
        setMfaRequired(true);
        return;
      }
    } else {
      navigate("/dashboard");
    }
  })();
  return () => { active = false; };
}, [user, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      const validatedData = authSchema.omit({ displayName: true }).parse({ email, password });
      setLoading(true);
      
      const { error } = await signIn(validatedData.email, validatedData.password);
      
      if (error) {
        // If sign-in failed, show error
        toast({
          title: "Sign In Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        // Check if user has MFA enrolled after successful password auth
        const { data: factorsData } = await getMfaFactors();
        const factors = factorsData?.totp || [];
        
        if (factors.length > 0) {
          // User has MFA enrolled, challenge it
          const factor = factors[0];
          const { data: challengeData, error: challengeError } = await challengeMfa(factor.id);
          
          if (!challengeError && challengeData) {
            setMfaFactorId(factor.id);
            setMfaChallengeId(challengeData.id);
            setMfaRequired(true);
            return;
          }
        }
        
        // No MFA or challenge failed, proceed normally
        navigate("/dashboard");
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      const validatedData = authSchema.parse({ email, password, displayName });
      setLoading(true);
      
      const { error } = await signUp(validatedData.email, validatedData.password, validatedData.displayName);
      
      if (!error) {
        toast({
          title: "Account created successfully",
          description: "Please check your email to verify your account.",
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSuccess = () => {
    setMfaRequired(false);
    setMfaFactorId("");
    setMfaChallengeId("");
    navigate("/dashboard");
  };

  const handleMfaCancel = () => {
    setMfaRequired(false);
    setMfaFactorId("");
    setMfaChallengeId("");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const { error } = await resetPassword(resetEmail);
    
    if (!error) {
      setShowResetForm(false);
      setResetEmail("");
    }
    
    setLoading(false);
  };

  // Show MFA verification if required
  if (mfaRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <TwoFactorVerification
          factorId={mfaFactorId}
          challengeId={mfaChallengeId}
          onSuccess={handleMfaSuccess}
          onCancel={handleMfaCancel}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Brand */}
      <div className="hidden lg:flex lg:flex-1 brand-surface items-center justify-center p-12">
        <div className="max-w-md text-center lg:text-left">
          <CRMLogo variant="brand" />
          <p className="mt-8 text-lg text-brand-light/80 leading-relaxed">
            Manage your contacts and organizations with our powerful CRM solution.
          </p>
        </div>
      </div>

      {/* Right Side - Auth Form */}
      <div className="flex-1 lg:max-w-lg xl:max-w-xl flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <CRMLogo variant="default" />
          </div>
          
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Welcome to CRM Template</CardTitle>
              <CardDescription>
                Sign in to your account or create a new one
              </CardDescription>
            </CardHeader>
            <CardContent>
              {showResetForm ? (
                <div className="space-y-4">
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold">Reset Password</h3>
                    <p className="text-sm text-muted-foreground">
                      Enter your email address and we'll send you a reset link
                    </p>
                  </div>
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email">Email</Label>
                      <Input
                        id="reset-email"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Sending..." : "Send Reset Link"}
                      </Button>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        className="w-full"
                        onClick={() => setShowResetForm(false)}
                      >
                        Back to Sign In
                      </Button>
                    </div>
                  </form>
                </div>
              ) : (
                <Tabs defaultValue="signin" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signin">Sign In</TabsTrigger>
                    <TabsTrigger value="signup">Sign Up</TabsTrigger>
                  </TabsList>
                
                <TabsContent value="signin">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email</Label>
                      <Input
                        id="signin-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        maxLength={255}
                      />
                      {errors.email && (
                        <p className="text-sm text-destructive">{errors.email}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signin-password">Password</Label>
                      <Input
                        id="signin-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        maxLength={128}
                      />
                      {errors.password && (
                        <p className="text-sm text-destructive">{errors.password}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Signing In..." : "Sign In"}
                      </Button>
                      <Button 
                        type="button" 
                        variant="link" 
                        className="w-full text-sm"
                        onClick={() => setShowResetForm(true)}
                      >
                        Forgot your password?
                      </Button>
                    </div>
                  </form>
                </TabsContent>
                
                <TabsContent value="signup">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Display Name</Label>
                      <Input
                        id="signup-name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your Name"
                        required
                        maxLength={100}
                      />
                      {errors.displayName && (
                        <p className="text-sm text-destructive">{errors.displayName}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        maxLength={255}
                      />
                      {errors.email && (
                        <p className="text-sm text-destructive">{errors.email}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        maxLength={128}
                      />
                      {errors.password && (
                        <p className="text-sm text-destructive">{errors.password}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Password must be at least 8 characters and contain uppercase, lowercase, and a number
                      </p>
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "Creating Account..." : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Auth;