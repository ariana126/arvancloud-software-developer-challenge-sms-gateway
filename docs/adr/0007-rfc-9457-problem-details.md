# 7. RFC 9457 Problem Details for Every Error Response

## Status

Accepted — 2026-07-28 (`bb9ff6c`).

## Context

The API has three clients that must react to failures programmatically: the Angular front end, which
binds server errors onto individual form fields; the acceptance suite, which asserts on them; and
whatever a customer builds. Each needs to distinguish "this email is already registered" from "this
password is too weak" from "you are out of credit" — reliably, without reading English.

NestJS's default error body is `{ statusCode, message, error }`, where `message` is either a string
or an array of strings depending on which pipe produced it. A client distinguishing two failures with
that has to match on prose, and prose is the part of an API nobody thinks they are versioning.

The alternatives:

- **The NestJS default.** Free, and pushes clients toward string matching.
- **A house error format** — `{ code, message, fields }` or similar. Works, and is one more bespoke
  contract for a client to learn.
- **RFC 9457 Problem Details.** A published standard with a registered media type
  (`application/problem+json`), a stable machine-readable `type` URI, and a defined place to put
  extensions.

## Decision

We will return RFC 9457 Problem Details for every error response, with `application/problem+json`, and
clients will branch on `type` — never on `detail`.

The pipeline is a mapper chain. `HttpExceptionFilter` iterates an `ExceptionMapper[]`; the first
mapper that handles the exception wins; unmatched exceptions become a generic 500 via
`ProblemDetail.forUnknownError()`. Each module owns a mapper in
`infrastructure/http/exception.mapper.ts` translating its own domain exceptions.

Adding a domain exception is three steps:

1. Extend `ApplicationException` in the module's `application/exceptions/`.
2. Add a case to the module's `ExceptionMapper`.
3. **If the module's mapper is itself new, register it** in the `ExceptionMappers` array at the top of
   `src/framework/infrastructure/http/exception.filter.ts`.

That array is a hardcoded module-level `const`, not DI, because the filter is constructed with `new`
in `configure-app.ts` and can inject nothing. It is the one whitelisted exception to ADR 5's rule
that `framework` may not name feature modules.

**Validation is the other half of the pipeline, and the half clients lean on hardest.**
`configure-app.ts` installs a `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`,
`forbidUnknownValues` and `transform`, plus a custom `exceptionFactory` that reshapes
class-validator's output into `{ field, message }[]`. `FrameworkExceptionMapper` unpacks exactly that
into a 400 `validation-error` problem carrying an `errors` array — which is what lets the front end
put each message beside the input that caused it, rather than in a banner.

Extension members are spread at the **top level** of the response body, as RFC 9457 prescribes, not
nested under a key.

The business justification is user satisfaction, and it is concrete: a validation error that names
its field is the difference between a form that tells a customer which box is wrong and one that says
"invalid input". That behaviour is only possible because the error contract carries the field.

## Consequences

Skipping step 3 fails quietly and confusingly. Nothing throws; the mapper simply never matches, and
the response is a generic **500** instead of the status intended. It is the most likely mistake in
this pipeline and there is no check for it.

Two shapes are now coupled across files: the `exceptionFactory`'s output and the mapper that reads
it. Changing one breaks the other, and neither file mentions the other.

An **unknown property in a request body is a 400**, not something quietly ignored. That is
`forbidNonWhitelisted` doing its job, and it is stricter than most APIs — a client sending an extra
field gets rejected.

Problem `type` URIs are built by prefixing a slug with a base URL constant, so a mapper says
`user-already-exists` and the wire shows a full URI. **That base is hardcoded in three separate
places** — `problem-detail.ts`, the Swagger error schemas, and once more in a project outside the
backend — with no shared constant between them. Changing it in one place breaks the other two
silently. This is a known defect of the current implementation, not a design intent.

Because clients branch on `type`, the slugs are part of the public contract. Renaming one is a
breaking change with the same weight as renaming a route.

## Compliance

`make lint-swagger` — the committed OpenAPI spec carries the error schemas, so a mapper or DTO change
that alters an error shape without regeneration fails the check. Combined with ADR 13's
`make lint-api-contract`, the front end's generated client is guaranteed to match the errors the API
actually returns.

`sms/infrastructure/http/exception.mapper.spec.ts` covers that module's mappings directly.

The acceptance suite is the behavioural gate: it asserts on `type` and never on `detail`, so a
changed slug fails a scenario. That convention is the enforcement — an assertion on `detail` would
pass while leaving the contract untested.

Nothing checks the three copies of the base URL. That is the gap named in Consequences.

## Notes

Author: Ariana Maghsoudi · Decided: 2026-07-28 · Last modified: 2026-07-31

Reconstructed after the fact.
