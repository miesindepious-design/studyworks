-- 7-day free Pro trial + student profile (exact class / university year)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialStartsAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "schoolStage" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "schoolClass" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "universityYear" TEXT;
