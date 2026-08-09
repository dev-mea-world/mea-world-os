import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TelegramEnvSchema = z.object({
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  TELEGRAM_PAIRING_CODE: z.string().min(24).max(128).regex(/^[A-Za-z0-9_-]+$/)
});

export type ParsedTelegramCommand = {
  action: "pair" | "help" | "status" | "tasks" | "result" | "ask" | "request" | "unknown";
  argument: string;
};

let cachedTelegramEnv: z.infer<typeof TelegramEnvSchema> | undefined;

export function getTelegramEnv(): z.infer<typeof TelegramEnvSchema> {
  cachedTelegramEnv ??= TelegramEnvSchema.parse(process.env);
  return cachedTelegramEnv;
}

export function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { action: "request", argument: trimmed };

  const match = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return { action: "unknown", argument: "" };
  const command = match[1]?.toLowerCase() ?? "";
  const argument = match[2]?.trim() ?? "";

  if (command === "start" || command === "help") return { action: "help", argument };
  if (["pair", "status", "tasks", "result", "ask", "request"].includes(command)) {
    return { action: command as ParsedTelegramCommand["action"], argument };
  }
  return { action: "unknown", argument };
}

export function telegramCallbackReply(callbackQueryId: string, text: string) {
  return {
    method: "answerCallbackQuery",
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
    show_alert: false
  };
}

export function telegramWebhookReply(chatId: number, messageId: number, text: string) {
  return {
    method: "sendMessage",
    chat_id: chatId,
    text: text.slice(0, 4_096),
    link_preview_options: { is_disabled: true },
    reply_parameters: { message_id: messageId }
  };
}
