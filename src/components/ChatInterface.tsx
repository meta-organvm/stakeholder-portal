"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { parseSseChunk } from "@/lib/sse";
import { EvidencePanel } from "./EvidencePanel";
import type { EvidenceCitation } from "./EvidencePanel";
import { FeedbackActions } from "./FeedbackActions";
import manifest from "@/data/manifest.json";

interface MessageMeta {
  citations?: EvidenceCitation[];
  confidence_score?: number;
  citation_coverage?: number;
  strategy?: string;
  suggestions?: string[];
  answerability?: "answerable" | "partial" | "unanswerable";
  answerability_reason?: string;
  diagnostics?: {
    path: string;
    planner: {
      strategy: string;
      answerability: string;
      reason: string;
      target_repos: number;
      target_organs: number;
      sub_queries: number;
    };
    retrieval?: {
      strategy: string;
      source_count: number;
      total_candidates: number;
    };
    provider?: {
      name: string;
      status: string;
      reason?: string;
    };
  };
}

interface Message {
  role: "user" | "assistant";
  content: string;
  meta?: MessageMeta;
}

function sanitizeHref(href: string | undefined): string {
  if (!href) return "#";
  if (href.startsWith("/")) return href;
  try {
    const parsed = new URL(href, "https://organvm.local");
    if (parsed.hostname === "organvm.local") {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return href;
    }
  } catch {
    return "#";
  }
  return "#";
}

const STARTERS = [
  "What is ORGANVM?",
  "Which products are deployed?",
  "What's the tech stack for Styx?",
  "How many repos are in each organ?",
  "What happened in the last sprint?",
  "Show me the flagship repos",
];

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    // Add empty assistant message for streaming
    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err.error || "Something went wrong"}`,
          };
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setIsStreaming(false);
        return;
      }

      let accumulated = "";
      let buffered = "";
      let streamDone = false;
      let messageMeta: MessageMeta = {};

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const parsedChunk = parseSseChunk(buffered, chunk);
        buffered = parsedChunk.remainder;
        streamDone = parsedChunk.done;

        for (const data of parsedChunk.payloads) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              accumulated += `\n\n*${parsed.error}*`;
            } else if (parsed.text) {
              accumulated += parsed.text;
            } else if (parsed.citations) {
              // Citation metadata chunk
              messageMeta = {
                citations: parsed.citations,
                confidence_score: parsed.confidence_score,
                citation_coverage: parsed.citation_coverage,
                strategy: parsed.strategy,
                suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
                answerability: parsed.answerability,
                answerability_reason: parsed.answerability_reason,
                diagnostics: parsed.diagnostics,
              };
            }

            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: accumulated,
                meta: messageMeta,
              };
              return updated;
            });
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Failed to connect. Please try again.",
        };
        return updated;
      });
    }

    setIsStreaming(false);
    inputRef.current?.focus();
  }

  const syncDate = manifest.generated
    ? new Date(manifest.generated).toLocaleString()
    : "Live State";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Last Synced Indicator */}
      <div className="flex items-center gap-2 px-1 py-2 text-[10px] text-[var(--color-text-dim)] mb-2 border-b border-[var(--color-border)] select-none">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-fresh)] animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
        <span className="font-medium tracking-wide uppercase">System Synced:</span>
        <span className="font-mono text-[var(--color-text-muted)]">{syncDate}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h2 className="text-2xl font-bold mb-2">Ask anything about ORGANVM</h2>
            <p className="text-[var(--color-text-muted)] mb-6 max-w-md">
              Get instant answers about repos, deployments, architecture,
              sprints, and more across all 8 organs and 100+ repositories.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="glass-panel rounded-full px-5 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-white transition-all hover:scale-105 active:scale-95"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-lg px-6 py-5 assistant-message-border ${
                msg.role === "user"
                  ? "user-message-gradient text-white !max-w-[68%]"
                  : "bg-[var(--color-surface)] border border-[var(--color-border)] assistant-bubble-shadow"
              }`}
            >
              {msg.role === "assistant" ? (
                <>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => {
                          const safeHref = sanitizeHref(href);
                          const isExternal = !safeHref.startsWith("/");
                          return (
                            <a
                              href={safeHref}
                              className="text-[var(--color-accent)] hover:underline"
                              rel="noopener noreferrer nofollow"
                              target={isExternal ? "_blank" : undefined}
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {msg.content || (isStreaming && i === messages.length - 1 ? "Thinking..." : "")}
                    </ReactMarkdown>
                  </div>
                  {/* Evidence panel for cited responses */}
                  {msg.meta?.citations && msg.meta.citations.length > 0 && !isStreaming && (
                    <EvidencePanel
                      citations={msg.meta.citations}
                      confidence_score={msg.meta.confidence_score ?? 0}
                      citation_coverage={msg.meta.citation_coverage ?? 0}
                    />
                  )}
                  {/* Feedback actions */}
                  {msg.content && !isStreaming && i === messages.length - 1 && (msg.meta?.suggestions?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(msg.meta?.suggestions ?? []).map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => sendMessage(suggestion)}
                          className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.content && !isStreaming && i === messages.length - 1 && msg.meta?.diagnostics && (
                    <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                      Diagnostics: path={msg.meta.diagnostics.path}, strategy={msg.meta.diagnostics.planner.strategy}, provider={msg.meta.diagnostics.provider?.name ?? "none"} ({msg.meta.diagnostics.provider?.status ?? "n/a"})
                    </div>
                  )}
                  {msg.content && !isStreaming && i === messages.length - 1 && (
                    <FeedbackActions
                      query={messages.filter((m) => m.role === "user").pop()?.content ?? ""}
                      responseText={msg.content}
                      citationIds={msg.meta?.citations?.map((c) => c.id)}
                      strategy={msg.meta?.strategy}
                      answerability={msg.meta?.answerability}
                      answerabilityReason={msg.meta?.answerability_reason}
                      suggestions={msg.meta?.suggestions}
                    />
                  )}
                </>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-3 chat-input-container items-center"
      >
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask ORGANVM..."
            disabled={isStreaming}
            className="w-full chat-input focus:outline-none disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="send-button text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none"
        >
          {isStreaming ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
