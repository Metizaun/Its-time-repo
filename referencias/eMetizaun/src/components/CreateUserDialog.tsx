import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useOrganizations, UserRole } from "@/hooks/useOrganizations";
import { useToast } from "@/hooks/use-toast";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onUserCreated: () => void;
}

interface CreatedUser {
  email: string;
  password: string;
  displayName: string;
}

export function CreateUserDialog({ 
  open, 
  onOpenChange, 
  organizationId,
  onUserCreated 
}: CreateUserDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole['role']>("member");
  const [loading, setLoading] = useState(false);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { createUser } = useOrganizations();
  const { toast } = useToast();

  // Generate random username and password
  const generateCredentials = () => {
    const username = `user_${Math.random().toString(36).substring(2, 8)}`;
    const password = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 4).toUpperCase();
    return { username, password };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!displayName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a display name",
        variant: "destructive",
      });
      return;
    }

    if (!email.trim()) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      const credentials = generateCredentials();
      
      const result = await createUser(organizationId, email.trim(), credentials.password, displayName.trim(), role);
      console.log('User creation result:', result);
      
      setCreatedUser({
        email: email.trim(),
        password: credentials.password,
        displayName: displayName.trim()
      });
      
      toast({
        title: "Success",
        description: "User created successfully",
      });
      
      // Call the callback to refresh the member list
      onUserCreated();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDisplayName("");
    setEmail("");
    setRole("member");
    setCreatedUser(null);
    setShowPassword(false);
    onOpenChange(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Credentials copied to clipboard",
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        
        {!createdUser ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Doe"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={loading}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole['role'])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member - Full CRUD access</SelectItem>
                  <SelectItem value="admin">Admin - Can manage users</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create User"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                User created successfully! Please save these credentials as they won't be shown again.
              </AlertDescription>
            </Alert>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <div className="flex items-center gap-2">
                  <Input value={createdUser.displayName} readOnly />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(createdUser.displayName)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Email/Username</Label>
                <div className="flex items-center gap-2">
                  <Input value={createdUser.email} readOnly />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(createdUser.email)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    type={showPassword ? "text" : "password"} 
                    value={createdUser.password} 
                    readOnly 
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(createdUser.password)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Complete Credentials</Label>
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(`Email: ${createdUser.email}\nPassword: ${createdUser.password}\nName: ${createdUser.displayName}`)}
                  className="w-full"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy All Credentials
                </Button>
              </div>
            </div>
            
            <div className="flex justify-end pt-4">
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}