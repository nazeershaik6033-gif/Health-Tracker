import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { applyHealthImport, type HealthMergeMode } from '@/db/repo';
import {
  HealthImportError,
  METRIC_LABEL,
  metricSummary,
  openExportXml,
  parseHealthExport,
  type HealthImport,
  type HealthMetric,
} from '@/lib/appleHealth';
import { Button, Card, PageHeader } from '@/components/ui';
import { IconWarning } from '@/components/icons';

type Phase = 'idle' | 'reading' | 'preview' | 'importing' | 'done';

const METRICS: HealthMetric[] = ['steps', 'weight', 'sleep', 'water', 'workouts'];

export default function ImportHealth() {
  const navigate = useNavigate();
  const { showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ bytesRead: 0, records: 0 });
  const [data, setData] = useState<HealthImport | null>(null);
  const [chosen, setChosen] = useState<Set<HealthMetric>>(new Set(METRICS));
  const [mode, setMode] = useState<HealthMergeMode>('fill');
  const [result, setResult] = useState({ written: 0, skipped: 0 });

  async function read(file: File) {
    setPhase('reading');
    setError('');
    setProgress({ bytesRead: 0, records: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const stream = await openExportXml(file);
      const parsed = await parseHealthExport(stream, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setData(parsed);
      // Don't offer to import a metric the file has nothing for.
      const present = new Set(METRICS.filter((m) => hasAny(parsed, m)));
      setChosen(present);
      setPhase('preview');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('idle');
        return;
      }
      setError(
        err instanceof HealthImportError
          ? err.message
          : `Could not read that file: ${err instanceof Error ? err.message : String(err)}`,
      );
      setPhase('idle');
    }
  }

  async function run() {
    if (!data) return;
    setPhase('importing');
    try {
      const res = await applyHealthImport(data, chosen, mode);
      setResult(res);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('preview');
    }
  }

  const summary = data ? metricSummary(data) : null;
  const nothingFound = data && METRICS.every((m) => !hasAny(data, m));

  return (
    <div className="px-4 pt-3 pb-8">
      <PageHeader title="Apple Health" subtitle="Import steps, weight, sleep, water and workouts" />

      <input
        ref={fileRef}
        type="file"
        accept=".zip,.xml,application/zip,text/xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void read(file);
        }}
      />

      {phase === 'idle' && (
        <>
          <Card className="space-y-3">
            <h2 className="text-[15px] font-bold">How to get your file</h2>
            <ol className="ml-4 list-decimal space-y-1.5 text-[13px] leading-relaxed text-secondary">
              <li>Open the <b>Health</b> app on your iPhone.</li>
              <li>Tap your <b>profile picture</b>, top right.</li>
              <li>Scroll down and tap <b>Export All Health Data</b>.</li>
              <li>Wait — it can take a few minutes — then <b>Save to Files</b>.</li>
              <li>Come back here and choose that <b>export.zip</b>.</li>
            </ol>
            <Button full onClick={() => fileRef.current?.click()}>
              Choose export.zip
            </Button>
          </Card>

          {error && (
            <p className="mt-3 flex items-start gap-1.5 accent-card accent-amber p-3 text-[12.5px]">
              <IconWarning width={14} height={14} className="mt-px shrink-0" />
              {error}
            </p>
          )}

          {/* Said plainly, because "link my Apple Watch" is the thing people
              actually want and this is not quite that. */}
          <Card className="mt-3 space-y-2">
            <h2 className="text-[14px] font-bold">Why this isn&apos;t live syncing</h2>
            <p className="text-[12.5px] leading-relaxed text-secondary">
              Apple doesn&apos;t give websites any access to Health or your Watch — that&apos;s
              reserved for native apps installed from the App Store. A one-off export is the only
              route a web app has, so this is a snapshot you re-run when you want to catch up, not
              a connection that keeps itself up to date.
            </p>
            <p className="text-[12.5px] leading-relaxed text-secondary">
              Nothing is uploaded. The file is read on your device and never leaves it.
            </p>
          </Card>
        </>
      )}

      {phase === 'reading' && (
        <Card className="space-y-3">
          <p className="text-[14px] font-bold">Reading your export…</p>
          <p className="text-[12.5px] text-secondary">
            {formatMB(progress.bytesRead)} read · {progress.records.toLocaleString()} records
          </p>
          <p className="text-[12px] text-muted">
            Health exports are large, so this can take a minute. Keep this screen open.
          </p>
          <Button
            variant="secondary"
            full
            onClick={() => {
              abortRef.current?.abort();
            }}
          >
            Cancel
          </Button>
        </Card>
      )}

      {phase === 'preview' && data && summary && (
        <>
          {nothingFound ? (
            <Card className="space-y-2">
              <p className="text-[14px] font-bold">Nothing to import</p>
              <p className="text-[12.5px] leading-relaxed text-secondary">
                That file read fine ({formatMB(data.bytesRead)}, {data.skippedTypes.toLocaleString()}{' '}
                records) but held none of the types tracked here. If you exported from a device
                that only records heart rate or similar, there may genuinely be nothing to bring
                across.
              </p>
              <Button variant="secondary" full onClick={() => setPhase('idle')}>
                Choose a different file
              </Button>
            </Card>
          ) : (
            <>
              <Card className="space-y-1">
                <h2 className="mb-1 text-[15px] font-bold">What&apos;s in the file</h2>
                {METRICS.map((m) => {
                  const s = summary[m];
                  const available = hasAny(data, m);
                  return (
                    <label
                      key={m}
                      className={`flex items-center gap-3 rounded-xl px-1 py-2.5 ${
                        available ? '' : 'opacity-40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-emerald-600"
                        disabled={!available}
                        checked={chosen.has(m)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(m);
                          else next.delete(m);
                          setChosen(next);
                        }}
                      />
                      <span className="flex-1">
                        <span className="block text-[13.5px] font-semibold">{METRIC_LABEL[m]}</span>
                        <span className="block text-[11.5px] text-muted">
                          {available
                            ? `${s.days.toLocaleString()} ${m === 'workouts' ? 'sessions' : 'days'} · ${s.range}`
                            : 'Not in this file'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </Card>

              <Card className="mt-3 space-y-2">
                <h2 className="text-[14px] font-bold">If a day already has data</h2>
                {(
                  [
                    ['fill', 'Keep what I logged', 'Only fills days that are empty. Nothing you typed is touched.'],
                    ['overwrite', 'Use the export', 'Replaces those days with the Health figures.'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-3 py-1.5">
                    <input
                      type="radio"
                      name="merge"
                      className="mt-0.5 h-4.5 w-4.5 shrink-0 accent-emerald-600"
                      checked={mode === value}
                      onChange={() => setMode(value)}
                    />
                    <span>
                      <span className="block text-[13.5px] font-semibold">{label}</span>
                      <span className="block text-[11.5px] text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </Card>

              <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-muted">
                Steps and water take the highest single source per day rather than adding every
                device up, so a walk recorded by both an iPhone and a Watch is counted once.
                Overlapping sleep is merged the same way.
              </p>

              {error && (
                <p className="mt-3 flex items-start gap-1.5 accent-card accent-amber p-3 text-[12.5px]">
                  <IconWarning width={14} height={14} className="mt-px shrink-0" />
                  {error}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setPhase('idle')}>
                  Back
                </Button>
                <Button full disabled={!chosen.size} onClick={run}>
                  Import {chosen.size ? `${chosen.size} of ${METRICS.length}` : 'nothing'}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {phase === 'importing' && (
        <Card>
          <p className="text-[14px] font-bold">Importing…</p>
          <p className="mt-1 text-[12.5px] text-secondary">Writing to your trackers.</p>
        </Card>
      )}

      {phase === 'done' && (
        <Card className="space-y-3">
          <h2 className="text-[15px] font-bold">Imported</h2>
          <p className="text-[13px] leading-relaxed text-secondary">
            {result.written.toLocaleString()} {result.written === 1 ? 'entry' : 'entries'} written
            {result.skipped > 0 && (
              <>
                {' '}· {result.skipped.toLocaleString()} left alone because{' '}
                {mode === 'fill' ? 'you already had data there' : 'they were already imported'}
              </>
            )}
            .
          </p>
          <Button
            full
            onClick={() => {
              showToast({ message: 'Apple Health data imported' });
              navigate('/');
            }}
          >
            Done
          </Button>
          <Button variant="secondary" full onClick={() => setPhase('idle')}>
            Import another file
          </Button>
        </Card>
      )}
    </div>
  );
}

function hasAny(data: HealthImport, metric: HealthMetric): boolean {
  return metric === 'workouts' ? data.workouts.length > 0 : data[metric].size > 0;
}

function formatMB(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000).toLocaleString()} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
