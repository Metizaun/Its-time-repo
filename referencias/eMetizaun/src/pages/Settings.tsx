import { useState, useEffect } from "react";
import { User, Shield, Save, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { TeamManagement } from "@/components/TeamManagement";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
    mfaCode: ""
  });
  const [showMfaInput, setShowMfaInput] = useState(false);
  const [profile, setProfile] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    position: "",
    bio: "",
    avatarUrl: ""
  });

  // Load profile data on component mount
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      
      setLoading(true);
      try {
        // Get user email from auth
        setProfile(prev => ({ ...prev, email: user.email || "" }));

        // Try to get profile data from database
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading profile:', error);
          return;
        }

        if (profileData) {
          // Parse display_name into first and last name if it exists
          const displayName = profileData.display_name || "";
          const nameParts = displayName.split(' ');
          
          setProfile(prev => ({
            ...prev,
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(' ') || "",
            avatarUrl: profileData.avatar_url || ""
          }));
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const displayName = `${profile.firstName} ${profile.lastName}`.trim();
      
      const { error } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          display_name: displayName,
          avatar_url: profile.avatarUrl
        });

      if (error) {
        throw error;
      }

      toast({
        title: "Profile Updated",
        description: "Your profile information has been saved successfully."
      });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: "Error",
        description: "Failed to save profile. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please select an image file.",
        variant: "destructive"
      });
      return;
    }

    // Validate file size (1MB max)
    if (file.size > 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please select an image smaller than 1MB.",
        variant: "destructive"
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      // Create unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/avatar.${fileExt}`;

      // Upload to Supabase Storage
      const { data, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { 
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with new avatar URL
      setProfile(prev => ({ ...prev, avatarUrl: publicUrl }));

      // Save to database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          display_name: `${profile.firstName} ${profile.lastName}`.trim(),
          avatar_url: publicUrl
        })
        .eq('user_id', user.id);

      if (updateError) {
        throw updateError;
      }

      toast({
        title: "Avatar Updated",
        description: "Your profile picture has been updated successfully."
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload avatar. Please try again.",
        variant: "destructive"
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const { updatePassword } = useAuth();

  const handlePasswordChange = async () => {
    if (!passwords.new || !passwords.confirm) {
      toast({
        title: "Error",
        description: "Please fill in all password fields.",
        variant: "destructive"
      });
      return;
    }

    if (passwords.new !== passwords.confirm) {
      toast({
        title: "Error",
        description: "New passwords do not match.",
        variant: "destructive"
      });
      return;
    }

    if (passwords.new.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long.",
        variant: "destructive"
      });
      return;
    }

    if (showMfaInput && !passwords.mfaCode) {
      toast({
        title: "Error",
        description: "Please enter your 2FA code.",
        variant: "destructive"
      });
      return;
    }

    setPasswordLoading(true);
    try {
      const result = await updatePassword(passwords.new, passwords.mfaCode || undefined);

      if (result.requiresMfa && !showMfaInput) {
        setShowMfaInput(true);
        toast({
          title: "2FA Required",
          description: "Please enter your 2FA code to update your password.",
        });
        return;
      }

      if (!result.error) {
        setPasswords({ current: "", new: "", confirm: "", mfaCode: "" });
        setShowMfaInput(false);
      }
    } catch (error) {
      console.error('Error updating password:', error);
      toast({
        title: "Error",
        description: "Failed to update password. Please try again.",
        variant: "destructive"
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="team" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center space-x-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={profile.avatarUrl} alt="Profile" />
                  <AvatarFallback className="text-lg">
                    {profile.firstName?.[0]}{profile.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    id="avatar-upload"
                  />
                  <label htmlFor="avatar-upload">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      disabled={uploadingAvatar}
                      asChild
                    >
                      <span className="cursor-pointer">
                        {uploadingAvatar ? "Uploading..." : "Change Avatar"}
                      </span>
                    </Button>
                  </label>
                  <p className="text-sm text-muted-foreground mt-2">
                    JPG, PNG or GIF. 1MB max.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={profile.firstName}
                    onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={profile.lastName}
                    onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  disabled
                  className="bg-muted"
                />
                <p className="text-sm text-muted-foreground">
                  Email cannot be changed from here. Contact support if needed.
                </p>
              </div>

              <Button 
                onClick={handleSaveProfile} 
                className="flex items-center gap-2"
                disabled={loading}
              >
                <Save className="h-4 w-4" />
                {loading ? "Saving..." : "Save Profile"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-6">
          <TeamManagement />
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium">Change Password</h3>
                  <p className="text-sm text-muted-foreground">
                    Update your password to keep your account secure
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input 
                      id="newPassword" 
                      type="password"
                      value={passwords.new}
                      onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                      disabled={passwordLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                    <Input 
                      id="confirmPassword" 
                      type="password"
                      value={passwords.confirm}
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                      disabled={passwordLoading}
                    />
                  </div>
                  {showMfaInput && (
                    <div className="space-y-2">
                      <Label htmlFor="mfaCode">2FA Code</Label>
                      <Input 
                        id="mfaCode" 
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={passwords.mfaCode}
                        onChange={(e) => setPasswords({ ...passwords, mfaCode: e.target.value })}
                        disabled={passwordLoading}
                        maxLength={6}
                      />
                      <p className="text-sm text-muted-foreground">
                        Enter the 6-digit code from your authenticator app to verify your identity.
                      </p>
                    </div>
                  )}
                  <Button 
                    onClick={handlePasswordChange}
                    disabled={passwordLoading}
                    className="flex items-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {passwordLoading ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <TwoFactorSettings />
        </TabsContent>

      </Tabs>
    </div>
  );
}