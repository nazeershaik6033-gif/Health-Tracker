import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addChat, chatHistory, clearChat, dayBundle, updateChat } from '@/db/repo';
import { coachReply, dayContext } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError, type ChatTurn } from '@/ai/types';
import { Button, PageHeader } from '@/components/ui';
import { IconClose, IconSend, IconSparkle, IconTrash } from '@/components/icons';
import type { ChatMessage } from '@/types';

const SUGGESTIONS = [
  'Summarise my day and tell me what to fix',
  'What should I eat for dinner tonight?',
  'Am I getting enough protein?',
  'Why has my weight stalled?',
];

/** Keeps the request bounded — older turns fall out rather than growing forever. */
const HISTORY_TURNS = 12;

export default function Coach() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile, settings, selectedDate } = useApp();
  const keyed = hasKey(settings);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !keyed) return;

    setInput('');
    setError('');
    setBusy(true);

    const userMsg = await addChat({ role: 'user', content: trimmed, createdAt: Date.now() });
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
      const turns: ChatTurn[] = [...messages, userMsg]
        .filter((m) => m.content.trim())
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));

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

  // A chip tapped on the Home insight card arrives as ?q=
  useEffect(() => {
    const q = params.get('q');
    if (!q || !loaded || sentInitial.current || !keyed) return;
    sentInitial.current = true;
    setParams({}, { replace: true });
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loaded, keyed]);

  if (!keyed) {
    return (
      <div className="min-h-dvh">
        <PageHeader title="Ria" back={() => navigate(-1)} />
        <div className="flex flex-col items-center gap-4 px-8 pt-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <IconSparkle width={30} height={30} />
          </div>
          <p className="text-[15px] font-semibold">Meet Ria, your AI coach</p>
          <p className="max-w-xs text-[13px] leading-relaxed text-secondary">
            Ria reads what you&apos;ve logged and answers with your actual numbers — what to eat
            tonight, whether your protein is on track, why the scale has stalled. She needs an AI
            key to run.
          </p>
          <Button onClick={() => navigate('/settings')}>Add an API key</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <PageHeader
        title="Ria"
        subtitle="Your nutrition & fitness coach"
        back={() => navigate(-1)}
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

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="pt-6">
            <div className="mb-5 flex flex-col items-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <IconSparkle width={26} height={26} />
              </div>
              <p className="text-[15px] font-bold">Ask Ria anything</p>
              <p className="max-w-xs text-[12.5px] text-secondary">
                She can see today&apos;s log, your targets and your recent trends.
              </p>
            </div>
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
          </div>
        )}

        {messages.map((msg) => (
          <Bubble key={msg.id} message={msg} />
        ))}

        {error && (
          <p className="px-1 text-center text-[12px] text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-3 pt-2.5 pb-safe">
        <div className="flex items-end gap-2">
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
            placeholder="Ask about your day…"
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
              disabled={!input.trim()}
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

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
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
          message.error ? 'bg-red-50 text-red-800' : 'surface-card'
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
