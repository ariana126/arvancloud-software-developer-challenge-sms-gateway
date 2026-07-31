-- CreateTable
CREATE TABLE "sms_sender_traffic" (
    "sender_id" TEXT NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "send_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sms_sender_traffic_pkey" PRIMARY KEY ("sender_id")
);
