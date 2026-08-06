import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { clearAllData, saveProfile } from '@/db/repo';
import { downloadBundle, exportData, importData } from '@/db/export';
import { PROVIDER_META, hasKey, modelFor, testKey } from '@/ai/registry';
import { computeTargets, macroTargets } from '@/lib/nutrition';
import { formatBytes } from '@/lib/image';
import { Button, Card, Field, PageHeader, SectionTitle } from '@/components/ui';
import {
  IconCheck,
  IconDownload,
  IconLock,
  IconRefresh,
  IconSparkle,
  IconUpload,
  IconWarning,
} from '@/components/icons';
import type { ProviderId, Settings as SettingsType } from '@/types';

export default function Settings() {
  const navigate = useNavigate();
  const { profile, settings, setSettings, refreshProfile, showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [kcalDraft, setKcalDraft] = useState(String(profile?.targets.kcal ?? ''));
  const [busy, setBusy] = useState<'export' | 'import' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  const provider = settings.provider;
  const meta = PROVIDER_META[provider];
  const savedKey = settings.apiKeys[provider] ?? '';

  async function switchProvider(next: ProviderId) {
    await setSettings({ provider: next });
    setKeyDraft('');
    setModelDraft('');
    setTestResult(null);
  }

  async function saveKey() {
    const value = keyDraft.trim();
    if (!value) return;
    await setSettings({ apiKeys: { ...settings.apiKeys, [provider]: value } });
    setKeyDraft('');
    setTestResult(null);
    showToast({ message: `${meta.label} key saved` });
  }

  async function removeKey() {
    const next = { ...settings.apiKeys };
    delete next[provider];
    await setSettings({ apiKeys: next });
    setTestResult(null);
  }

  async function saveModel(model: string) {
    await setSettings({ models: { ...settings.models, [provider]: model } });
    setModelDraft('');
    setTestResult(null);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    // Test whatever is in the box if the user hasn't saved it yet.
    const probe: SettingsType = keyDraft.trim()
      ? { ...settings, apiKeys: { ...settings.apiKeys, [provider]: keyDraft.trim() } }
      : settings;
    setTestResult(await testKey(probe));
    setTesting(false);
  }

  async function saveKcal() {
    const kcal = Number(kcalDraft);
    if (!profile || !kcal || kcal < 800) return;
    await saveProfile({ targets: macroTargets(kcal, profile.startWeightKg, profile.goal), targetsManual: true });
    await refreshProfile();
    showToast({ message: 'Calorie target updated' });
  }

  async function recalcTargets() {
    if (!profile) return;
    const targets = computeTargets({
      sex: profile.sex,
      birthYear: profile.birthYear,
      heightCm: profile.heightCm,
      weightKg: profile.startWeightKg,
      goal: profile.goal,
      activity: profile.activity,
    });
    await saveProfile({ targets, targetsManual: false });
    await refreshProfile();
    setKcalDraft(String(targets.kcal));
    showToast({ message: 'Targets recalculated' });
  }

  async function doExport(includePhotos: boolean) {
    setBusy('export');
    setMessage('');
    try {
      const bundle = await exportData(includePhotos);
      const { size } = downloadBundle(bundle);
      setMessage(`Exported ${formatBytes(size)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  async function doImport(file: File) {
    setBusy('import');
    setMessage('');
    try {
      const bundle = JSON.parse(await file.text());
      const summary = await importData(bundle);
      const total = Object.values(summary.imported).reduce((a, b) => a + b, 0);
      await refreshProfile();
      setMessage(
        [
          `Restored ${total} record${total === 1 ? '' : 's'}`,
          summary.photosRestored ? `including ${summary.photosRestored} photos` : '',
          ...summary.warnings,
        ]
          .filter(Boolean)
          .join('. ') + '.',
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-8">
      <PageHeader title="Settings" back="/" />

      <div className="space-y-3 px-4 pt-3">
        {/* ------------------------- AI provider ------------------------ */}
        <Card className="space-y-3">
          <SectionTitle>AI provider</SectionTitle>

          <div className="surface-sunken flex gap-1 rounded-xl p-1">
            {(Object.keys(PROVIDER_META) as ProviderId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => switchProvider(id)}
                className={`flex-1 rounded-lg py-2 text-[12px] font-semibold transition-colors ${
                  provider === id ? 'bg-[var(--surface-card)] shadow-sm' : 'text-secondary'
                }`}
              >
                {id === 'anthropic' ? 'Claude' : id === 'gemini' ? 'Gemini' : 'OpenRouter'}
                {hasKey(settings, id) && <span className="ml-1 text-brand-500">•</span>}
              </button>
            ))}
          </div>

          {savedKey ? (
            <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-3">
              <IconCheck width={16} height={16} className="shrink-0 text-brand-600" />
              <span className="tabular flex-1 truncate text-[12.5px] font-medium text-brand-800">
                {savedKey.slice(0, 6)}
                {'•'.repeat(12)}
                {savedKey.slice(-4)}
              </span>
              <button
                type="button"
                onClick={removeKey}
                className="text-[12px] font-semibold text-red-600"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Field
                label={`${meta.label} API key`}
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={meta.keyHint}
                autoComplete="off"
                className="flex-1"
              />
              <Button onClick={saveKey} disabled={!keyDraft.trim()} className="mb-1">
                Save
              </Button>
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-secondary">Model</span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {meta.models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => saveModel(m)}
                  className={`hairline rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium ${
                    modelFor(settings) === m ? 'border-brand-500 bg-brand-50 text-brand-700' : ''
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Field
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                placeholder={modelFor(settings)}
                className="flex-1"
                hint="Any model ID this provider accepts — newer models work without an app update."
              />
              <Button
                variant="secondary"
                onClick={() => saveModel(modelDraft.trim())}
                disabled={!modelDraft.trim()}
                className="mb-5"
              >
                Set
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={runTest} disabled={testing || (!savedKey && !keyDraft.trim())}>
              <IconRefresh width={15} height={15} className={testing ? 'animate-spin' : ''} />
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <a
              href={meta.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12.5px] font-semibold text-brand-600"
            >
              Get a key →
            </a>
          </div>

          {testResult && (
            <p
              className={`text-[12.5px] ${testResult.ok ? 'text-brand-700' : 'text-red-600'}`}
              role="status"
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.detail}
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
            <IconLock width={14} height={14} className="mt-0.5 shrink-0" />
            <p>
              Your key is stored in this browser and sent only to {meta.label}. Nothing passes
              through a server of ours — there isn&apos;t one. Anyone with access to this device
              or its developer tools can read it, so use a key scoped to what you&apos;re
              comfortable with, and remove it if you share the device.
            </p>
          </div>
        </Card>

        {/* --------------------------- Targets -------------------------- */}
        <Card className="space-y-3">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={recalcTargets}
                className="text-[12.5px] font-semibold text-brand-600"
              >
                Recalculate
              </button>
            }
          >
            Daily targets
          </SectionTitle>

          {profile && (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat label="Protein" value={`${profile.targets.protein}g`} />
                <Stat label="Fat" value={`${profile.targets.fat}g`} />
                <Stat label="Carbs" value={`${profile.targets.carbs}g`} />
                <Stat label="Fibre" value={`${profile.targets.fibre}g`} />
              </div>
              <div className="flex items-end gap-2">
                <Field
                  label="Calories"
                  value={kcalDraft}
                  onChange={(e) => setKcalDraft(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  suffix="kcal"
                  className="flex-1"
                  hint={
                    profile.targetsManual
                      ? 'Set by hand — recalculate to follow your weight again.'
                      : 'Calculated from your profile and current weight.'
                  }
                />
                <Button onClick={saveKcal} disabled={!kcalDraft} className="mb-5">
                  Save
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* -------------------------- Appearance ------------------------ */}
        <Card>
          <SectionTitle>Appearance</SectionTitle>
          <div className="surface-sunken flex gap-1 rounded-xl p-1">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSettings({ theme: t })}
                className={`flex-1 rounded-lg py-2 text-[12.5px] font-semibold capitalize transition-colors ${
                  settings.theme === t ? 'bg-[var(--surface-card)] shadow-sm' : 'text-secondary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Card>

        {/* ------------------------ Backup / restore -------------------- */}
        <Card className="space-y-3">
          <SectionTitle>Backup</SectionTitle>
          <p className="text-[12.5px] leading-relaxed text-secondary">
            Everything lives in this browser. Clearing site data wipes it, so export before you
            switch devices or clear your browser.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => doExport(false)} disabled={busy !== null}>
              <IconDownload width={15} height={15} />
              Export data
            </Button>
            <Button variant="secondary" onClick={() => doExport(true)} disabled={busy !== null}>
              <IconDownload width={15} height={15} />
              Export with photos
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              <IconUpload width={15} height={15} />
              Import
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) await doImport(file);
            }}
          />
          <p className="text-[11.5px] text-muted">
            Exports never include your API key. Photos make the file much larger — a few hundred
            snaps can run to tens of megabytes.
          </p>
          {message && <p className="text-[12.5px] text-brand-700">{message}</p>}
          {busy === 'export' && <p className="text-[12.5px] text-secondary">Preparing export…</p>}
          {busy === 'import' && <p className="text-[12.5px] text-secondary">Restoring…</p>}
        </Card>

        {/* --------------------------- Profile -------------------------- */}
        <Card>
          <SectionTitle>Profile</SectionTitle>
          <button
            type="button"
            onClick={() => navigate('/onboarding')}
            className="text-[13px] font-semibold text-brand-600"
          >
            Edit your details and goal →
          </button>
        </Card>

        {/* ---------------------------- Danger -------------------------- */}
        <Card className="space-y-2">
          <SectionTitle>Reset</SectionTitle>
          <p className="text-[12.5px] text-secondary">
            Deletes every meal, snap, tracker entry and chat on this device. Your API key and
            provider settings are kept.
          </p>
          <Button
            variant={confirmReset ? 'danger' : 'secondary'}
            onClick={async () => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setBusy('reset');
              await clearAllData();
              await refreshProfile();
              setBusy(null);
              setConfirmReset(false);
              navigate('/onboarding', { replace: true });
            }}
            disabled={busy !== null}
          >
            <IconWarning width={15} height={15} />
            {confirmReset ? 'Tap again to erase everything' : 'Erase all data'}
          </Button>
        </Card>

        <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted">
          <IconSparkle width={12} height={12} />
          Healthify — everything stays on your device
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-sunken rounded-xl py-2.5">
      <p className="tabular text-[14px] font-bold">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}
