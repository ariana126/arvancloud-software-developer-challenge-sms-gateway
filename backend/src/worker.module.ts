import { ClockModule, PrismaModule } from '@framework/infrastructure';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SmsDispatchWorkerModule } from '@sms/infrastructure/sms-dispatch-worker.module';
import { LoggerModule } from 'nestjs-pino';

/**
 * The root module of a dispatch worker process — `AppModule`'s counterpart for
 * the consuming side.
 *
 * Compare the two and the difference is the point: no `AuthModule`, no
 * `HealthModule`, no `TestingModule`, no `IdentityModule`, no `CreditModule`,
 * no `SmsModule`. A worker answers no HTTP, authenticates nobody and charges
 * nothing; it reads one topic and talks to a carrier. Anything it does not need
 * is something that could fail or leak in three more containers for no reason.
 *
 * `ClockModule` is here because `NODE_ENV=test` binds a `TunableClock`, and a
 * worker in the test stack should read the same kind of clock the API does.
 * Note it is a **separate instance** — the testing endpoints move the API's
 * clock and cannot reach this one. Nothing depends on the two agreeing today:
 * `sentAt` is stamped at acceptance, in the API, and travels on the message.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level:
            config.get('LOG_LEVEL') ??
            (config.get('NODE_ENV') === 'production' ? 'info' : 'debug'),
          transport:
            config.get('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    ClockModule,
    PrismaModule,
    SmsDispatchWorkerModule,
  ],
})
export class WorkerModule {}
