-- AlterTable
ALTER TABLE "AISettings" ALTER COLUMN "model" SET DEFAULT 'gemini-2.5-flash';

-- AlterTable
ALTER TABLE "Flashcard" ADD COLUMN     "leechCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewHistory" JSONB,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "topic" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "PracticeQuestion" ADD COLUMN     "topic" TEXT;

-- DropTable

-- CreateTable
CREATE TABLE "UserProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "seasonXp" INTEGER NOT NULL DEFAULT 0,
    "streakFreezes" INTEGER NOT NULL DEFAULT 1,
    "focusTrees" INTEGER NOT NULL DEFAULT 0,
    "unlockedAchievements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questState" JSONB NOT NULL DEFAULT '{}',
    "questDate" TEXT,
    "dailyXp" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1200,
    "peakRating" INTEGER NOT NULL DEFAULT 1200,
    "games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "source" TEXT NOT NULL DEFAULT 'flashcards',
    "topic" TEXT,
    "challengerId" TEXT NOT NULL,
    "challengerName" TEXT NOT NULL,
    "opponentId" TEXT,
    "opponentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "questions" JSONB NOT NULL,
    "challengerScore" INTEGER,
    "opponentScore" INTEGER,
    "winnerId" TEXT,
    "ratingBefore" DOUBLE PRECISION,
    "ratingAfter" DOUBLE PRECISION,
    "opponentRatingBefore" DOUBLE PRECISION,
    "opponentRatingAfter" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GameMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "examDate" TIMESTAMP(3) NOT NULL,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyTarget" INTEGER NOT NULL DEFAULT 20,
    "notes" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProgress_userId_key" ON "UserProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameRating_userId_key" ON "GameRating"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameMatch_code_key" ON "GameMatch"("code");

-- CreateIndex
CREATE INDEX "GameMatch_challengerId_idx" ON "GameMatch"("challengerId");

-- CreateIndex
CREATE INDEX "GameMatch_opponentId_idx" ON "GameMatch"("opponentId");

-- CreateIndex
CREATE INDEX "GameMatch_status_idx" ON "GameMatch"("status");

-- CreateIndex
CREATE INDEX "ExamPlan_userId_idx" ON "ExamPlan"("userId");

-- CreateIndex
CREATE INDEX "Flashcard_userId_topic_idx" ON "Flashcard"("userId", "topic");

-- AddForeignKey
ALTER TABLE "UserProgress" ADD CONSTRAINT "UserProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRating" ADD CONSTRAINT "GameRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMatch" ADD CONSTRAINT "GameMatch_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMatch" ADD CONSTRAINT "GameMatch_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPlan" ADD CONSTRAINT "ExamPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

