import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { postJSON } from "../lib/api";
import { Button, Input } from "../components/ui";

export default function AuthPage() {
  const { login, toast } = useAppStore();
  const nav = useNavigate();
  const [mode,     setMode]     = useState("login");
  const [form,     setForm]     = useState({ username: "", password: "", email: "" });
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState({});

  const validate = () => {
    const e = {};
    if (!form.username || form.username.length < 3) e.username = "อย่างน้อย 3 ตัวอักษร";
    if (!form.password || form.password.length < 6) e.password = "อย่างน้อย 6 ตัวอักษร";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await postJSON(`/api/auth/${mode}`, form);
      login(data);
      toast(mode === "login" ? `ยินดีต้อนรับ ${data.username}!` : "สร้างบัญชีแล้ว!");
      nav("/");
    } catch (err) { toast(err.message || "เกิดข้อผิดพลาด", "error"); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Cover */}
        <div className="text-center mb-8">
          <svg width="52" height="52" viewBox="0 0 32 32" className="mx-auto mb-3" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="#2F6B4F"/>
            <rect x="6" y="6" width="2" height="20" fill="#C13B27"/>
            <rect x="12" y="16" width="3" height="10" fill="#F2F4EC"/>
            <rect x="17" y="11" width="3" height="15" fill="#F2F4EC"/>
            <rect x="22" y="7"  width="3" height="19" fill="#F2F4EC"/>
          </svg>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Data Analysis Bot</h1>
          <p className="eyebrow mt-1.5">อัปโหลด · ตรวจสอบ · แชร์รายงาน</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800">
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setErrors({}); }}
                className={`flex-1 py-3 font-mono text-[11px] uppercase tracking-eyebrow border-b-2 transition-colors ${mode===m ? "text-gray-900 dark:text-gray-100 border-brand-500" : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"}`}>
                {m === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">
            <Input label="Username" placeholder="your_username" value={form.username} error={errors.username}
              onChange={e => setForm(f => ({...f, username: e.target.value}))}
              onKeyDown={e => e.key === "Enter" && submit()}/>
            {mode === "register" && (
              <Input label="Email (optional)" type="email" placeholder="you@example.com" value={form.email}
                onChange={e => setForm(f => ({...f, email: e.target.value}))}/>
            )}
            <Input label="Password" type="password" placeholder="••••••••" value={form.password} error={errors.password}
              onChange={e => setForm(f => ({...f, password: e.target.value}))}
              onKeyDown={e => e.key === "Enter" && submit()}/>

            <Button className="w-full" size="md" onClick={submit} loading={loading}>
              {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          ใช้งานได้โดยไม่ต้อง login · ประวัติและ workspace ต้องการบัญชี
        </p>
      </div>
    </div>
  );
}
