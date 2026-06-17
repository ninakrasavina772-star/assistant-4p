"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, TemplateChatContext } from "@/lib/templateGenerator/chat";
import { homeBtnPrimary, homeInput } from "@/components/homeTheme";

type Props = {
  apiKey: string;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  context: TemplateChatContext;
  onError?: (message: string) => void;
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function TemplateGeneratorChat({
  apiKey,
  messages,
  onMessagesChange,
  context,
  onError
}: Props) {
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      if (!apiKey.trim()) {
        onError?.("Введите OpenAI API key, чтобы общаться с ассистентом");
        return;
      }

      const userMsg: ChatMessage = {
        id: `${Date.now()}-u`,
        role: "user",
        content: trimmed,
        at: Date.now()
      };
      const next = [...messages, userMsg];
      onMessagesChange(next);
      setDraft("");
      setThinking(true);

      try {
        const res = await fetch("/api/template-generator/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openaiApiKey: apiKey.trim(),
            messages: next,
            context
          })
        });
        const j = (await res.json()) as { reply?: string; error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        const assistantMsg: ChatMessage = {
          id: `${Date.now()}-a`,
          role: "assistant",
          content: j.reply ?? "Понял.",
          at: Date.now()
        };
        onMessagesChange([...next, assistantMsg]);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Ошибка чата");
      } finally {
        setThinking(false);
      }
    },
    [apiKey, context, messages, onError, onMessagesChange, thinking]
  );

  const toggleVoice = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onError?.("Голосовой ввод не поддерживается в этом браузере (попробуйте Chrome)");
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = "ru-RU";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (ev) => {
      const results = ev.results as unknown as Array<{ 0: { transcript: string } }>;
      let text = "";
      for (let i = 0; i < results.length; i++) {
        text += results[i]?.[0]?.transcript ?? "";
      }
      setDraft((prev) => (prev ? `${prev} ${text}` : text).trim());
    };

    rec.onerror = (ev) => {
      if (ev.error !== "aborted") {
        onError?.(`Голосовой ввод: ${ev.error ?? "ошибка"}`);
      }
      setListening(false);
    };

    rec.onend = () => setListening(false);

    try {
      rec.start();
      setListening(true);
    } catch {
      onError?.("Не удалось запустить микрофон — разрешите доступ в браузере");
      setListening(false);
    }
  }, [listening, onError]);

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-4 py-2.5">
        <p className="text-sm font-semibold text-slate-800">Ассистент</p>
        <p className="text-xs text-slate-500">
          Правила для AI, сопоставление полей, стиль текстов. Можно писать или диктовать 🎤
        </p>
      </div>

      <div
        ref={listRef}
        className="flex max-h-[min(420px,50vh)] min-h-[220px] flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
                m.role === "user"
                  ? "bg-[#ffd740] text-slate-900"
                  : "border border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              {m.role === "assistant" ? (
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Ассистент
                </span>
              ) : null}
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {thinking ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500">
              Печатает…
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          className={`${homeInput} min-h-[44px] flex-1 resize-y`}
          rows={2}
          placeholder="Правила: название на русском, только ноты, стиль описания…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          disabled={thinking}
        />
        {voiceSupported ? (
          <button
            type="button"
            title="Голосовой ввод"
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              listening
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            disabled={thinking}
            onClick={toggleVoice}
          >
            {listening ? "⏹ Стоп" : "🎤"}
          </button>
        ) : null}
        <button
          type="submit"
          className={homeBtnPrimary}
          disabled={thinking || !draft.trim()}
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
