-- CreateTable
CREATE TABLE "credit_wallet" (
    "id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "credit_wallet_pkey" PRIMARY KEY ("id")
);
