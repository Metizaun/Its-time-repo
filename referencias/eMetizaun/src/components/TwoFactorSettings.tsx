import { useState, useEffect } from "react";
import { Shield, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { TwoFactorSetup } from "./TwoFactorSetup";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export function TwoFactorSettings() {
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const { getMfaFactors, unenrollMfa, challengeMfa, verifyMfa } = useAuth();
  const { toast } = useToast();

  const loadMfaFactors = async () => {
    setLoading(true);
    try {
      const { data, error } = await getMfaFactors();
      
      if (error) {
        console.error('Error loading MFA factors:', error);
        return;
      }

      setMfaFactors(data?.totp || []);
    } catch (error) {
      console.error('Unexpected error loading MFA factors:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async (factorId: string) => {
    if (!factorId) return;
    if (!disableCode || disableCode.replace(/\D/g, '').length !== 6) {
      toast({
        title: "2FA Code Required",
        description: "Enter the 6-digit code from your authenticator app to confirm.",
        variant: "destructive",
      });
      return;
    }

    setDisabling(true);
    setConfirmingDisable(true);
    try {
      // 1) Create MFA challenge to elevate to AAL2
      const { data: challengeData, error: challengeError } = await challengeMfa(factorId);
      if (challengeError || !challengeData?.id) {
        throw challengeError || new Error('Unable to start MFA challenge');
      }

      // 2) Verify the provided code
      const code = disableCode.replace(/\s/g, '');
      const { error: verifyError } = await verifyMfa(factorId, challengeData.id, code);
      if (verifyError) {
        throw verifyError;
      }

      // 3) Now we have AAL2, we can unenroll the factor
      const { error } = await unenrollMfa(factorId);
      if (error) {
        throw error;
      }

      await loadMfaFactors();
      setDisableCode("");
      toast({
        title: "2FA Disabled",
        description: "Two-factor authentication has been successfully disabled.",
      });
    } catch (error: any) {
      console.error('Error disabling 2FA:', error);
      toast({
        title: "Failed to Disable 2FA",
        description: error?.message || "AAL2 verification failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setConfirmingDisable(false);
      setDisabling(false);
    }
  };

  useEffect(() => {
    loadMfaFactors();
  }, []);

  const has2FA = mfaFactors.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security to your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-4">
            <p className="text-muted-foreground">Loading 2FA settings...</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Two-Factor Authentication Status
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={has2FA ? "default" : "secondary"}>
                    {has2FA ? "Enabled" : "Disabled"}
                  </Badge>
                  {has2FA && (
                    <p className="text-xs text-muted-foreground">
                      Your account is protected with 2FA
                    </p>
                  )}
                </div>
              </div>
              
              {!has2FA ? (
                <TwoFactorSetup
                  onSuccess={loadMfaFactors}
                  trigger={
                    <Button>
                      <Shield className="mr-2 h-4 w-4" />
                      Enable 2FA
                    </Button>
                  }
                />
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={disabling}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {disabling ? "Disabling..." : "Disable 2FA"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        Disable Two-Factor Authentication
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        To disable 2FA, confirm with a code from your authenticator app.
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-2 py-2">
                      <Label htmlFor="disable-2fa-code">2FA Code</Label>
                      <Input
                        id="disable-2fa-code"
                        placeholder="000000"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        maxLength={6}
                        className="w-40"
                      />
                      <p className="text-xs text-muted-foreground">Enter the 6-digit code to proceed.</p>
                    </div>

                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={confirmingDisable}>Cancel</AlertDialogCancel>
                      <Button
                        variant="destructive"
                        onClick={() => handleDisable2FA(mfaFactors[0]?.id)}
                        disabled={confirmingDisable || (disableCode?.length ?? 0) !== 6}
                      >
                        {confirmingDisable ? 'Disabling...' : 'Yes, Disable 2FA'}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {has2FA && (
              <div className="space-y-3 pt-4 border-t">
                <h4 className="text-sm font-medium">Active Authenticators</h4>
                {mfaFactors.map((factor) => (
                  <div
                    key={factor.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="h-4 w-4 text-green-600" />
                      <div>
                        <p className="text-sm font-medium">
                          {factor.friendly_name || "Authenticator App"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added {new Date(factor.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-200">
                      Active
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4" />
                About Two-Factor Authentication
              </h4>
              <p className="text-xs text-muted-foreground">
                2FA adds an extra layer of security by requiring a code from your phone 
                in addition to your password. We recommend using apps like Google Authenticator, 
                Authy, or 1Password for the best security.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}