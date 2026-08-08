import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { deleteSnap } from '@/db/repo';
import { relativeDayLabel } from '@/lib/date';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { IconCameraPlus, IconGallery, IconShare, IconTrash } from '@/components/icons';
import type { Snap } from '@/types';

export default function SnapGallery() {
  const navigate = useNavigate();
  const { settings, setSettings } = useApp();
  const snaps = useLiveQuery(async () => db.snaps.orderBy('createdAt').reverse().toArray(), []);

  const grouped = useMemo(() => {
    const map = new Map<string, Snap[]>();
    for (const snap of snaps ?? []) {
      const list = map.get(snap.date) ?? [];
      list.push(snap);
      map.set(snap.date, list);
    }
    return [...map.entries()];
  }, [snaps]);

  return (
    <div className="pb-28">
      <PageHeader
        title="Snap Gallery"
        back="/"
        action={
          <label className="mr-1 flex items-center gap-2 text-[12px] font-semibold">
            Auto-Track
            <input
              type="checkbox"
              className="peer sr-only"
              checked={settings.autoTrack}
              onChange={(e) => setSettings({ autoTrack: e.target.checked })}
            />
            <span
              aria-hidden="true"
              className={`relative h-6 w-11 rounded-full transition-colors ${
                settings.autoTrack ? 'bg-brand-500' : 'surface-sunken'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  settings.autoTrack ? 'translate-x-5' : ''
                }`}
              />
            </span>
          </label>
        }
      />

      <div className="px-4 pt-3">
        <ShareTargetNote autoTrack={settings.autoTrack} />

        {grouped.length === 0 ? (
          <EmptyState
            icon={<IconGallery width={22} height={22} />}
            title="No snaps yet"
            body="Photos you analyse show up here, grouped by day."
          />
        ) : (
          <div className="space-y-5 pt-4">
            {grouped.map(([date, list]) => (
              <section key={date}>
                <h2 className="mb-2 text-[13px] font-bold text-secondary">
                  {relativeDayLabel(date)}
                </h2>
                <div className="grid grid-cols-2 gap-2.5">
                  {list.map((snap) => (
                    <SnapTile key={snap.id} snap={snap} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Two actions, because "upload a photo I already took" was previously
          only reachable via a small icon inside the camera screen. */}
      <div className="fixed right-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate('/snap?pick=1')}
          aria-label="Upload a photo"
          className="surface-card flex h-12 w-14 items-center justify-center rounded-2xl text-secondary shadow-lg"
        >
          <IconGallery width={22} height={22} />
        </button>
        <button
          type="button"
          onClick={() => navigate('/snap')}
          aria-label="Take a new snap"
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg"
        >
          <IconCameraPlus width={24} height={24} />
        </button>
      </div>
    </div>
  );
}

function SnapTile({ snap }: { snap: Snap }) {
  const [url, setUrl] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(snap.thumb);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [snap.thumb]);

  const title =
    snap.analysis?.items.map((i) => i.name).join(', ') ?? snap.analysis?.title ?? 'Not analysed';

  return (
    <div className="surface-card overflow-hidden">
      <Link
        to={snap.mealId ? `/meal/${snap.mealId}` : `/snap?id=${snap.id}`}
        className="relative block aspect-square"
      >
        {url && <img src={url} alt={title} className="h-full w-full object-cover" />}
        {snap.autoTracked && (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white">
            ✦ Auto Tracked
          </span>
        )}
        {snap.status === 'failed' && (
          <span className="absolute top-1.5 right-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
            Failed
          </span>
        )}
      </Link>
      <div className="flex items-start gap-1 px-2.5 py-2">
        <p className="line-clamp-2 flex-1 text-[11.5px] leading-snug font-semibold">{title}</p>
        <button
          type="button"
          onClick={() => (confirm ? deleteSnap(snap.id) : setConfirm(true))}
          onBlur={() => setConfirm(false)}
          aria-label={confirm ? 'Confirm delete' : 'Delete snap'}
          className={`shrink-0 rounded p-1 ${confirm ? 'bg-red-50 text-red-600' : 'text-muted'}`}
        >
          <IconTrash width={13} height={13} />
        </button>
      </div>
      {snap.analysis && (
        <p className="tabular px-2.5 pb-2 text-[11px] text-secondary">
          {Math.round(snap.analysis.totals.kcal)} Cal
        </p>
      )}
    </div>
  );
}

/**
 * Explains what Auto-Track actually does here.
 *
 * The reference app watches your camera roll in the background. A browser
 * cannot do that — there is no background gallery access on the web — so this
 * is share-to-track instead, and it says so rather than implying otherwise.
 */
function ShareTargetNote({ autoTrack }: { autoTrack: boolean }) {
  const installed = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia('(display-mode: standalone)').matches,
  ).current;

  return (
    <Card className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <IconShare width={17} height={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold">Share a photo to track it</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-secondary">
          {installed
            ? 'Healthify appears in your phone’s share sheet. Share any food photo from your gallery and it lands here.'
            : 'Install Healthify to your home screen and it joins your phone’s share sheet — then any food photo can be shared straight in.'}{' '}
          {autoTrack
            ? 'Auto-Track is on, so shared photos are logged as soon as they are read.'
            : 'Auto-Track is off, so shared photos wait for you to confirm.'}
        </p>
        <p className="mt-1.5 text-[11px] text-muted">
          Browsers can&apos;t scan your camera roll in the background, so sharing is the closest
          equivalent.
        </p>
      </div>
    </Card>
  );
}
