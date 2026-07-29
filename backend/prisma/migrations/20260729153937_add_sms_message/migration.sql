-- CreateTable
CREATE TABLE "sms_message" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_message_pkey" PRIMARY KEY ("id")
);
