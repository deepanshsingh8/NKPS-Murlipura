"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  X,
  Send,
  Maximize2,
  Minimize2,
  ArrowLeft,
  Sparkles,
  Phone,
  ChevronRight,
} from "lucide-react";
import { SCHOOL } from "@nkps/shared/lib/constants";
import { cn } from "@nkps/shared/lib/utils";

function formatMessage(text: string) {
  // Split into lines and process
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-4 my-1 space-y-0.5">
          {listItems.map((item, i) => (
            <li key={i}>{formatInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^[-*•]\s+(.+)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
    } else {
      flushList();
      if (line.trim() === "") {
        elements.push(<br key={`br-${i}`} />);
      } else {
        elements.push(
          <span key={`line-${i}`}>
            {formatInline(line)}
            {i < lines.length - 1 && !lines[i + 1]?.match(/^[-*•]\s+/) ? <br /> : null}
          </span>
        );
      }
    }
  }
  flushList();
  return <>{elements}</>;
}

function formatInline(text: string): React.ReactNode {
  // Parse **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hello! \u{1F44B} I'm the NK Public School assistant. I can help you with information about admissions, academics, facilities, fees, and more. How can I help you today?",
};

// A few starter questions surfaced on the home screen so visitors know the
// kinds of things the agent can answer without having to think of a prompt.
const SUGGESTED_QUESTIONS = [
  "What are the admission requirements?",
  "What facilities does the school offer?",
  "What are the school timings?",
  "How can I contact the school?",
];

type View = "home" | "chat";

export function NkpsAgent() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const phoneNumber = SCHOOL.phone[0];
  const whatsappUrl = `https://wa.me/${SCHOOL.whatsapp}?text=${encodeURIComponent(
    "Hello! I'd like to know more about NK Public School."
  )}`;

  useEffect(() => {
    if (view === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, view]);

  useEffect(() => {
    if (isOpen && view === "chat") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, view]);

  const sendMessage = async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m !== WELCOME_MESSAGE)
        .slice(-10);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I'm having trouble connecting. Please try again or contact the school at ${phoneNumber}.`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const openChatWith = (question?: string) => {
    setView("chat");
    if (question) {
      // Let the view switch commit before firing the request.
      setTimeout(() => sendMessage(question), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "absolute bottom-16 right-0 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-navy-900/10 transition-all duration-300",
              isExpanded && view === "chat"
                ? "w-[90vw] md:w-[600px] h-[80vh] md:h-[700px]"
                : "w-[calc(100vw-2rem)] sm:w-80 md:w-96 h-[70vh] sm:h-[500px]"
            )}
          >
            {/* Header */}
            <div className="bg-navy-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {view === "chat" ? (
                  <button
                    onClick={() => setView("home")}
                    className="text-white/70 hover:text-white transition-colors p-1 -ml-1"
                    aria-label="Back to menu"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-500/20">
                    <Bot className="w-5 h-5 text-gold-400" />
                  </span>
                )}
                <div className="flex flex-col leading-tight">
                  <span className="font-heading font-semibold text-sm">
                    NKPS Agent
                  </span>
                  <span className="text-[11px] text-white/60">
                    {view === "chat" ? "AI Assistant" : "Here to help you"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {view === "chat" && (
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-white/70 hover:text-white transition-colors p-1"
                    aria-label={isExpanded ? "Minimize chat" : "Expand chat"}
                  >
                    {isExpanded ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-white/70 hover:text-white transition-colors p-1"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {view === "home" ? (
              /* Home menu — pick how to get help */
              <div className="flex-1 overflow-y-auto">
                {/* Greeting */}
                <div className="bg-gradient-to-b from-navy-900 to-navy-900/95 text-white px-4 pb-5 pt-1">
                  <p className="text-sm text-white/80 leading-relaxed">
                    Hi there! I&apos;m the <strong className="text-white">NKPS Agent</strong>.
                    Ask me anything about the school, message us on WhatsApp,
                    or talk to a real person — whatever works best for you.
                  </p>
                </div>

                <div className="p-4 space-y-3">
                  {/* Ask the AI assistant */}
                  <button
                    onClick={() => openChatWith()}
                    className="w-full text-left group flex items-start gap-3 rounded-xl border border-navy-900/10 bg-cream-50/60 p-3 hover:border-gold-500/60 hover:bg-cream-50 transition-all"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-gold-500 to-gold-400 text-navy-900">
                      <Sparkles className="w-5 h-5" />
                    </span>
                    <span className="flex-1">
                      <span className="flex items-center justify-between">
                        <span className="font-heading font-semibold text-sm text-navy-900">
                          Ask a question
                        </span>
                        <ChevronRight className="w-4 h-4 text-navy-900/30 group-hover:text-gold-500 transition-colors" />
                      </span>
                      <span className="block text-xs text-navy-900/60 mt-0.5">
                        Get instant answers about admissions, academics, fees & more
                      </span>
                    </span>
                  </button>

                  {/* Message on WhatsApp */}
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full text-left group flex items-start gap-3 rounded-xl border border-navy-900/10 bg-cream-50/60 p-3 hover:border-[#25D366]/50 hover:bg-cream-50 transition-all"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                    </span>
                    <span className="flex-1">
                      <span className="flex items-center justify-between">
                        <span className="font-heading font-semibold text-sm text-navy-900">
                          Message on WhatsApp
                        </span>
                        <ChevronRight className="w-4 h-4 text-navy-900/30 group-hover:text-[#25D366] transition-colors" />
                      </span>
                      <span className="block text-xs text-navy-900/60 mt-0.5">
                        Chat with our team directly on WhatsApp
                      </span>
                    </span>
                  </a>

                  {/* Talk to a person */}
                  <a
                    href={`tel:${phoneNumber.replace(/[^+\d]/g, "")}`}
                    className="w-full text-left group flex items-start gap-3 rounded-xl border border-navy-900/10 bg-cream-50/60 p-3 hover:border-blue-600/50 hover:bg-cream-50 transition-all"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                      <Phone className="w-5 h-5" />
                    </span>
                    <span className="flex-1">
                      <span className="flex items-center justify-between">
                        <span className="font-heading font-semibold text-sm text-navy-900">
                          Talk to a person
                        </span>
                        <ChevronRight className="w-4 h-4 text-navy-900/30 group-hover:text-blue-600 transition-colors" />
                      </span>
                      <span className="block text-xs text-navy-900/60 mt-0.5">
                        Call the school office at {phoneNumber}
                      </span>
                    </span>
                  </a>

                  {/* Quick starter questions */}
                  <div className="pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-900/40 mb-2">
                      Popular questions
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => openChatWith(q)}
                          className="rounded-full border border-navy-900/15 bg-white px-3 py-1.5 text-xs text-navy-900/80 hover:border-gold-500 hover:text-navy-900 transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Chat view */
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={cn(
                          "px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap",
                          isExpanded ? "max-w-[70%]" : "max-w-[80%]",
                          msg.role === "user"
                            ? "bg-gold-500 text-navy-900 rounded-br-sm"
                            : "bg-cream-50 text-navy-900 rounded-bl-sm"
                        )}
                      >
                        {msg.role === "assistant" ? formatMessage(msg.content) : msg.content}
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-cream-50 text-navy-900 px-4 py-3 rounded-2xl rounded-bl-sm">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-navy-900/40 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-2 h-2 bg-navy-900/40 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-2 h-2 bg-navy-900/40 rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-3 border-t border-navy-900/10 shrink-0">
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type your question..."
                      disabled={isLoading}
                      className="flex-1 px-3 py-2 text-sm rounded-full border border-navy-900/20 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500 disabled:opacity-50 text-navy-900 placeholder:text-navy-900/40"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={isLoading || !input.trim()}
                      className="w-9 h-9 rounded-full bg-gradient-to-r from-gold-500 to-gold-400 text-navy-900 flex items-center justify-center hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      aria-label="Send message"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Button — single unified entry point */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-14 h-14 rounded-full bg-gradient-to-r from-gold-500 to-gold-400 text-navy-900 flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105"
        aria-label="Open NKPS Agent"
      >
        {!isOpen && (
          <span className="absolute inset-0 rounded-full bg-gold-500/40 animate-ping" />
        )}
        <span className="relative">
          {isOpen ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
        </span>
      </button>
    </div>
  );
}
