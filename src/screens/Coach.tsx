import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '@/stores/useApp';
import {
  addChat,
  addMealItems,
  allFavourites,
  allFoods,
  chatHistory,
  clearChat,
  dayBundle,
  updateChat,
} from '@/db/repo';
import { coachReply, dayContext, parseSpokenMeal } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError, type ChatTurn } from '@/ai/types';
import {
  describeSlots,
  parseMealText,
  resolveGroups,
  type ResolvedGroup,
} from '@/lib/mealText';
import { formatPortion } from '@/lib/nutrition';
import { blobToImagePart, prepareImage } from '@/lib/image';
import { Button, Card, PageHeader } from '@/components/ui';
import { IconCamera, IconClose, IconPlus, IconSend, IconSparkle, IconTrash, IconWarning } from '@/components/icons';
import { MEAL_SLOT_LABEL, type ChatMessage } from '@/types';

const SUGGESTIONS = [
  'Summarise my day and tell me what to fix',
  'What should I eat for dinner tonight?',
  'Am I getting enough protein?',
  'Why has my weight stalled?',
];

/** Shown alongside the questions, because the syntax has to be discovered. */
const LOG_EXAMPLES = [
  'breakfast: idly 2, coconut chutney 2 tbsp',
  'lunch: rice 1 katori, dal fry 1 katori',
];

/** Keeps the request bounded — older turns fall out rather than growing forever. */
const HISTORY_TURNS = 12;

/**
 * How many of the most recent photos in the thread are sent with a question.
 * Every image is re-sent on every turn (the API is stateless), so an older
 * photo becomes a text note instead — "what about the second one?" still
 * works, and a long photo thread doesn't multiply the cost of each reply.
 */
const IMAGE_TURNS = 2;

/** What a photo sent without words is asking. */
const PHOTO_ONLY_PROMPT = 'What do you make of this?';

