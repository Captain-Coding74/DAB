import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { postJSON } from "../lib/api";
import { useLang } from "../lib/i18n";
import "../lib/strings/auth.js";   // v21.30: this page's strings load with it (lib/i18n.js addStrings)
import { consentGiven } from "../lib/legal.js";
import { Button, Input, Wordmark } from "../components/ui";
import { ConsentBoxes } from "../components/legal/LegalText.jsx";

/* v21.30 click-wrap: sign-up needs both boxes ticked — the Terms of Service
   and Privacy Notice, and the age line. They start unticked and the submit
   button stays disabled until both are; the server applies the same rule
   (TERMS_REQUIRED) and records the version, time and IP. */
const NO_CONSENT = { acceptTerms: false, ageConfirmed: false };

export default function AuthPage() {
  const { login, toast } = useAppStore();
  const { t } = useLang();
  const nav = useNavigate();
  const [mode,     setMode]     = useState("login");
  const [form,     setForm]     = useState({ username: "", password: "", email: "" });
  const [consent,  setConsent]  = useState(NO_CONSENT);
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState({});
  const registering = mode === "register";
  const blocked = registering && !consentGiven(consent);

  const validate = () => {
    const e = {};
    if (!form.username || form.username.length < 3) e.username = t("auth.min3");
    if (!form.password || form.password.length < 6) e.password = t("auth.min6");
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (blocked || !validate()) return;
    setLoading(true);
    try {
      const data = await postJSON(`/api/auth/${mode}`, registering ? { ...form, ...consent } : form);
      login(data);
      toast(registering ? t("auth.created") : t("auth.welcome").replace("{name}", data.username));
      nav("/");
    } catch (err) { toast(err.message || t("common.error"), "error"); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Cover */}
        <div className="text-center mb-8">
          <Wordmark size={52} className="mx-auto mb-3"/>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Data Analysis Bot</h1>
          <p className="eyebrow mt-1.5">{t("auth.tagline")}</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800">
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setErrors({}); }}
                className={`flex-1 py-3 font-mono text-[11px] uppercase tracking-eyebrow border-b-2 transition-colors ${mode===m ? "text-gray-900 dark:text-gray-100 border-brand-500" : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"}`}>
                {m === "login" ? t("auth.signIn") : t("auth.register")}
              </button>
            ))}
          </div>

          {/* A real <form>: Enter submits from any field (the old per-input
              onKeyDown missed the email field), and password managers get
              the semantics they key on. */}
          <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); submit(); }}>
            <Input label={t("auth.username")} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="your_username" value={form.username} error={errors.username}
              onChange={e => setForm(f => ({...f, username: e.target.value}))}/>
            {registering && (
              <Input label={t("auth.email")} name="email" type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={form.email}
                onChange={e => setForm(f => ({...f, email: e.target.value}))}/>
            )}
            <Input label={t("auth.password")} name="password" type="password"
              autoComplete={registering ? "new-password" : "current-password"}
              placeholder="••••••••" value={form.password} error={errors.password}
              onChange={e => setForm(f => ({...f, password: e.target.value}))}/>

            {registering && <ConsentBoxes value={consent} onChange={setConsent}/>}
            {blocked && <p id="auth-consent-hint" className="text-xs text-gray-500 dark:text-gray-400">{t("legal.tickBoth")}</p>}

            <Button className="w-full" size="md" type="submit" loading={loading} disabled={blocked}
              aria-describedby={blocked ? "auth-consent-hint" : undefined}>
              {registering ? t("auth.register") : t("auth.signIn")}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          {t("auth.guestHint")}
        </p>
      </div>
    </div>
  );
}
