-- Add RUNNING status for agent execution lifecycle
DO $$
BEGIN
  ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add per-agent webhook configuration
ALTER TABLE "Agent"
ADD COLUMN IF NOT EXISTS "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "webhookUrl" TEXT;