export default function Coach() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile, settings, selectedDate, showToast } = useApp();
  const keyed = hasKey(settings);
  // The whole food table, for the typed-log resolver. One read, cached by
  // Dexie's live query, and it is the reason a typed meal costs no API call.
  const foods = useLiveQuery(() => allFoods(), []);
  // Pinned portions take priority over the catalog: "breakfast: usual" should
  // reach the meal the user pinned, at the amounts they pinned it at.
  const favourites = useLiveQuery(() => allFavourites(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * A typed meal waiting for confirmation. Deliberately not a chat message:
   * nothing in this app writes food without showing the numbers first, and a
   * chat box that silently logged on a false trigger would be the worst
   * possible place to break that rule.
   */
  const [pendingLog, setPendingLog] = useState<ResolvedGroup[] | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [input, setInput] = useState('');
  /** A photo chosen but not yet sent. */
  const [attachment, setAttachment] = useState<{ blob: Blob; url: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    void (async () => {
      setMessages(await chatHistory());
      setLoaded(true);
    })();
  }, []);

  // Keep the newest message in view as tokens stream in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The preview URL is released when the photo is sent, removed or replaced.
  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.url);
  }, [attachment]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setAttaching(true);
    setError('');
    try {
      // Same downscale Snap uses: a 12 MP photo is several MB of base64 per
      // turn and the model reads a 1024 px one just as well.
      const { full } = await prepareImage(file);
      setAttachment({ blob: full, url: URL.createObjectURL(full) });
      inputRef.current?.focus();
    } catch {
      setError("That photo couldn't be opened. Try another.");
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send(text: string) {
    const photo = attachment?.blob;
    const trimmed = text.trim() || (photo ? PHOTO_ONLY_PROMPT : '');
    if (!trimmed || busy) return;

    // Decided in code, not by the model: a slot word followed by a colon is a
    // log, anything else is a question. That keeps "I had 2 idlis, is that
    // enough protein?" a question, and it costs no round trip to work out.
    const parsed = photo ? null : parseMealText(trimmed);
    if (parsed && foods) {
      setInput('');
      setError('');
      const userMsg = await addChat({ role: 'user', content: trimmed, createdAt: Date.now() });
      setMessages((prev) => [...prev, userMsg]);
      setPendingLog(resolveGroups(foods, parsed, favourites ?? []));
      return;
    }

    if (!keyed) {
      setError(
        photo
          ? 'Ria needs an AI key to look at photos. Snap can log a meal photo once a key is set.'
          : 'Ria needs an AI key to answer questions. Typed meal logs work without one.',
      );
      return;
    }

    setInput('');
    setError('');
    setBusy(true);
    setAttachment(null);

    const userMsg = await addChat({
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      ...(photo ? { image: photo } : {}),
    });
    const assistantMsg = await addChat({
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
      streaming: true,
    });
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const bundle = await dayBundle(selectedDate, profile);
      const context = dayContext(bundle, profile);
      const recent = [...messages, userMsg].filter((m) => m.content.trim()).slice(-HISTORY_TURNS);
      const withImages = new Set(
        recent
          .filter((m) => m.image)
          .slice(-IMAGE_TURNS)
          .map((m) => m.id),
      );
      const turns: ChatTurn[] = await Promise.all(
        recent.map(async (m) => {
          if (!m.image) return { role: m.role, content: m.content };
          if (!withImages.has(m.id)) return { role: m.role, content: `[Shared a photo earlier] ${m.content}` };
          return { role: m.role, content: m.content, images: [await blobToImagePart(m.image)] };
        }),
      );

      let acc = '';
      for await (const chunk of coachReply(settings, turns, context, controller.signal)) {
        acc += chunk;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m)),
        );
      }

      if (!acc.trim()) throw new Error('The model returned an empty reply.');
      await updateChat(assistantMsg.id, { content: acc, streaming: false });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc, streaming: false } : m)),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Keep whatever streamed before the user stopped it.
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
        );
        const partial = messages.find((m) => m.id === assistantMsg.id)?.content ?? '';
        await updateChat(assistantMsg.id, { streaming: false, content: partial });
      } else {
        const message = describeError(err);
        setError(message);
        await updateChat(assistantMsg.id, {
          content: message,
          streaming: false,
          error: true,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: message, streaming: false, error: true }
              : m,
          ),
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  /** Writes the confirmed meal, one call per slot, then says so in the thread. */
  async function commitLog() {
    if (!pendingLog || logBusy) return;
    setLogBusy(true);
    try {
      let count = 0;
      for (const group of pendingLog) {
        const items = group.items.map((r) => r.item).filter((i): i is NonNullable<typeof i> => Boolean(i));
        if (!items.length) continue;
        await addMealItems(selectedDate, group.slot, items);
        count += items.length;
      }
      if (!count) return;

      const where = describeSlots(pendingLog.filter((g) => g.items.some((r) => r.item)));
      setPendingLog(null);
      const note = await addChat({
        role: 'assistant',
        content: `Logged ${count} item${count === 1 ? '' : 's'} to ${where}.`,
        createdAt: Date.now(),
      });
      setMessages((prev) => [...prev, note]);
      showToast({ message: `${count} item${count === 1 ? '' : 's'} added to ${where}` });
    } finally {
      setLogBusy(false);
    }
  }

  /**
   * Sends only the items the food table could not place to the model, and folds
   * what comes back into the same preview. The rows that already resolved are
   * left exactly as they are — there is no reason to pay for, or risk
   * re-estimating, food whose numbers are already known.
   */
  async function estimateMissing() {
    if (!pendingLog || logBusy) return;
    const missing = pendingLog.flatMap((g) => g.items.filter((r) => !r.item).map((r) => r.parsed.raw));
    if (!missing.length) return;

    setLogBusy(true);
    setError('');
    try {
      const analysis = await parseSpokenMeal(settings, missing.join(', '));
      const queue = [...analysis.items];
      setPendingLog((prev) =>
        prev?.map((group) => ({
          ...group,
          items: group.items.map((row) =>
            row.item || !queue.length ? row : { ...row, item: queue.shift() },
          ),
        })) ?? null,
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLogBusy(false);
    }
  }

  // A chip tapped on the Home insight card arrives as ?q=
  useEffect(() => {
    const q = params.get('q');
    if (!q || !loaded || sentInitial.current || !keyed) return;
    sentInitial.current = true;
    setParams({}, { replace: true });
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loaded, keyed]);

  return (
    <div className="flex h-dvh flex-col">
      <PageHeader
        title="Ria"
        subtitle="Your nutrition & fitness coach"
        back={-1}
        action={
          messages.length > 0 ? (
            <button
              type="button"
              onClick={async () => {
                await clearChat();
                setMessages([]);
                setError('');
              }}
              aria-label="Clear conversation"
              className="mr-1 rounded-full p-2 text-muted hover:text-red-600"
            >
              <IconTrash width={18} height={18} />
            </button>
          ) : undefined
        }
      />

      <div ref={scrollRef} className="scroll-y flex-1 space-y-3 px-4 py-4">
        {messages.length === 0 && (
          <div className="pt-6">
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center accent-card">
                <IconSparkle width={26} height={26} />
              </div>
              <p className="text-[15px] font-bold">Ask Ria anything</p>
              <p className="max-w-xs text-[12.5px] text-secondary">
                She can see today&apos;s log, your targets and your recent trends.
              </p>
            </div>
            <p className="mb-1.5 px-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
              Log a meal
            </p>
            <div className="mb-4 space-y-1.5">
              {LOG_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="hairline w-full rounded-xl border px-3.5 py-3 text-left font-mono text-[12.5px]"
                >
                  {example}
                </button>
              ))}
              <p className="px-1 pt-0.5 text-[11.5px] text-muted">
                Name the meal, then the food — no AI key needed.
              </p>
            </div>

            <p className="mb-1.5 px-1 text-[11.5px] font-semibold tracking-wide text-muted uppercase">
              Ask Ria
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="hairline w-full rounded-xl border px-3.5 py-3 text-left text-[13.5px]"
                >
                  {s}
                </button>
              ))}
            </div>
            {!keyed && (
              <p className="mt-3 px-1 text-center text-[12px] text-muted">
                Questions need an AI key.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="font-semibold text-brand-600"
                >
                  Add one
                </button>
              </p>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <Bubble key={msg.id} message={msg} />
        ))}

        {pendingLog && (
          <LogPreview
            groups={pendingLog}
            busy={logBusy}
            canEstimate={keyed}
            onConfirm={commitLog}
            onCancel={() => setPendingLog(null)}
            onEstimate={estimateMissing}
          />
        )}

        {error && (
          <p className="px-1 text-center text-[12px] text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-3 pt-2.5 pb-safe">
        {attachment && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="relative">
              <img
                src={attachment.url}
                alt="Photo to send"
                className="h-16 w-16 rounded-xl object-cover"
              />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove photo"
                className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <IconClose width={13} height={13} />
              </button>
            </div>
            <p className="text-[12px] text-secondary">
              Ask about it, or just send — Ria will tell you what she sees.
            </p>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || attaching}
            aria-label="Add a photo"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary hover:surface-sunken disabled:opacity-40"
          >
            <IconCamera width={20} height={20} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void attach(e.target.files?.[0])}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Grow with content up to a cap, then scroll internally.
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={attachment ? 'Ask about this photo…' : 'Ask, or log “breakfast: idly 2”'}
            className="hairline max-h-30 flex-1 resize-none rounded-2xl border bg-transparent px-3.5 py-2.5 text-[15px] outline-none focus:border-brand-500"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop generating"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
            >
              <IconClose width={18} height={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={!input.trim() && !attachment}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white disabled:opacity-40"
            >
              <IconSend width={18} height={18} />
            </button>
          )}
        </div>
        <p className="pt-1.5 pb-1 text-center text-[10.5px] text-muted">
          Ria is an AI, not a clinician. Check anything medical with a professional.
        </p>
      </div>
    </div>
  );
}

