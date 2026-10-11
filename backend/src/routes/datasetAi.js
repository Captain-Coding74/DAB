/**
 * PATCH /api/datasets/:id/ai — the dataset's AI switch (v21.30).
 *
 * Owner only, like sharing and deleting: the owner answers for the data, so
 * the owner decides whether any of it goes to the AI provider. An editor who
 * could switch AI back on would undo the owner's choice for everyone, and a
 * viewer has no say at all. Registered in routes/datasets.js (so the
 * permission matrix sees it with the other dataset routes); the handler
 * lives here to keep that file under its size ratchet.
 *
 * Body: { aiEnabled: true | false }. Effect: services/aiGate.js.
 */
import * as DR from "../db/datasetRepository.js";
import * as CR from "../db/collabRepository.js";
import { getAnalysis } from "../db/repository.js";
import { flagOn } from "../services/aiGate.js";

export async function setDatasetAi(req, res, next) {
  try {
    const role = await DR.getUserDatasetRole(req.params.id, req.user.userId);
    if (!role) return res.status(403).json({ error: "No access to this dataset" });
    if (role !== "owner") {
      return res.status(403).json({
        error: "เฉพาะเจ้าของชุดข้อมูลเท่านั้นที่เปิด-ปิด AI ได้",
        errorEn: "only the dataset owner can switch AI on or off",
      });
    }
    const { aiEnabled } = req.body || {};
    if (typeof aiEnabled !== "boolean") {
      return res.status(400).json({ error: "aiEnabled (true/false) required", errorEn: "aiEnabled (true/false) required" });
    }
    await DR.setDatasetAiEnabled(req.params.id, aiEnabled);
    /* Collaborators see the switch flip in the activity feed — an editor who
       finds the AI features refusing should be able to see why. */
    await CR.logActivity({ datasetId: req.params.id, userId: req.user.userId,
      action: aiEnabled ? "dataset_ai_on" : "dataset_ai_off" });
    res.json({ success: true, aiEnabled });
  } catch (err) { next(err); }
}

/**
 * POST /api/datasets from the result on screen — "Save dataset" (v21.30).
 *
 * The SPA names the analysis it is saving (`analysisId`) and repeats the
 * upload's "Statistics only" choice (`noAi`). The analysis is linked to the
 * new dataset, so the dataset's AI switch and its deletion cover it. And a
 * statistics-only upload makes a dataset with AI OFF: otherwise chat, the
 * agent, fix-suggest and AI edit on the saved copy would send what the user
 * chose to keep from the AI. The server reads the choice off the analysis
 * too, so an older client that sends only the id cannot undo it.
 *
 * Returns { analysis, aiEnabled }, or answers 404 (not the caller's
 * analysis) and returns null — before anything is stored.
 */
export async function saveSource(req, res) {
  const id = req.body?.analysisId || null;
  const analysis = id ? await getAnalysis(id, req.user.userId) : null;
  if (id && !analysis) { res.status(404).json({ error: "Analysis not found" }); return null; }
  const aiEnabled = !flagOn(req.body?.noAi) && Number(analysis?.ai_disabled ?? 0) === 0;
  return { analysis, aiEnabled };
}
