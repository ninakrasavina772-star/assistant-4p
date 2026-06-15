import { NextResponse } from "next/server";
import { runTemplateAssistantChat, type ChatMessage, type TemplateChatContext } from "@/lib/templateGenerator/chat";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    openaiApiKey?: string;
    messages?: ChatMessage[];
    context?: TemplateChatContext;
    model?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const key = body.openaiApiKey?.trim();
  if (!key) {
    return NextResponse.json({ error: "Нужен OpenAI API key" }, { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!messages.length) {
    return NextResponse.json({ error: "Нужны messages" }, { status: 400 });
  }

  try {
    const reply = await runTemplateAssistantChat(key, messages, body.context ?? {}, body.model);
    return NextResponse.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка чата";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