/**
 * The confirmation step for a typed meal.
 *
 * Shows every row with the numbers it would log, and marks the ones the food
 * table could not place rather than dropping them silently — a missing item is
 * the user's decision to make, not something to hide behind a total.
 */
function LogPreview({
  groups,
  busy,
  canEstimate,
  onConfirm,
  onCancel,
  onEstimate,
}: {
  groups: ResolvedGroup[];
  busy: boolean;
  canEstimate: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onEstimate: () => void;
}) {
  const rows = groups.flatMap((g) => g.items);
  const resolved = rows.filter((r) => r.item);
  const missing = rows.length - resolved.length;
  const kcal = Math.round(resolved.reduce((sum, r) => sum + (r.item?.nutrients.kcal ?? 0), 0));

  return (
    <Card className="space-y-3">
      {groups.map((group, gi) => (
        <div key={`${group.slot}-${gi}`} className="space-y-1">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-secondary">
            {MEAL_SLOT_LABEL[group.slot]}
            {group.inferredSlot && (
              <span className="text-[11px] font-normal text-muted">· guessed from the time</span>
            )}
          </p>
          <ul>
            {group.items.map((row, i) => (
              <li
                key={`${row.parsed.raw}-${i}`}
                className="flex items-center gap-2 border-b border-[var(--surface-border)] py-1.5 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">
                    {row.item?.name ?? row.parsed.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-secondary">
                    {row.item
                      ? formatPortion(row.item.qty, row.item.servingLabel)
                      : `“${row.parsed.raw}” — not in your foods`}
                  </span>
                </span>
                {row.item ? (
                  <span className="tabular shrink-0 text-[13px] font-semibold">
                    {Math.round(row.item.nutrients.kcal)}
                  </span>
                ) : (
                  <IconWarning width={15} height={15} className="shrink-0 text-amber-500" />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {missing > 0 && (
        <p className="text-[12px] text-secondary">
          {missing} item{missing === 1 ? '' : 's'} not found.{' '}
          {canEstimate
            ? 'Estimate them with AI, or log the rest and add them by hand.'
            : 'Add an AI key to estimate them, or log the rest and add them by hand.'}
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {missing > 0 && canEstimate && (
          <Button variant="secondary" onClick={onEstimate} disabled={busy}>
            <IconSparkle width={15} height={15} />
            {busy ? '…' : 'Estimate'}
          </Button>
        )}
        <Button full onClick={onConfirm} disabled={busy || resolved.length === 0}>
          <IconPlus width={15} height={15} />
          Log {kcal} Cal
        </Button>
      </div>
    </Card>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.image && <ChatPhoto blob={message.image} />}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2.5 text-[14px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[88%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[14px] leading-relaxed ${
          message.error ? 'tint-soft tint-danger' : 'surface-card'
        }`}
      >
        {message.content ? (
          <FormattedReply text={message.content} />
        ) : (
          <span className="inline-flex gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-muted)]"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        )}
        {message.streaming && message.content && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-brand-500 align-middle" />
        )}
      </div>
    </div>
  );
}

/**
 * Minimal markdown rendering — bold, bullets and paragraphs only.
 * A full markdown parser is a lot of bytes for a coach that answers in
 * short paragraphs and the occasional list.
 */
function FormattedReply({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l));

        if (isList) {
          return (
            <ul key={bi} className={bi > 0 ? 'mt-2 space-y-1' : 'space-y-1'}>
              {lines.map((line, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                  <span>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className={bi > 0 ? 'mt-2' : ''}>
            {lines.map((line, li) => (
              <span key={li}>
                {inline(line)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function inline(text: string) {
  // Split on **bold** and `code`, keeping the delimiters via capture groups.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="surface-sunken rounded px-1 py-0.5 text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/** A photo in the thread. Its object URL lives exactly as long as the bubble. */
function ChatPhoto({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return <div className="h-44 w-44 rounded-2xl surface-sunken" />;
  return <img src={url} alt="Shared photo" className="max-h-60 max-w-[70%] rounded-2xl object-cover" />;
}
