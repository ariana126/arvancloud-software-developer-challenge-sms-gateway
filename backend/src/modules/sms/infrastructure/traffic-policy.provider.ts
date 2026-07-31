import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrafficPolicy } from '@sms/domain/value/traffic-policy';

/** Sends per window above which a sender is treated as high volume. */
const DEFAULT_BULK_THRESHOLD = 1000;

/** How far back the count reaches. */
const DEFAULT_WINDOW_IN_SECONDS = 60;

/**
 * Binds `TrafficPolicy` from configuration, using the value object itself as the
 * DI token.
 *
 * A value object as a token rather than a `TRAFFIC_POLICY` string is what keeps
 * `SendSmsHandler` and `GetSenderTrafficHandler` free of an `@Inject`: they name
 * the type they need and get it, exactly as they do for `Clock`. The factory is
 * the only place `ConfigService` is read for these numbers, so the domain never
 * learns that they are configurable at all.
 *
 * It is a module-level `const` rather than a class so the worker can register
 * the same binding without importing `SmsModule` and dragging in controllers,
 * the CQRS bus and the outbox relay along with it.
 */
export const trafficPolicyProvider: Provider = {
  provide: TrafficPolicy,
  inject: [ConfigService],
  useFactory: (config: ConfigService): TrafficPolicy =>
    TrafficPolicy.of(
      readNumber(config, 'SMS_BULK_TIER_THRESHOLD', DEFAULT_BULK_THRESHOLD),
      readNumber(
        config,
        'SMS_TRAFFIC_WINDOW_IN_SECONDS',
        DEFAULT_WINDOW_IN_SECONDS,
      ),
    ),
};

/**
 * Environment variables are strings, always — `ConfigService.get<number>` is a
 * cast, not a conversion, and hands back `'3'` where the type says `3`. Passing
 * that straight to `TrafficPolicy.of` would fail its `Number.isInteger` guard
 * and take the whole process down at boot, so the conversion happens here,
 * which is the boundary the string actually arrives at.
 *
 * An unset variable falls back; a set but unparseable one is left to
 * `TrafficPolicy.of` to reject by name, because a threshold of `NaN` is a
 * misconfiguration worth failing loudly over rather than papering over with a
 * default nobody asked for.
 */
function readNumber(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  return raw === undefined || raw === '' ? fallback : Number(raw);
}
