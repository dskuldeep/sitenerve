"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0F1C] p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-cyan-500/5" />
      <Card className="w-full max-w-md relative animate-fade-in bg-[#111827] border-[#1E293B]">
        <CardContent className="pt-8 pb-8 flex flex-col items-center text-center space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-[#F8FAFC]">SiteNerve</span>
          </div>
          <div className="rounded-full bg-[#1E293B] p-4">
            <Mail className="h-8 w-8 text-blue-400" />
          </div>
          <h1 className="text-xl font-semibold text-[#F8FAFC]">Check your email</h1>
          <p className="text-sm text-[#94A3B8] max-w-sm">
            We sent a verification link to your email address. Click the link to verify your account and get started.
          </p>
          <Link href="/login">
            <Button variant="outline" className="bg-[#1E293B] border-[#334155] text-[#94A3B8] hover:bg-[#263348] hover:text-[#F8FAFC]">
              Back to Sign In
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
