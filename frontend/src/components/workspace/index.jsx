import React, { useState, useEffect } from "react";
import { LEDGER } from "../../lib/ledger";
const DEFAULT_BRAND = LEDGER.stamp.DEFAULT;
import { Users, Plus, Trash2, Settings, Bell, Palette } from "lucide-react";
import { apiFetch, useAppStore } from "../../store";
import { Button, Card, Badge, Input, Modal, Spinner } from "../ui";

export default function WorkspacePanel() {
  const { user, currentWorkspace, setCurrentWorkspace, toast } = useAppStore();
  const [workspaces, setWorkspaces]   = useState([]);
  const [members,    setMembers]      = useState([]);
  const [schedules,  setSchedules]    = useState([]);
  const [loading,    setLoading]      = useState(true);
  const [showCreate, setShowCreate]   = useState(false);
  const [showBrand,  setShowBrand]    = useState(false);
  const [showSched,  setShowSched]    = useState(false);
  const [newWs,      setNewWs]        = useState({ name: "", description: "", brandColor: DEFAULT_BRAND });
  const [inviteUser, setInviteUser]   = useState("");
  const [brand,      setBrand]        = useState({ brandColor: DEFAULT_BRAND, brandName: "", brandLogo: "" });
  const [newSched,   setNewSched]     = useState({ name: "", cronExpr: "0 9 * * 1", recipients: "", prompt: "สรุปภาพรวม", format: "pdf" });

  useEffect(() => { fetchWorkspaces(); }, []);
  useEffect(() => { if (currentWorkspace) { fetchMembers(); fetchSchedules(); } }, [currentWorkspace]);

  async function fetchWorkspaces() {
    setLoading(true);
    try {
      const res  = await apiFetch("/api/workspaces");
      const data = await res.json();
      if (res.ok) { setWorkspaces(data); if (data[0] && !currentWorkspace) setCurrentWorkspace(data[0]); }
    } catch {}
    setLoading(false);
  }

  async function fetchMembers() {
    if (!currentWorkspace) return;
    try {
      const res  = await apiFetch(`/api/workspaces/${currentWorkspace.id}`);
      const data = await res.json();
      if (res.ok) setMembers(data.members || []);
    } catch {}
  }

  async function fetchSchedules() {
    if (!currentWorkspace) return;
    try {
      const res  = await apiFetch(`/api/workspaces/${currentWorkspace.id}/schedules`);
      const data = await res.json();
      if (res.ok) setSchedules(Array.isArray(data) ? data : []);
    } catch {}
  }

  async function createWorkspace() {
    if (!newWs.name) return;
    try {
      const res  = await apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify(newWs) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("สร้าง workspace แล้ว! ✓");
      setShowCreate(false);
      setNewWs({ name: "", description: "", brandColor: DEFAULT_BRAND });
      await fetchWorkspaces();
    } catch (err) { toast(err.message, "error"); }
  }

  async function inviteMember() {
    if (!inviteUser || !currentWorkspace) return;
    try {
      const res  = await apiFetch(`/api/workspaces/${currentWorkspace.id}/members`, { method: "POST", body: JSON.stringify({ username: inviteUser, role: "member" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(`เชิญ ${inviteUser} แล้ว!`);
      setInviteUser("");
      fetchMembers();
    } catch (err) { toast(err.message, "error"); }
  }

  async function removeMember(userId) {
    if (!currentWorkspace) return;
    try {
      await apiFetch(`/api/workspaces/${currentWorkspace.id}/members/${userId}`, { method: "DELETE" });
      toast("ลบสมาชิกแล้ว");
      fetchMembers();
    } catch (err) { toast(err.message, "error"); }
  }

  async function saveBranding() {
    if (!currentWorkspace) return;
    try {
      const res = await apiFetch(`/api/workspaces/${currentWorkspace.id}/branding`, { method: "PATCH", body: JSON.stringify(brand) });
      if (!res.ok) throw new Error("Failed");
      toast("บันทึก branding แล้ว!");
      setShowBrand(false);
    } catch (err) { toast(err.message, "error"); }
  }

  async function createSchedule() {
    if (!currentWorkspace || !newSched.name || !newSched.recipients) return;
    try {
      const recipients = newSched.recipients.split(",").map(r => r.trim()).filter(Boolean);
      const res  = await apiFetch(`/api/workspaces/${currentWorkspace.id}/schedules`, {
        method: "POST", body: JSON.stringify({ ...newSched, recipients }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast("สร้าง schedule แล้ว!");
      setShowSched(false);
      setNewSched({ name: "", cronExpr: "0 9 * * 1", recipients: "", prompt: "สรุปภาพรวม", format: "pdf" });
      fetchSchedules();
    } catch (err) { toast(err.message, "error"); }
  }

  async function deleteSchedule(id) {
    if (!currentWorkspace) return;
    try {
      await apiFetch(`/api/workspaces/${currentWorkspace.id}/schedules/${id}`, { method: "DELETE" });
      toast("ลบ schedule แล้ว");
      fetchSchedules();
    } catch (err) { toast(err.message, "error"); }
  }

  if (loading) return <div className="flex items-center justify-center h-40"><Spinner/></div>;

  if (!user) return (
    <div className="flex items-center justify-center h-60 text-gray-400">
      <div className="text-center">
        <Users size={36} className="mx-auto mb-2 opacity-40"/>
        <p className="text-sm">กรุณา login เพื่อใช้ Workspace</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">

      {/* Workspace selector — wraps at phone widths; unwrapped, the New
          Workspace button sat at x=472 on a 390px screen and dragged 82px of
          horizontal scroll onto the whole page. */}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-3">
          <div><p className="eyebrow mb-1">พื้นที่ทีม · Teams</p><h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Workspaces</h2></div>
          {workspaces.length > 0 && (
            <select value={currentWorkspace?.id || ""} onChange={e => setCurrentWorkspace(workspaces.find(w => w.id === e.target.value))}
              className="text-sm min-w-0 max-w-[45vw] sm:max-w-xs border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-300">
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={13}/> New Workspace
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-gray-400">
            <Users size={36} className="mx-auto mb-2 opacity-30"/>
            <p className="text-sm mb-3">ยังไม่มี workspace</p>
            <Button size="sm" onClick={() => setShowCreate(true)}>สร้าง Workspace แรก</Button>
          </div>
        </Card>
      ) : currentWorkspace && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Members */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users size={15} className="text-brand-400"/>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">สมาชิก ({members.length})</span>
                </div>
              </div>
              <div className="flex gap-2 mb-4">
                <Input placeholder="username ที่จะเชิญ…" value={inviteUser} onChange={e => setInviteUser(e.target.value)} className="flex-1" onKeyDown={e => e.key==="Enter" && inviteMember()}/>
                <Button size="sm" onClick={inviteMember}><Plus size={13}/> เชิญ</Button>
              </div>
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-medium text-brand-600 dark:text-brand-300">
                        {m.username[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{m.username}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{m.email || "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.role==="owner"?"green":m.role==="admin"?"blue":"gray"}>{m.role}</Badge>
                      {m.role !== "owner" && m.id !== user?.id && (
                        <button onClick={() => removeMember(m.id)} className="p-1 text-gray-400 hover:text-red-500 transition">
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Scheduled Reports */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Bell size={15} className="text-brand-400"/>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Scheduled Reports</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setShowSched(true)}>
                  <Plus size={13}/> New Schedule
                </Button>
              </div>
              {schedules.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">ยังไม่มี scheduled report</p>
              ) : (
                <div className="space-y-2">
                  {schedules.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{s.cron_expr} · {s.format.toUpperCase()} · {s.run_count} runs</p>
                      </div>
                      <button onClick={() => deleteSchedule(s.id)} className="p-1 text-gray-400 hover:text-red-500 transition">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Branding sidebar */}
          <div>
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <Palette size={15} className="text-brand-400"/>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Custom Branding</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Brand Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={brand.brandColor} onChange={e => setBrand(b => ({...b, brandColor: e.target.value}))} className="w-10 h-8 rounded border border-gray-200 dark:border-gray-800 cursor-pointer"/>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{brand.brandColor}</span>
                  </div>
                </div>
                <Input label="Brand Name" placeholder="Your Company" value={brand.brandName} onChange={e => setBrand(b => ({...b, brandName: e.target.value}))}/>
                <Input label="Logo URL" placeholder="https://…" value={brand.brandLogo} onChange={e => setBrand(b => ({...b, brandLogo: e.target.value}))}/>
                {brand.brandLogo && (
                  <div className="p-3 border border-gray-100 dark:border-gray-800 rounded-lg text-center">
                    <img src={brand.brandLogo} alt="logo" className="h-8 mx-auto object-contain" onError={e => e.target.style.display="none"}/>
                    <p className="text-xs text-gray-400 mt-1">{brand.brandName || "Brand preview"}</p>
                  </div>
                )}
                <Button className="w-full" size="sm" onClick={saveBranding}>
                  <Settings size={13}/> Save Branding
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Create Workspace Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="สร้าง Workspace ใหม่">
        <div className="space-y-3">
          <Input label="Workspace Name *" placeholder="My Team" value={newWs.name} onChange={e => setNewWs(w => ({...w, name: e.target.value}))}/>
          <Input label="Description" placeholder="คำอธิบาย..." value={newWs.description} onChange={e => setNewWs(w => ({...w, description: e.target.value}))}/>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Brand Color</label>
            <input type="color" value={newWs.brandColor} onChange={e => setNewWs(w => ({...w, brandColor: e.target.value}))} className="w-10 h-8 rounded border border-gray-200 dark:border-gray-800 cursor-pointer"/>
          </div>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={createWorkspace}>สร้าง</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>ยกเลิก</Button>
          </div>
        </div>
      </Modal>

      {/* Create Schedule Modal */}
      <Modal open={showSched} onClose={() => setShowSched(false)} title="Scheduled Report ใหม่">
        <div className="space-y-3">
          <Input label="ชื่อ Report *" placeholder="Weekly Sales Report" value={newSched.name} onChange={e => setNewSched(s => ({...s, name: e.target.value}))}/>
          <Input label="Cron Expression *" placeholder="0 9 * * 1" value={newSched.cronExpr} onChange={e => setNewSched(s => ({...s, cronExpr: e.target.value}))}/>
          <p className="text-xs text-gray-400">ตัวอย่าง: <code>0 9 * * 1</code> = ทุกวันจันทร์ 9:00 น.</p>
          <Input label="Recipients (email, คั่นด้วย comma) *" placeholder="a@mail.com, b@mail.com" value={newSched.recipients} onChange={e => setNewSched(s => ({...s, recipients: e.target.value}))}/>
          <Input label="คำถามสำหรับ AI" value={newSched.prompt} onChange={e => setNewSched(s => ({...s, prompt: e.target.value}))}/>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Format</label>
            <select value={newSched.format} onChange={e => setNewSched(s => ({...s, format: e.target.value}))} className="w-full text-sm border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300">
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={createSchedule}>สร้าง Schedule</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setShowSched(false)}>ยกเลิก</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
