import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Shield, Copy, CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface TwoFactorSetupProps {
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function TwoFactorSetup({ trigger, onSuccess }: TwoFactorSetupProps) {
  const [open, setOpen] = useState(false);
  
  const [verificationCode, setVerificationCode] = useState("");
  const [enrollmentData, setEnrollmentData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'enroll' | 'verify'>('enroll');
  const [copied, setCopied] = useState(false);
  const [qrError, setQrError] = useState(false);
  const { enrollMfa, verifyMfa, challengeMfa } = useAuth();
  const { toast } = useToast();

  const handleEnroll = async () => {
    setLoading(true);
    try {
      // Generate a unique friendly name to avoid conflicts
      const timestamp = new Date().getTime();
      const factorName = `Authenticator App ${timestamp}`;
      
      const { data, error } = await enrollMfa(factorName);
      
      if (error) {
        console.error('Enrollment error:', error);
        if (error.code === 'mfa_factor_name_conflict') {
          toast({
            title: "2FA Already Enabled",
            description: "You already have 2FA set up. Please disable it first to set up a new one.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Enrollment Failed",
            description: error.message || "Failed to set up 2FA. Please try again.",
            variant: "destructive",
          });
        }
        return;
      }

      if (data) {
        console.log('MFA enrollment data:', data);
        setEnrollmentData(data);
        setStep('verify');
      }
    } catch (error) {
      console.error('Unexpected error during enrollment:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!enrollmentData?.id || !verificationCode.trim()) {
      toast({
        title: "Invalid Code",
        description: "Please enter a valid 6-digit code",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // For enrollment verification, we need to use the factor ID as both factorId and challengeId
      // This is the correct approach for TOTP enrollment verification
      const { error } = await verifyMfa(
        enrollmentData.id, // factorId
        enrollmentData.id, // challengeId - for enrollment, this should be the same
        verificationCode.replace(/\s/g, '') // Remove any spaces
      );

      if (error) {
        // If the standard approach fails, let's try creating a challenge first
        console.log('Initial verification failed, trying challenge approach...');
        
        const { data: challengeData, error: challengeError } = await challengeMfa(enrollmentData.id);
        
        if (challengeError) {
          throw challengeError;
        }
        
        if (challengeData?.id) {
          // Now try verification with the proper challenge ID
          const { error: verifyError } = await verifyMfa(
            enrollmentData.id,
            challengeData.id,
            verificationCode.replace(/\s/g, '')
          );
          
          if (verifyError) {
            throw verifyError;
          }
        }
      }

      // Success - close dialog and refresh parent
      setOpen(false);
      setStep('enroll');
      setEnrollmentData(null);
      setVerificationCode("");
      onSuccess?.(); // Call the success callback to refresh parent component
      
    } catch (error) {
      console.error('Verification error:', error);
      toast({
        title: "Verification Failed",
        description: "The code you entered is incorrect or has expired. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    if (enrollmentData?.totp?.secret) {
      navigator.clipboard.writeText(enrollmentData.totp.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied!",
        description: "Secret key copied to clipboard",
      });
    }
  };

  const formatCode = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const limited = cleaned.slice(0, 6);
    return limited.replace(/(\d{3})(\d{3})/, '$1 $2');
  };

  useEffect(() => {
    if (!open) {
      setStep('enroll');
      setEnrollmentData(null);
      setVerificationCode("");
      setCopied(false);
      setQrError(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Shield className="mr-2 h-4 w-4" />
            Set Up 2FA
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Set Up Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            Secure your account with an authenticator app
          </DialogDescription>
        </DialogHeader>

        {step === 'enroll' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 1: Enable 2FA</CardTitle>
                <CardDescription>
                  Generate a QR code to set up your authenticator app
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={handleEnroll} disabled={loading} className="w-full">
                  {loading ? "Generating..." : "Generate QR Code"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'verify' && enrollmentData && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 2: Scan QR Code</CardTitle>
                <CardDescription>
                  Use your authenticator app to scan this QR code
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-lg">
                    {!qrError && enrollmentData.totp?.qr_code ? (
                      <QRCodeErrorBoundary
                        qrData={enrollmentData.totp.qr_code}
                        onError={() => setQrError(true)}
                      />
                    ) : (
                      <div className="w-[200px] h-[200px] flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded space-y-2">
                        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground text-center">
                          QR Code unavailable
                        </p>
                        <p className="text-xs text-muted-foreground text-center">
                          Use manual setup below
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    Can't scan? Enter this secret key manually:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all">
                      {enrollmentData.totp?.secret}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySecret}
                      className="shrink-0"
                    >
                      {copied ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Step 3: Verify</CardTitle>
                <CardDescription>
                  Enter the 6-digit code from your authenticator app
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="verification-code">Verification Code</Label>
                  <Input
                    id="verification-code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(formatCode(e.target.value))}
                    placeholder="000 000"
                    className="text-center text-lg font-mono tracking-wider"
                    maxLength={7} // 6 digits + 1 space
                  />
                </div>
                
                <Button 
                  onClick={handleVerify} 
                  disabled={loading || verificationCode.replace(/\s/g, '').length !== 6}
                  className="w-full"
                >
                  {loading ? "Verifying..." : "Verify & Enable 2FA"}
                </Button>
              </CardContent>
            </Card>

            <div className="text-center">
              <Badge variant="secondary" className="text-xs">
                <Shield className="mr-1 h-3 w-3" />
                Use apps like Google Authenticator, Authy, or 1Password
              </Badge>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Error boundary component for QR code rendering
function QRCodeErrorBoundary({ qrData, onError }: { qrData: string; onError: () => void }) {
  try {
    // Check if data is too long (QR codes typically max out around 3000-4000 characters)
    if (qrData.length > 2000) {
      onError();
      return null;
    }
    
    return (
      <QRCodeSVG
        value={qrData}
        size={200}
        level="L"
        includeMargin={true}
      />
    );
  } catch (error) {
    console.error('QR Code generation error:', error);
    onError();
    return null;
  }
}