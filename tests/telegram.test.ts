import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  parseTelegramCommand,
  telegramCallbackReply,
  telegramWebhookReply
} from "../apps/web/src/lib/telegram";

describe("Telegram command boundary", () => {
  it("parses commands, bot suffixes, and plain-text requests", () => {
    expect(parseTelegramCommand("/status")).toEqual({ action: "status", argument: "" });
    expect(parseTelegramCommand("/result@MeaWorldBot task-id")).toEqual({
      action: "result",
      argument: "task-id"
    });
    expect(parseTelegramCommand(" /ask  una domanda ")).toEqual({
      action: "ask",
      argument: "una domanda"
    });
    expect(parseTelegramCommand("Come stai?")).toEqual({
      action: "request",
      argument: "Come stai?"
    });
    expect(parseTelegramCommand("/request Migliora il bot")).toEqual({
      action: "request",
      argument: "Migliora il bot"
    });
    expect(parseTelegramCommand("/unsupported")).toEqual({ action: "unknown", argument: "" });
  });

  it("compares webhook and pairing secrets without partial matches", () => {
    expect(constantTimeEqual("a".repeat(32), "a".repeat(32))).toBe(true);
    expect(constantTimeEqual("a".repeat(32), "b".repeat(32))).toBe(false);
    expect(constantTimeEqual("short", "a".repeat(32))).toBe(false);
  });

  it("builds a bounded webhook response without rendering user HTML", () => {
    const reply = telegramWebhookReply(123, 456, "x".repeat(5_000));
    expect(reply).toMatchObject({
      method: "sendMessage",
      chat_id: 123,
      reply_parameters: { message_id: 456 },
      link_preview_options: { is_disabled: true }
    });
    expect(reply.text).toHaveLength(4_096);
    expect(reply).not.toHaveProperty("parse_mode");
  });

  it("acknowledges callback decisions without exposing an unbounded response", () => {
    expect(telegramCallbackReply("callback-id", "x".repeat(500))).toEqual({
      method: "answerCallbackQuery",
      callback_query_id: "callback-id",
      text: "x".repeat(200),
      show_alert: false
    });
  });
});
