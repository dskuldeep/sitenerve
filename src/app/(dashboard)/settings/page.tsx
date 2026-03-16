"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  User,
  Shield,
  Monitor,
  AlertTriangle,
  Save,
  Lock,
  Trash2,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function AccountSettingsPage() {
  const { data: session, update: updateSession } = useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (session?.user) {
      setName(session.user.name || "");
      setEmail(session.user.email || "");
      setImage((session.user as { image?: string }).image || "");
    }
  }, [session]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, image }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update profile");
      }

      await updateSession();
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile"
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to change password");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change password"
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (
      !confirm(
        "Are you sure you want to delete your account? This action cannot be undone."
      )
    ) {
      return;
    }

    setDeletingAccount(true);
    try {
      const res = await fetch("/api/settings/account", {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete account");
      }

      toast.success("Account deleted");
      window.location.href = "/login";
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete account"
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Account Settings"
        description="Manage your profile, preferences, and account details"
      />

      <div className="space-y-6 max-w-2xl">
        {/* Profile Card */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-[#F8FAFC]">Profile</CardTitle>
            </div>
            <CardDescription className="text-[#94A3B8]">
              Update your personal information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="bg-[#0A0F1C] border-[#1E293B] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">Email</Label>
              <Input
                value={email}
                readOnly
                disabled
                className="bg-[#0A0F1C] border-[#1E293B] text-[#94A3B8] cursor-not-allowed"
              />
              <p className="text-xs text-[#64748B]">
                Email address cannot be changed
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">Profile Image URL</Label>
              <Input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="bg-[#0A0F1C] border-[#1E293B] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {savingProfile ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Save className="h-4 w-4 mr-1.5" />
                )}
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security Card */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-[#F8FAFC]">Security</CardTitle>
            </div>
            <CardDescription className="text-[#94A3B8]">
              Change your password
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">Current Password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="bg-[#0A0F1C] border-[#1E293B] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <Separator className="bg-[#1E293B]" />
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="bg-[#0A0F1C] border-[#1E293B] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#F8FAFC]">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="bg-[#0A0F1C] border-[#1E293B] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleChangePassword}
                disabled={
                  changingPassword ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {changingPassword ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Lock className="h-4 w-4 mr-1.5" />
                )}
                Change Password
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sessions Card */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-blue-400" />
              <CardTitle className="text-[#F8FAFC]">Sessions</CardTitle>
            </div>
            <CardDescription className="text-[#94A3B8]">
              Manage your active sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-[#1E293B] bg-[#0A0F1C] p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-green-500/10 p-2">
                  <Monitor className="h-4 w-4 text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    Current Session
                  </p>
                  <p className="text-xs text-[#64748B]">
                    {session?.user?.email || "Signed in"} &middot; Active now
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
                Active
              </span>
            </div>
          </CardContent>
        </Card>

        {/* AI Configuration Card */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-400" />
              <CardTitle className="text-[#F8FAFC]">AI Configuration</CardTitle>
            </div>
            <CardDescription className="text-[#94A3B8]">
              Manage your Gemini API integration for AI agents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-[#94A3B8]">
              Configure your profile-level Gemini API key, discover available models in real time,
              and set your default model used by agents.
            </p>
            <div className="flex justify-end pt-2">
              <Link href="/settings/ai">
                <Button className="bg-purple-600 hover:bg-purple-700 text-white">
                  Open AI Settings
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone Card */}
        <Card className="bg-[#111827] border-red-500/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <CardTitle className="text-red-400">Danger Zone</CardTitle>
            </div>
            <CardDescription className="text-[#94A3B8]">
              Irreversible and destructive actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              <div>
                <p className="text-sm font-medium text-[#F8FAFC]">
                  Delete Account
                </p>
                <p className="text-xs text-[#64748B]">
                  Permanently delete your account and all associated data. This
                  action cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                className="ml-4 shrink-0"
              >
                {deletingAccount ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
