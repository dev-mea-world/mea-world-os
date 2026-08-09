import { TelegramUpdateSchema } from "@meaworld/domain";
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import {
  constantTimeEqual,
  getTelegramEnv,
  parseTelegramCommand,
  telegramWebhookReply
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

const taskIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function taskStatusLine(status: string): string {
  const labels: Record<string, string> = {
    ready: "in coda",
    leased: "assegnata",
    running: "in esecuzione",
    succeeded: "completata",
    failed_retryable: "da ritentare",
    failed_terminal: "fallita",
    interrupted: "interrotta",
    cancelled: "annullata"
  };
  return labels[status] ?? status;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const telegramEnv = getTelegramEnv();
  const webhookSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEqual(webhookSecret, telegramEnv.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedUpdate = TelegramUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsedUpdate.success) return NextResponse.json({ ok: true });
  const message = parsedUpdate.data.message;
  if (!message?.text || message.from.is_bot) return NextResponse.json({ ok: true });
  if (message.chat.type !== "private") {
    return NextResponse.json(telegramWebhookReply(
      message.chat.id,
      message.message_id,
      "Per sicurezza questo bot funziona soltanto in una chat privata."
    ));
  }

  const command = parseTelegramCommand(message.text);
  const result = await getStore().processTelegramCommand({
    updateId: parsedUpdate.data.update_id,
    chatId: message.chat.id,
    userId: message.from.id,
    username: message.from.username ?? null,
    messageId: message.message_id,
    action: command.action,
    pairCodeValid: command.action === "pair"
      && constantTimeEqual(command.argument, telegramEnv.TELEGRAM_PAIRING_CODE),
    prompt: command.action === "ask" ? command.argument : null
  });
  if (result.duplicate) return NextResponse.json({ ok: true });

  let reply: string;
  if (result.reason === "invalid_pairing_code") {
    reply = "Codice di associazione non valido.";
  } else if (result.reason === "already_paired") {
    reply = "Il bot è già associato a un altro account. Revoca prima l’associazione dalla dashboard.";
  } else if (result.reason === "not_paired") {
    reply = "Bot non ancora associato. Usa /pair seguito dal codice di associazione.";
  } else if (result.reason === "invalid_prompt") {
    reply = "La richiesta deve contenere da 1 a 4000 caratteri.";
  } else if (result.paired) {
    reply = "Account associato. Ora puoi usare /status, /tasks, /result oppure scrivere una domanda.";
  } else if (command.action === "help") {
    reply = result.authorized
      ? "Comandi: /status, /tasks, /result [task-id], /ask domanda. Puoi anche scrivere direttamente una domanda."
      : "Per iniziare usa /pair seguito dal codice di associazione.";
  } else if (command.action === "status") {
    const snapshot = await getStore().dashboardSnapshot();
    const activeRun = snapshot.worker?.activeRunId
      ? snapshot.runs.find((run) => run.id === snapshot.worker?.activeRunId)
      : null;
    const activeTask = activeRun
      ? snapshot.tasks.find((task) => task.id === activeRun.taskId)
      : null;
    const activity = activeTask
      ? `In esecuzione: ${activeTask.objective}\nRun: ${activeRun?.id}`
      : "Attività: idle, in attesa di task";
    reply = [
      `Sistema: ${snapshot.systemStatus}`,
      `Worker: ${snapshot.worker?.status ?? "missing"}`,
      activity,
      `Task attive: ${snapshot.tasks.filter((task) => ["ready", "leased", "running"].includes(task.status)).length}`
    ].join("\n");
  } else if (command.action === "tasks") {
    const tasks = await getStore().telegramTasks(message.chat.id);
    reply = tasks.length === 0
      ? "Nessuna task Telegram ancora registrata."
      : tasks.map(({ task, latestRun }) => [
          `${task.id} · ${taskStatusLine(task.status)}`,
          task.objective,
          latestRun ? `run ${latestRun.id}` : "nessuna run"
        ].join("\n")).join("\n\n");
  } else if (command.action === "result") {
    const requestedTaskId = command.argument && taskIdPattern.test(command.argument)
      ? command.argument
      : undefined;
    if (command.argument && !requestedTaskId) {
      reply = "Task ID non valido.";
    } else {
      const tasks = await getStore().telegramTasks(message.chat.id, requestedTaskId, 1);
      const latest = tasks[0];
      if (!latest) {
        reply = "Nessun risultato trovato.";
      } else {
        const response = latest.latestRun?.output?.response;
        reply = typeof response === "string"
          ? `${taskStatusLine(latest.task.status)}\n\n${response.slice(0, 3_800)}`
          : `${taskStatusLine(latest.task.status)}: ${latest.task.objective}`;
      }
    }
  } else if (command.action === "ask" && result.task) {
    reply = `Task accodata: ${result.task.id}\nSegui l’esecuzione dalla dashboard o usa /result ${result.task.id}`;
  } else {
    reply = "Comando non riconosciuto. Usa /help.";
  }

  return NextResponse.json(telegramWebhookReply(message.chat.id, message.message_id, reply));
}
