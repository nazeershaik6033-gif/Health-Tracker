import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { hasKey } from '@/ai/registry';
import { PageHeader } from '@/components/ui';
import {
  IconBarcode,
  IconCamera,
  IconChevronRight,
  IconGallery,
  IconMic,
  IconPlus,
  IconSearch,
  IconSparkle,
} from '@/components/icons';

/**
 * The [+] destination — every way into logging, in one list. AI-backed
 * options stay visible without a key but say why they're unavailable rather
 * than vanishing, so the feature set is discoverable either way.
 */
export default function LogSheet() {
  const navigate = useNavigate();
  const settings = useApp((s) => s.settings);
  const keyed = hasKey(settings);

  const options = [
    {
      to: '/snap',
      icon: <IconCamera width={21} height={21} />,
      title: 'Snap a meal',
      body: 'Photograph your plate and get calories and macros back',
      ai: true,
      tint: 'bg-brand-50 text-brand-600',
    },
    {
      to: '/scan',
      icon: <IconBarcode width={21} height={21} />,
      title: 'Scan a barcode',
      body: 'Packaged food, straight from the label',
      ai: false,
      tint: 'bg-accent-50 text-accent-600',
    },
    {
      to: '/label',
      icon: <IconGallery width={21} height={21} />,
      title: 'Read a nutrition label',
      body: 'Point at the panel on the back of a pack',
      ai: false,
      tint: 'bg-amber-50 text-amber-600',
    },
    {
      to: '/voice',
      icon: <IconMic width={21} height={21} />,
      title: 'Say what you ate',
      body: '"Two rotis, a katori of dal and a glass of milk"',
      ai: true,
      tint: 'bg-purple-50 text-purple-600',
    },
    {
      to: '/search',
      icon: <IconSearch width={21} height={21} />,
      title: 'Search foods',
      body: 'Browse the database and your frequently tracked list',
      ai: false,
      tint: 'bg-blue-50 text-blue-600',
    },
    {
      // Last because it is the most effort, but present because it is the only
      // route in for a home-cooked dish no database will ever carry.
      to: '/food/new',
      icon: <IconPlus width={21} height={21} />,
      title: 'Create a food',
      body: 'Enter a home-cooked dish yourself and reuse it after',
      ai: false,
      tint: 'surface-sunken text-secondary',
    },
  ];

  return (
    <div className="min-h-dvh">
      <PageHeader title="Log something" back={() => navigate(-1)} />

      <div className="space-y-2.5 px-4 pt-4">
        {options.map((opt) => {
          const blocked = opt.ai && !keyed;
          return (
            <button
              key={opt.to}
              type="button"
              onClick={() => navigate(blocked ? '/settings' : opt.to)}
              className="surface-card flex w-full items-center gap-3.5 p-4 text-left transition-transform active:scale-[0.99]"
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${opt.tint}`}
              >
                {opt.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[15px] font-bold">{opt.title}</span>
                  {opt.ai && (
                    <IconSparkle
                      width={13}
                      height={13}
                      className={keyed ? 'text-brand-500' : 'text-[var(--text-muted)]'}
                    />
                  )}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-secondary">
                  {blocked ? 'Needs an AI key — tap to set one up' : opt.body}
                </span>
              </span>
              <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
            </button>
          );
        })}

        <div className="pt-2">
          <button
            type="button"
            onClick={() => navigate('/diet')}
            className="hairline flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3.5 text-[13.5px] font-semibold text-secondary"
          >
            <IconPlus width={16} height={16} />
            Review today&apos;s diet
          </button>
        </div>
      </div>
    </div>
  );
}
