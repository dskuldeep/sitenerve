import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const RECOMMENDED_SKILLS = [
  {
    id: "addyosmani/web-quality-skills/seo",
    name: "SEO Audit",
    author: "addyosmani",
    description: "Comprehensive technical SEO checks based on Lighthouse and Google Search guidelines",
    installCount: 12500,
  },
  {
    id: "resciencelab/opc-skills/seo-geo",
    name: "SEO + GEO",
    author: "resciencelab",
    description: "Combined SEO and Generative Engine Optimization (AI search visibility)",
    installCount: 8200,
  },
  {
    id: "coreyhaines31/marketingskills/programmatic-seo",
    name: "Programmatic SEO",
    author: "coreyhaines31",
    description: "Building SEO-optimized pages at scale using templates and data",
    installCount: 6800,
  },
  {
    id: "addyosmani/web-quality-skills/performance",
    name: "Performance",
    author: "addyosmani",
    description: "Core Web Vitals, loading performance, and resource optimization",
    installCount: 15200,
  },
  {
    id: "addyosmani/web-quality-skills/accessibility",
    name: "Accessibility",
    author: "addyosmani",
    description: "WCAG compliance checks that overlap with SEO best practices",
    installCount: 11300,
  },
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.toLowerCase();

  let skills = RECOMMENDED_SKILLS;
  if (query) {
    skills = skills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query)
    );
  }

  return NextResponse.json({ success: true, data: skills });
}
