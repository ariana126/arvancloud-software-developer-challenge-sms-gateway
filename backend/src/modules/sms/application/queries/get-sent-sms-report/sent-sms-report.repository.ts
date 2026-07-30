import { Identity } from '@framework/domain';

/**
 * One persisted message, as the report needs it. Deliberately **not** the
 * `SmsMessage` aggregate: that type is a write model with no readers' getters
 * on it, and building the report through it would either grow a crop of them or
 * repeat the unchecked `toPrimitives() as …` cast `GetUserByIdHandler` carries a
 * TODO against. Deliberately not a Prisma type either — this layer must stay
 * ignorant of the ORM.
 *
 * `cost` is absent on purpose. It is not a column: `SmsTariff` is the single
 * place the price lives, and the handler composes it in.
 */
export interface SentSmsRecord {
  id: string;
  recipient: string;
  message: string;
  status: string;
  serviceLevel: string;
  sentAt: Date;
}

/**
 * The read side's way in — a read-model port, so it lives in `application/`
 * rather than in `domain/service/` alongside the write-model repositories.
 * (`domain/service/` is this module's published *cross-module* port surface,
 * and nothing outside `sms` reads this report.) An abstract class rather than a
 * TS interface because NestJS DI binds on a runtime token, the same convention
 * `SmsMessageRepository` and `SmsProvider` follow.
 *
 * Three parts of the contract that implementations do not get to reinterpret:
 *
 * - **Scoping is the port's job.** The sender is filtered in the query itself,
 *   so the caller never receives a row it has to discard.
 * - **Newest first**, ordered by `sentAt` descending.
 * - **`find`, not `get`.** A sender who has sent nothing is the expected case,
 *   not a not-found error: the answer is `[]`, never `null` and never a throw.
 */
export abstract class SentSmsReportRepository {
  public abstract findBySender(senderId: Identity): Promise<SentSmsRecord[]>;
}
