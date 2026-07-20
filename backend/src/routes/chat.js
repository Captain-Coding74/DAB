/**
 * routes/chat.js — v16 extraction from the createApp() god-factory.
 * Chat (buffered + SSE streaming) and the tool-use deep-dive agent.
 */
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";
import { analyzeLimiter } from "../middleware/rateLimiter.js";
import { runAgent } from "../services/agent.js";
import { cache } from "../services/cache.js";

export function mountChatRoutes(app, { ai }) {
  // ── AI Chat with dataset ──────────────────────────────────
  app.post("/api/analyses/:id/chat", requireAuth, async (req, res, next) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "message required" });

      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const history = await R.getChatHistory(req.params.id);
      const statsJson = analysis.stats_json ? JSON.parse(analysis.stats_json) : {};

      // Build message history for Claude
      const messages = [
        {
          role: "user",
          content: `Context — you previously analysed this dataset:\n${analysis.analysis}\n\nStats summary:\n${JSON.stringify(statsJson.colAnalysis?.slice(0,5), null, 1)}\n\nAnswer follow-up questions about this data concisely in Thai.`
        },
        { role: "assistant", content: "เข้าใจแล้วครับ พร้อมตอบคำถามเกี่ยวกับข้อมูลนี้" },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message }
      ];

      const reply = await ai.messages.create({ model: "claude-sonnet-4-6", max_tokens: 800, messages });
      const replyText = reply.content[0].text;

      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "user", content: message });
      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "assistant", content: replyText });

      res.json({ reply: replyText });
    } catch (err) { next(err); }
  });

  // v12: deep-dive agent — the model queries the persisted stats through
  // tools and returns both the answer and the trail of checks it ran.
  app.post("/api/analyses/:id/agent", analyzeLimiter(), requireAuth, async (req, res, next) => {
    try {
      const { question } = req.body;
      if (!question) return res.status(400).json({ error: "question required" });

      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });
      const statsJson = analysis.stats_json ? JSON.parse(analysis.stats_json) : {};

      const { reply, steps } = await runAgent({ client: ai, statsJson, analysisText: analysis.analysis, question });

      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "user",      content: question });
      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "assistant", content: reply });

      res.json({ success: true, reply, steps });
    } catch (err) { next(err); }
  });

  // v11: token-by-token streaming over SSE. The classic POST /chat stays as
  // the client's fallback, so a stream failure never strands the user.
  app.post("/api/analyses/:id/chat/stream", requireAuth, async (req, res, next) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "message required" });

      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });

      const history   = await R.getChatHistory(req.params.id);
      const statsJson = analysis.stats_json ? JSON.parse(analysis.stats_json) : {};
      const messages = [
        { role: "user", content: `Context — you previously analysed this dataset:\n${analysis.analysis}\n\nStats summary:\n${JSON.stringify(statsJson.colAnalysis?.slice(0,5), null, 1)}\n\nAnswer follow-up questions about this data concisely in Thai.` },
        { role: "assistant", content: "เข้าใจแล้วครับ พร้อมตอบคำถามเกี่ยวกับข้อมูลนี้" },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ];

      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection":    "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const stream = ai.messages.stream({ model: "claude-sonnet-4-6", max_tokens: 800, messages });
      stream.on("text", (t) => res.write(`data: ${JSON.stringify({ t })}\n\n`));

      const final = await stream.finalMessage();
      const replyText = final.content[0].text;
      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "user",      content: message });
      await R.saveChatMessage({ analysisId: req.params.id, userId: req.user.userId, role: "assistant", content: replyText });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      // Headers already sent → emit an SSE error event; otherwise normal error path
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: err.message || "stream failed" })}\n\n`);
        res.end();
      } else next(err);
    }
  });

  app.get("/api/analyses/:id/chat", requireAuth, async (req, res, next) => {
    try {
      const analysis = await R.getAnalysis(req.params.id, req.user.userId);
      if (!analysis) return res.status(404).json({ error: "Analysis not found" });
      res.json(await R.getChatHistory(req.params.id));
    } catch (err) { next(err); }
  });
}
