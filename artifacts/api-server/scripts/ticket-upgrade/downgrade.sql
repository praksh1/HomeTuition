-- Put a database back the way the live one looks before this change: three statuses, none of
-- the new columns, no history table. This is what the boot guard has to survive on the owner's
-- server, where nobody is going to run a migration by hand.
DROP TABLE IF EXISTS "ticket_events";
ALTER TABLE "disputes" DROP COLUMN IF EXISTS "assigned_to";
ALTER TABLE "disputes" DROP COLUMN IF EXISTS "assigned_at";
ALTER TABLE "disputes" DROP COLUMN IF EXISTS "updated_at";

ALTER TABLE "disputes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "disputes" ALTER COLUMN "status" TYPE text USING "status"::text;
DROP TYPE "dispute_status";
CREATE TYPE "dispute_status" AS ENUM ('open', 'in_review', 'resolved');
ALTER TABLE "disputes" ALTER COLUMN "status" TYPE "dispute_status" USING "status"::"dispute_status";
ALTER TABLE "disputes" ALTER COLUMN "status" SET DEFAULT 'open';
