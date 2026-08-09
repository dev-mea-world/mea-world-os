# ADR 0004: Governed Telegram requests and durable outbound notifications

## Status

Superseded in part by ADR 0005 — 2026-08-09

## Context

Treating every Telegram message as a read-only `operator.query` made requests for project changes appear successful while guaranteeing that no change could occur. Pulling completed answers with `/result` also prevented the system from asking for clarification or reporting completion without another operator command.

Telegram delivery and repository mutation are separate side-effect boundaries. Both need durable intent, bounded retries, authentication, audit history, and an explicit human-control point before code is published.

## Decision

- Keep `/ask` as an explicit read-only conversational command. Route free text and `/request` through an `operator.request` task executed read-only and without network access. ADR 0005 replaces this task with the executable `supervisor.request` contract.
- Require the router to return one strictly validated decision: answer directly, ask one clarification, or propose a bounded repository update. The router cannot execute the proposed work.
- Persist clarification and change-request state in PostgreSQL. A reply to a pending clarification is correlated to the original request and routed again.
- Require the paired Telegram operator to approve or reject every proposed repository update through an inline button. Approval atomically creates one deduplicated `repo.update` task.
- Execute approved changes through the existing isolated worktree, validation, commit, push, and remote-verification saga. Telegram approval does not permit merge, force-push, secret access, test bypass, or Notion mutation.
- Persist outbound messages in a deduplicated PostgreSQL outbox. Only the authenticated local worker may lease delivery work, and only that worker holds the bot token.
- Mark an ambiguous Telegram network outcome as `delivery_unknown` and suppress automatic retry to avoid a possible duplicate. Retry explicit non-success Bot API responses at most three times. Surface pending and failed/ambiguous delivery counts in the dashboard.
- Record request, decision, task, delivery, and recovery transitions as append-only audit events.

## Consequences

- Normal Telegram text can lead to a real code change, but only after an explicit, attributable confirmation.
- Answers, clarification questions, confirmation prompts, failures, and publication results are pushed automatically; `/result` remains a diagnostic fallback.
- Vercel never receives the bot token. Proactive communication is available only while the manually started local worker is running, matching the current operator-controlled deployment model.
- Telegram does not offer an idempotency key for `sendMessage`. The outbox prevents logical duplicates, bounds known failures, and fails closed on uncertain delivery rather than risking a duplicate notification.
- The production database must receive migration `0004_telegram_requests_outbox.sql`, and the webhook must accept `callback_query` updates before confirmation buttons work.
