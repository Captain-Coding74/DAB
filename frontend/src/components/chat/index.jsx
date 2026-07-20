import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, User } from "lucide-react";
import { apiFetch, useAppStore } from "../../store";
import { WaveBars } from "../ui";

export function ChatPanel({ analysisId }) {
  const toast = useAppStore(s => s.toast);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res  = await apiFetch(`/api/analyses/${analysisId}/chat`);
        const data = await res.json();
        if (res.ok) setMessages(Array.isArray(data) ? data : []);
      } catch {}
      setFetching(false);
    })();
  }, [analysisId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // v11: stream tokens live over SSE; if the stream can't start or breaks
  // before any text arrives, fall back to the classic endpoint silently.
  const sendClassic = async (text) => {
    const res  = await apiFetch(`/api/analyses/${analysisId}/chat`, {
      method: "POST", body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setMessages(m => [...m, { role: "assistant", content: data.reply, created_at: new Date().toISOString() }]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: text, created_at: new Date().toISOString() }]);
    setLoading(true);
    let streamedAny = false;
    try {
      const res = await apiFetch(`/api/analyses/${analysisId}/chat/stream`, {
        method: "POST", body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) throw new Error("stream unavailable");

      // live assistant bubble that fills token by token
      setMessages(m => [...m, { role: "assistant", content: "", created_at: new Date().toISOString(), streaming: true }]);
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n"); buf = events.pop();
        for (const ev of events) {
          const line = ev.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.t) {
            streamedAny = true;
            setMessages(m => {
              const next = [...m];
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + payload.t };
              return next;
            });
          }
          if (payload.error) throw new Error(payload.error);
        }
      }
      setMessages(m => { const next = [...m]; delete next[next.length - 1].streaming; return next; });
    } catch (err) {
      // Remove the empty live bubble, then fall back or surface the error
      setMessages(m => m[m.length - 1]?.streaming && !streamedAny ? m.slice(0, -1) : m);
      if (!streamedAny) {
        try { await sendClassic(text); }
        catch (e2) { toast(e2.message, "error"); }
      } else {
        toast(err.message, "error");
      }
    }
    setLoading(false);
  };

  if (fetching) return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3" aria-busy="true">
      <div className="h-2.5 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800"/>
      <div className="h-16 w-3/4 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"/>
      <div className="h-16 w-2/3 ml-auto animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"/>
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center">
            <Bot size={13} className="text-white"/>
          </div>
          <p className="eyebrow !text-[11px]">ถาม-ตอบกับข้อมูลชุดนี้</p>
        </div>
        <span className="num text-[10px] text-gray-400 dark:text-gray-500">Q&amp;A</span>
      </div>

      {/* Messages */}
      <div className="h-72 overflow-y-auto p-4 space-y-3 scrollbar-hide">
        {messages.length === 0 && !loading && (
          <div className="text-center text-sm text-gray-400 pt-8">
            <Bot size={28} className="mx-auto mb-2 text-gray-300"/>
            <p>เริ่มถามคำถามเกี่ยวกับข้อมูลได้เลยครับ</p>
            <div className="flex flex-wrap gap-2 justify-center mt-3">
              {["สรุปข้อมูลสั้นๆ", "column ไหนสำคัญที่สุด?", "มี outlier มั้ย?"].map(q => (
                <button key={q} onClick={() => setInput(q)}
                  className="font-mono text-[11px] px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded flex-shrink-0 flex items-center justify-center ${m.role === "user" ? "bg-gray-200 dark:bg-gray-700" : "bg-brand-500"}`}>
              {m.role === "user" ? <User size={13} className="text-gray-600 dark:text-gray-300"/> : <Bot size={13} className="text-white"/>}
            </div>
            <div className={`max-w-[80%] text-sm px-3.5 py-2.5 rounded-xl leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-brand-500 text-white" : "bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800 border-l-2 border-l-brand-500 dark:border-l-brand-400"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded bg-brand-500 flex items-center justify-center flex-shrink-0">
              <Bot size={13} className="text-white"/>
            </div>
            <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 border-l-2 border-l-brand-500 dark:border-l-brand-400 px-4 py-3 rounded-xl flex items-center">
              <WaveBars/>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="ถามเกี่ยวกับ dataset... (Enter ส่ง)"
          className="flex-1 text-sm px-3.5 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white dark:bg-gray-800 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600"
        />
        <button onClick={send} disabled={!input.trim() || loading}
          aria-label="ส่งคำถาม" className="w-9 h-9 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors">
          <Send size={14} className="text-white"/>
        </button>
      </div>
    </div>
  );
}
