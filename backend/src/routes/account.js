/**
 * routes/account.js — the user's own rights over their account (v21.30).
 *
 *   GET    /api/auth/me/export  everything DAB holds about you, as a JSON download
 *   DELETE /api/auth/me         erase the account and everything it owns
 *                               (body { password }; 400 PASSWORD_REQUIRED, 401 wrong password)
 *
 * Both act on the signed-in user only — there is no id to pass, so neither
 * can reach another account. Both are logged in the privacy-request log
 * (services/privacyRequests.js) under a hash of the user id, and both sit
 * behind accountLimiter. The /account page in the SPA drives them; requests
 * by email or post go through scripts/privacy-request.mjs instead.
 */
import bcrypt from "bcryptjs";
import * as R from "../db/repository.js";
import { requireAuth, markErased, clearErased } from "../auth.js";
import { accountLimiter } from "../middleware/rateLimiter.js";
import { collectAccountData, exportFileName } from "../db/accountData.js";
import { eraseAccount } from "../db/accountErase.js";
import { logPrivacyRequest, completePrivacyRequest } from "../services/privacyRequests.js";
import { serviceLogger } from "../logger.js";

const log = serviceLogger("account");

export function mountAccountRoutes(app) {
  // One budget for both routes: a burst of wrong passwords also spends the exports.
  const limiter = accountLimiter();

  app.get("/api/auth/me/export", requireAuth, limiter, async (req, res, next) => {
    try {
      const data = await collectAccountData(req.user.userId);
      if (!data) return res.status(404).json({ error: "Not found" });
      await logPrivacyRequest({ subject: req.user.userId, type: "export", channel: "self-service" });
      res.set("Cache-Control", "no-store");
      res.attachment(exportFileName(data.profile.username));
      res.type("application/json").send(JSON.stringify(data, null, 2));
    } catch (err) { next(err); }
  });

  app.delete("/api/auth/me", requireAuth, limiter, async (req, res, next) => {
    const userId = req.user.userId;
    try {
      const { password } = req.body || {};
      if (typeof password !== "string" || !password) {
        return res.status(400).json({ error: "Enter your password to delete your account", code: "PASSWORD_REQUIRED" });
      }
      const user = await R.findUserCredentials(userId);
      if (!user) return res.status(404).json({ error: "Not found" });
      if (!(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Wrong password" });
      }
      // Logged as received first: if erasure fails part-way the open row is
      // the operator's cue, and the user can sign in and run it again.
      const request = await logPrivacyRequest({ subject: userId, type: "delete", channel: "self-service", status: "received" });
      markErased(userId);
      try {
        const summary = await eraseAccount(userId);
        await completePrivacyRequest(request.id);
        log.info({ request: request.id, ...summary }, "account erased");
      } catch (err) {
        clearErased(userId);
        throw err;
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  });
}
