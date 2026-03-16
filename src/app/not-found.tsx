"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#0A0F1C] flex flex-col items-center justify-center px-4">
      {/* Branding */}
      <div className="animate-fade-in flex items-center gap-2 mb-16">
        <Globe className="h-6 w-6 text-blue-500" />
        <span className="text-lg font-semibold text-[#F8FAFC] tracking-tight">
          SiteNerve
        </span>
      </div>

      {/* 404 */}
      <h1
        className="animate-fade-in text-[8rem] sm:text-[10rem] font-extrabold leading-none bg-gradient-to-r from-blue-500 to-cyan-400 bg-clip-text text-transparent select-none"
        style={{ animationDelay: "0.05s", animationFillMode: "both" }}
      >
        404
      </h1>

      {/* Subtitle */}
      <h2
        className="animate-fade-in mt-4 text-xl sm:text-2xl font-medium text-[#94A3B8]"
        style={{ animationDelay: "0.1s", animationFillMode: "both" }}
      >
        Page not found
      </h2>

      {/* Description */}
      <p
        className="animate-fade-in mt-3 max-w-md text-center text-sm text-[#64748B]"
        style={{ animationDelay: "0.15s", animationFillMode: "both" }}
      >
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      {/* Actions */}
      <div
        className="animate-fade-in mt-10 flex items-center gap-4"
        style={{ animationDelay: "0.2s", animationFillMode: "both" }}
      >
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0F1C]"
        >
          Go Home
        </Link>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center justify-center rounded-lg border border-[#1E293B] px-5 py-2.5 text-sm font-medium text-[#94A3B8] transition-colors hover:border-[#334155] hover:text-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0F1C]"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
