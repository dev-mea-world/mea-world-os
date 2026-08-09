# ADR 0003: Telegram as a bounded operator channel

## Status

Accepted — 2026-08-08

## Context

The human operator needs a lightweight remote channel for checking system state, submitting conversational requests, and then observing durable execution in the web dashboard. Telegram is an external side-effect boundary and must not bypass worker authentication, task durability, audit history, or Notion write protections.

## Decision

- Receive Telegram updates through an HTTPS Vercel webhook protected by Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
- Pair exactly one private Telegram chat and user through a high-entropy operator code. Persist the binding in PostgreSQL; do not infer authorization from usernames.
- Persist and deduplicate every accepted update by Telegram `update_id` before creating work.
- Convert authorized free text and `/ask` into a low-risk `operator.query` task. Execute it through the local Codex worker in read-only mode, with network disabled and explicit instructions forbidding tools, file inspection, credentials, and side effects.
- Keep `/status`, `/tasks`, `/result`, and `/help` deterministic and server-side. Telegram responses are returned directly in the webhook response, so the runtime does not need the bot token.
- Preserve the bot token only for administrative Bot API calls such as `setWebhook` and `setMyCommands`; it is not committed or stored in the application database.
- Display Telegram pairing, task/run state, results, and meaningful non-heartbeat audit events in a dashboard that refreshes every five seconds.

## Consequences

- Telegram can enqueue bounded conversational work but cannot modify files, access the network, or mutate Notion.
- A compromised unpaired account cannot create work. A second account cannot replace the paired operator without an explicit revocation path.
- Telegram retries cannot duplicate tasks because both update and task dedupe keys are durable.
- Bot replies to completed work are pull-based through `/result`; automatic completion notifications would require a durable outbound outbox and are intentionally deferred.
- The production database must receive migration `0003_telegram_operator.sql` before the new deployment is promoted.
