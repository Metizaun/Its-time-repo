import { useState } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface TwoFactorVerificationProps {
  factorId: string;
  challengeId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function TwoFactorVerification({
  factorId,
  challengeId,
  onSuccess,
  onCancel
}: TwoFactorVerificationProps) {
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const { verifyMfa } = useAuth();
  const { toast } = useToast();

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!verificationCode.trim() || verificationCode.replace(/\s/g, '').length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter a valid 6-digit code",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await verifyMfa(
        factorId,
        challengeId,
        verificationCode.replace(/\s/g, '') // Remove any spaces
      );

      if (!error) {
        onSuccess();
      }
    } catch (error) {
      console.error('Verification error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCode = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const limited = cleaned.slice(0, 6);
    return limited.replace(/(\d{3})(\d{3})/, '$1 $2');
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 bg-primary rounded-full flex items-center justify-center mb-4">
          <Shield className="h-6 w-6 text-primary-foreground" />
        </div>
        <CardTitle>Two-Factor Authentication</CardTitle>
        <CardDescription>
          Enter the 6-digit code from your authenticator app
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Verification Code</Label>
            <Input
              id="mfa-code"
              value={verificationCode}
              onChange={(e) => setVerificationCode(formatCode(e.target.value))}
              placeholder="000 000"
              className="text-center text-lg font-mono tracking-wider"
              maxLength={7} // 6 digits + 1 space
              autoFocus
            />
          </div>
          
          <div className="space-y-2">
            <Button 
              type="submit"
              disabled={loading || verificationCode.replace(/\s/g, '').length !== 6}
              className="w-full"
            >
              {loading ? "Verifying..." : "Verify"}
            </Button>
            
            <Button 
              type="button" 
              variant="outline" 
              onClick={onCancel}
              className="w-full"
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}