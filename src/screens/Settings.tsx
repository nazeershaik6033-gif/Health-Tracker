import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { clearAllData, saveProfile } from '@/db/repo';
import { downloadBundle, exportData, importData } from '@/db/export';
import { PROVIDER_META, hasKey, modelFor, testKey } from '@/ai/registry';
import { keyShapeWarning } from '@/ai/types';
import { clearFatSecretToken, fatSecretReady, testFatSecret } from '@/lib/fatsecret';
import { buildLabel, checkForUpdate, forceReload } from '@/lib/appUpdate';
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
import { THEMES, type FatSecretConfig, type ProviderId, type Settings as SettingsType } from '@/types';

export default function Settings() {
  const navigate = useNavigate();
  const { profile, settings, setSettings, refreshProfile, showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');

  const [updating, setUpdating] = useState<'check' | 'force' | null>(null);
  const [updateMessage, setUpdateMessage] = useState('');

  async function runUpdateCheck() {
    setUpdating('check');
    setUpdateMessage('');
    try {
      const result = await checkForUpdate();
      setUpdateMessage(result.detail);
      if (result.status === 'updated') {
        // Long enough to read "Reloading…", short enough not to feel stuck.
        setTimeout(() => window.location.reload(), 900);
        return; // leave the buttons disabled through the reload
      }
    } catch (err) {
      setUpdateMessage(err instanceof Error ? err.message : 'Could not check for updates.');
    }
    setUpdating(null);
  }

  const [confirmForce, setConfirmForce] = useState(false);

  async function runForceReload() {
    // Two taps, because this is the one control that can leave the app
    // unopenable — it deletes the offline copy and depends on the server
    // having one to replace it with.
    if (!confirmForce) {
      setConfirmForce(true);
      setUpdateMessage('');
      return;
    }
    setConfirmForce(false);
    setUpdating('force');
    setUpdateMessage('Checking the app can be re-downloaded…');
    try {
      await forceReload();
    } catch (err) {
      setUpdateMessage(err instanceof Error ? err.message : 'Could not clear the cache.');
      setUpdating(null);
    }
  }

  // Only so the System swatch can say which way it currently resolves.
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const provider = settings.provider;
  const meta = PROVIDER_META[provider];
  const savedKey = settings.apiKeys[provider] ?? '';

  // Warn about whatever the user is looking at: the draft while typing, the
  // saved key otherwise. A key saved before this check existed still gets flagged.
  const savedKeyWarning = keyShapeWarning(provider, savedKey);
  const keyWarning = keyDraft.trim() ? keyShapeWarning(provider, keyDraft) : savedKeyWarning;

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

  const [targetDraft, setTargetDraft] = useState(() => ({
    kcal: String(profile?.targets.kcal ?? ''),
    protein: String(profile?.targets.protein ?? ''),
    fat: String(profile?.targets.fat ?? ''),
    carbs: String(profile?.targets.carbs ?? ''),
    fibre: String(profile?.targets.fibre ?? ''),
  }));
  const [targetsDirty, setTargetsDirty] = useState(false);

  function patchTarget(key: keyof typeof targetDraft, value: string) {
    setTargetDraft((d) => ({ ...d, [key]: value.replace(/\D/g, '') }));
    setTargetsDirty(true);
  }

  /** Convenience: refill the macros from the calorie figure without saving. */
  function fillFromCalories() {
    if (!profile) return;
    const kcal = Number(targetDraft.kcal) || 0;
    if (kcal < 800) {
      showToast({ message: 'Set at least 800 calories first' });
      return;
    }
    const m = macroTargets(kcal, profile.startWeightKg, profile.goal);
    setTargetDraft({
      kcal: String(m.kcal),
      protein: String(m.protein),
      fat: String(m.fat),
      carbs: String(m.carbs),
      fibre: String(m.fibre),
    });
    setTargetsDirty(true);
  }

  async function saveTargets() {
    const kcal = Number(targetDraft.kcal);
    if (!profile || !kcal || kcal < 800) {
      showToast({ message: 'Calories must be at least 800' });
      return;
    }
    await saveProfile({
      targets: {
        kcal,
        protein: Number(targetDraft.protein) || 0,
        fat: Number(targetDraft.fat) || 0,
        carbs: Number(targetDraft.carbs) || 0,
        fibre: Number(targetDraft.fibre) || 0,
      },
      // Anything typed here is the user's, so the formula stops overwriting it.
      targetsManual: true,
    });
    await refreshProfile();
    setTargetsDirty(false);
    showToast({ message: 'Targets updated' });
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
    setTargetDraft({
      kcal: String(targets.kcal),
      protein: String(targets.protein),
      fat: String(targets.fat),
      carbs: String(targets.carbs),
      fibre: String(targets.fibre),
    });
    setTargetsDirty(false);
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
            <div
              className={`flex items-center gap-2 rounded-xl p-3 ${
                savedKeyWarning ? 'bg-amber-50' : 'bg-brand-50'
              }`}
            >
              {savedKeyWarning ? (
                <IconWarning width={16} height={16} className="shrink-0 text-amber-600" />
              ) : (
                <IconCheck width={16} height={16} className="shrink-0 text-brand-600" />
              )}
              <span
                className={`tabular flex-1 truncate text-[12.5px] font-medium ${
                  savedKeyWarning ? 'text-amber-900' : 'text-brand-800'
                }`}
              >
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

          {/* Caught before a request is ever sent: a key of the wrong shape
              would only come back as a bare 401, which says nothing about the
              key being incomplete or from the wrong provider's page. */}
          {keyWarning && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
              <IconWarning width={14} height={14} className="mt-0.5 shrink-0" />
              <p>
                {keyWarning}{' '}
                <a
                  href={meta.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline"
                >
                  Get a key from {meta.label}
                </a>
                .
              </p>
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

        {/* ------------------------- Food database ---------------------- */}
        <FatSecretCard />

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
              {/* Every value is editable. Macros used to be read-only, derived
                  from calories by a fixed ratio and silently rewritten on every
                  change — which is wrong for anyone following a specific split. */}
              <Field
                label="Calories"
                value={targetDraft.kcal}
                onChange={(e) => patchTarget('kcal', e.target.value)}
                inputMode="numeric"
                suffix="kcal"
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Protein"
                  value={targetDraft.protein}
                  onChange={(e) => patchTarget('protein', e.target.value)}
                  inputMode="numeric"
                  suffix="g"
                />
                <Field
                  label="Fat"
                  value={targetDraft.fat}
                  onChange={(e) => patchTarget('fat', e.target.value)}
                  inputMode="numeric"
                  suffix="g"
                />
                <Field
                  label="Carbs"
                  value={targetDraft.carbs}
                  onChange={(e) => patchTarget('carbs', e.target.value)}
                  inputMode="numeric"
                  suffix="g"
                />
                <Field
                  label="Fibre"
                  value={targetDraft.fibre}
                  onChange={(e) => patchTarget('fibre', e.target.value)}
                  inputMode="numeric"
                  suffix="g"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={saveTargets} disabled={!targetsDirty || !targetDraft.kcal}>
                  Save targets
                </Button>
                <Button variant="secondary" onClick={fillFromCalories} disabled={!targetDraft.kcal}>
                  Macros from calories
                </Button>
              </div>

              <p className="text-[11.5px] leading-relaxed text-muted">
                {profile.targetsManual
                  ? 'Set by hand. Recalculate follows your profile and weight again.'
                  : 'Calculated from your profile and current weight. Editing any value makes them yours to keep.'}
              </p>
            </>
          )}
        </Card>

        {/* -------------------------- Appearance ------------------------ */}
        <Card className="space-y-3">
          <SectionTitle>Theme</SectionTitle>
          <div className="flex gap-1">
            {THEMES.map(({ id, label }) => {
              const selected = settings.theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSettings({ theme: id })}
                  aria-pressed={selected}
                  aria-label={`${label} theme`}
                  className="flex flex-1 flex-col items-center gap-1.5"
                >
                  {/* Outer ring is a border on a padded wrapper rather than a
                      ring utility, so the gap reads correctly on any card
                      colour without tracking a ring-offset variable. */}
                  <span
                    className={`rounded-full border-2 p-0.5 transition-colors ${
                      selected ? 'border-brand-500' : 'border-transparent'
                    }`}
                  >
                    <span
                      className="hairline flex h-12 w-12 items-center justify-center rounded-full border"
                      style={{ background: `var(--swatch-${id})` }}
                    >
                      <span
                        className="text-[18px] leading-none"
                        style={{
                          color: `var(--swatch-${id}-fg)`,
                          fontFamily: 'Georgia, "Times New Roman", serif',
                        }}
                        aria-hidden="true"
                      >
                        A
                      </span>
                    </span>
                  </span>
                  <span
                    className={`text-[11.5px] ${
                      selected ? 'font-bold' : 'font-medium text-muted'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          {settings.theme === 'system' && (
            <p className="text-[11.5px] text-muted">
              Following your device — currently {prefersDark ? 'dark' : 'light'}.
            </p>
          )}
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

        {/* --------------------------- Version -------------------------- */}
        <Card className="space-y-2.5">
          <SectionTitle>App version</SectionTitle>
          <p data-testid="build-stamp" className="tabular text-[12.5px] font-medium text-secondary">
            {buildLabel()}
          </p>
          <p className="text-[12.5px] leading-relaxed text-secondary">
            Healthify caches itself so it works offline, which is also why a new version can
            take a reload to show up. This fetches the latest and reloads if there is one.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={runUpdateCheck} disabled={updating !== null}>
              <IconRefresh
                width={15}
                height={15}
                className={updating === 'check' ? 'animate-spin' : ''}
              />
              {updating === 'check' ? 'Checking…' : 'Check for updates'}
            </Button>
            <Button
              variant={confirmForce ? 'danger' : 'secondary'}
              onClick={runForceReload}
              onBlur={() => setConfirmForce(false)}
              disabled={updating !== null}
            >
              {updating === 'force'
                ? 'Checking…'
                : confirmForce
                  ? 'Tap again to clear and re-download'
                  : 'Force reload'}
            </Button>
          </div>

          {updateMessage && (
            <p className="text-[12.5px] leading-relaxed text-brand-700" role="status">
              {updateMessage}
            </p>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            Force reload clears the offline cache and re-downloads the app. Your meals, photos
            and tracker entries are stored separately and are not touched. It checks the app can
            actually be downloaded first, and refuses if it can&apos;t — otherwise clearing the
            offline copy while the site is unreachable would leave nothing to load.
          </p>
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

/** Step-by-step proxy setup — the only route to a working FatSecret. */
const PROXY_GUIDE_URL =
  'https://github.com/nazeershaik6033-gif/Health-Tracker/blob/main/proxy/README.md';

/**
 * FatSecret Platform API.
 *
 * Deliberately not folded into the AI provider card: it is a food database,
 * not a model, and its credentials work differently enough that mixing them
 * would mislead. The proxy field is first because it is the only arrangement
 * that reliably works — see the note rendered under it.
 */
function FatSecretCard() {
  const { settings, setSettings, showToast } = useApp();
  const fs = settings.fatsecret;

  const [proxyDraft, setProxyDraft] = useState(fs.proxyUrl);
  const [idDraft, setIdDraft] = useState(fs.clientId);
  const [secretDraft, setSecretDraft] = useState('');
  const [scopeDraft, setScopeDraft] = useState(fs.scope);
  const [regionDraft, setRegionDraft] = useState(fs.region);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const usingProxy = proxyDraft.trim().length > 0;

  /** The config as currently typed, so Test works before Save. */
  const draft: FatSecretConfig = {
    enabled: true,
    proxyUrl: proxyDraft.trim(),
    clientId: idDraft.trim(),
    clientSecret: secretDraft.trim() || fs.clientSecret,
    scope: scopeDraft.trim() || 'basic',
    region: regionDraft.trim().toUpperCase(),
  };

  async function patch(next: Partial<FatSecretConfig>) {
    await setSettings({ fatsecret: { ...fs, ...next } });
    // Any credential change invalidates a token minted with the old ones.
    clearFatSecretToken();
    setResult(null);
  }

  async function save() {
    await patch({ ...draft, enabled: fs.enabled });
    setSecretDraft('');
    showToast({ message: 'FatSecret settings saved' });
  }

  async function runTest() {
    setTesting(true);
    setResult(null);
    setResult(await testFatSecret(draft));
    setTesting(false);
  }

  return (
    <Card className="space-y-3">
      <SectionTitle
        action={
          <button
            type="button"
            role="switch"
            aria-checked={fs.enabled}
            aria-label="Use FatSecret"
            onClick={() => patch({ enabled: !fs.enabled })}
            className={`relative h-6 w-10 rounded-full transition-colors ${
              fs.enabled ? 'bg-brand-500' : 'bg-[var(--surface-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                fs.enabled ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        }
      >
        Food database — FatSecret
      </SectionTitle>

      <p className="text-[12.5px] leading-relaxed text-secondary">
        Adds FatSecret&apos;s branded and restaurant foods to barcode scans and name search.
        Everything already works without it: the built-in database, Open Food Facts and AI
        estimates are unaffected.
      </p>

      {/* Outside the enabled block on purpose: you need to register with
          FatSecret *before* you have anything to type in, so hiding the link
          behind the toggle put it exactly where it was no use. */}
      <a
        href="https://platform.fatsecret.com/platform-api"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[12.5px] font-semibold text-brand-600"
      >
        Register for free FatSecret API credentials →
      </a>

      {fs.enabled && (
        <>
          <Field
            label="Proxy URL"
            value={proxyDraft}
            onChange={(e) => setProxyDraft(e.target.value)}
            placeholder="https://your-worker.workers.dev"
            autoComplete="off"
            inputMode="url"
            hint="Required — FatSecret can't be reached from a browser without one."
          />

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
            <IconWarning width={14} height={14} className="mt-0.5 shrink-0" />
            <p>
              Their token endpoint sends no CORS headers, and keys are locked to whitelisted IP
              addresses — which a phone moving between wifi and mobile data never has. A Client
              ID and Secret alone will not work here.{' '}
              <a
                href={PROXY_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                Set up the proxy
              </a>{' '}
              — four commands, free tier.
            </p>
          </div>

          <Field
            label={`Client ID${usingProxy ? ' (not needed with a proxy)' : ''}`}
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            placeholder="1a2b3c…"
            autoComplete="off"
          />
          <Field
            label={`Client Secret${usingProxy ? ' (not needed with a proxy)' : ''}`}
            type="password"
            value={secretDraft}
            onChange={(e) => setSecretDraft(e.target.value)}
            placeholder={fs.clientSecret ? '•'.repeat(16) + ' — saved' : 'Your FatSecret secret'}
            autoComplete="off"
            hint={
              usingProxy
                ? 'Leave both blank when using a proxy — the worker holds the secret instead.'
                : undefined
            }
          />

          <div className="flex gap-2">
            <Field
              label="Region"
              value={regionDraft}
              onChange={(e) => setRegionDraft(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2))}
              placeholder="IN"
              className="w-24"
              hint="Biases results to local brands."
            />
            <Field
              label="Scope"
              value={scopeDraft}
              onChange={(e) => setScopeDraft(e.target.value)}
              placeholder="basic"
              className="flex-1"
              hint="Free keys get `basic`. Premier keys can add `barcode` for barcode lookups."
            />
          </div>

          {/* Named explicitly: this page now has two Save and two Test
              buttons, and "Save" alone tells a screen reader nothing. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} aria-label="Save FatSecret settings">
              Save
            </Button>
            <Button
              variant="secondary"
              onClick={runTest}
              aria-label="Test FatSecret connection"
              disabled={testing || !fatSecretReady(draft)}
            >
              <IconRefresh width={15} height={15} className={testing ? 'animate-spin' : ''} />
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <a
              href="https://platform.fatsecret.com/docs/guides/authentication/oauth2"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12.5px] font-semibold text-brand-600"
            >
              Where to find these →
            </a>
          </div>

          {result && (
            <p
              className={`text-[12.5px] leading-relaxed ${result.ok ? 'text-brand-700' : 'text-red-600'}`}
              role="status"
            >
              {result.ok ? '✓ ' : '✗ '}
              {result.detail}
              {/* The blocked case is the one nobody can fix by re-reading the
                  message, so it gets the setup guide attached directly. */}
              {!result.ok && /cannot call FatSecret directly/i.test(result.detail) && (
                <>
                  {' '}
                  <a
                    href={PROXY_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    Setup guide →
                  </a>
                </>
              )}
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11.5px] leading-relaxed text-amber-900">
            <IconLock width={14} height={14} className="mt-0.5 shrink-0" />
            <p>
              A Client Secret entered here is stored in this browser and readable by anyone with
              the device or its developer tools — and unlike an AI key it is a long-lived
              credential for your whole FatSecret account. Prefer the proxy, which keeps the
              secret off the device entirely. Backups never include either.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}

