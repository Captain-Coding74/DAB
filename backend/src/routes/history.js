/**
 * routes/history.js — v16 extraction from the createApp() god-factory.
 * Saved analysis history.
 */
import * as R from "../db/repository.js";
import { requireAuth } from "../auth.js";
import { cache } from "../services/cache.js";
import { pageParams } from "../pagination.js";

export function mountHistoryRoutes(app) {
  // ── History ───────────────────────────────────────────────
  app.get("/api/history", requireAuth, async (req, res, next) => {
    try {
      const { limit, offset } = pageParams(req.query, { defaultLimit: 20 });
      const page   = `${Math.floor(offset/limit)}_${limit}`;
      const ck     = `user:${req.user.userId}:history:${page}`;
      let cached   = await cache.get(ck);
      if (!cached) {
        const [items, total] = await Promise.all([R.getUserAnalyses(req.user.userId,{limit,offset}), R.getAnalysisCount(req.user.userId)]);
        cached = { items, total };
        await cache.set(ck, cached, 30);
      }
      res.set("X-Total-Count", cached.total).json(cached.items);
    } catch (err) { next(err); }
  });

  app.get("/api/history/:id", requireAuth, async (req, res, next) => {
    try {
      const ck  = `analysis:${req.params.id}`;
      let rec   = await cache.get(ck);
      if (!rec) { rec = await R.getAnalysis(req.params.id, req.user.userId); if (rec) await cache.set(ck, rec, 120); }
      rec ? res.json(rec) : res.status(404).json({ error: "Not found" });
    } catch (err) { next(err); }
  });

  app.delete("/api/history/:id", requireAuth, async (req, res, next) => {
    try {
      await R.deleteAnalysis(req.params.id, req.user.userId);
      await cache.del(`analysis:${req.params.id}`);
      await cache.delPattern(`user:${req.user.userId}:history:`);
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}
