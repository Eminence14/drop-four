/**
 * In-room chat for online games: one chat button opens quick phrases
 * (one tap to send, Free Fire style), emoji reactions and a short message log
 * with free text. Messages live inside the room, so they disappear with it.
 */
import type { SeatId } from '../online/types';
import { sheet } from './dialog';
import { h } from './dom';
import { announce, buzz, sfx, toast } from './fx';

export const QUICK_PHRASES = ['Oh shit 😱', 'Omo 😳', 'Wow 🤩', 'Nice one 👏', 'Sharpp ⚡', 'GG 🤝'];
export const EMOJI = ['👍', '😮', '😂', '🔥'];
export const MAX_LEN = 120;

export interface ChatMessage {
  by: SeatId;
  t: string;
  at: number;
}

interface ChatDeps {
  me: () => SeatId;
  nameOf: (s: SeatId) => string;
  send: (id: string, msg: { by: SeatId; t: string }) => Promise<void>;
  react: (emoji: string) => void;
  seatEl: (s: SeatId) => Element | null;
}

const newId = () => Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 6);
const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);

export class RoomChat {
  readonly button: HTMLButtonElement;
  private badge: HTMLElement;
  private seen = new Set<string>();
  private first = true;
  private unread = 0;
  private open = false;
  private log: HTMLElement | null = null;
  private messages: [string, ChatMessage][] = [];
  private lastSent = 0;

  constructor(private deps: ChatDeps) {
    this.badge = h('span', { class: 'chat-badge', hidden: true });
    this.button = h('button', { class: 'chat-fab', type: 'button', 'aria-label': 'Chat', onclick: () => this.openSheet() },
      h('span', { 'aria-hidden': 'true', class: 'chat-ic' }, '💬'),
      h('span', null, 'Chat'),
      this.badge,
    ) as HTMLButtonElement;
  }

  /** Feed the room's chat node on every update. */
  update(chat: Record<string, ChatMessage> | null | undefined) {
    const entries = Object.entries(chat ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    this.messages = entries.slice(-60);
    for (const [id, m] of entries) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (this.first) continue; // history from before we opened the room
      if (m.by !== this.deps.me()) this.incoming(m);
    }
    this.first = false;
    if (this.open) this.renderLog();
  }

  private incoming(m: ChatMessage) {
    this.bubble(m);
    sfx.tick();
    buzz(10);
    announce(`${this.deps.nameOf(m.by)} says: ${m.t}`);
    if (!this.open) {
      this.unread++;
      this.badge.hidden = false;
      this.badge.textContent = String(Math.min(this.unread, 9));
    }
  }

  /** Speech bubble over the sender's player card. */
  bubble(m: ChatMessage) {
    const seat = this.deps.seatEl(m.by);
    if (!seat) return;
    seat.querySelector('.chat-bubble')?.remove();
    const b = h('span', { class: 'chat-bubble', 'aria-hidden': 'true' }, m.t);
    seat.append(b);
    setTimeout(() => b.remove(), 3200);
  }

  async sendText(text: string): Promise<boolean> {
    const t = clean(text);
    if (!t) return false;
    if (Date.now() - this.lastSent < 1000) {
      toast('Slow down a little 🙂');
      return false;
    }
    this.lastSent = Date.now();
    const msg = { by: this.deps.me(), t };
    const id = newId();
    this.seen.add(id);
    this.bubble({ ...msg, at: Date.now() });
    try {
      await this.deps.send(id, msg);
      return true;
    } catch {
      toast("Message didn't send — check your connection.");
      return false;
    }
  }

  private renderLog() {
    if (!this.log) return;
    const me = this.deps.me();
    this.log.replaceChildren(
      ...(this.messages.length
        ? this.messages.map(([, m]) =>
            h('div', { class: 'msg' + (m.by === me ? ' mine' : '') },
              m.by === me ? null : h('span', { class: 'msg-who' }, this.deps.nameOf(m.by)),
              h('span', { class: 'msg-text' }, m.t),
            ),
          )
        : [h('p', { class: 'muted small center' }, 'No messages yet. Say hi 👋')]),
    );
    this.log.scrollTop = this.log.scrollHeight;
  }

  openSheet() {
    this.open = true;
    this.unread = 0;
    this.badge.hidden = true;
    let close = () => {};
    const quick = h('div', { class: 'quick-chat', role: 'group', 'aria-label': 'Quick messages' },
      ...QUICK_PHRASES.map((p) =>
        h('button', { class: 'quick-chip', type: 'button', onclick: () => { void this.sendText(p); close(); } }, p),
      ),
    );
    const emoji = h('div', { class: 'quick-emoji', role: 'group', 'aria-label': 'Reactions' },
      ...EMOJI.map((e) => h('button', { class: 'react-btn', type: 'button', 'aria-label': `Send ${e}`, onclick: () => { this.deps.react(e); close(); } }, e)),
    );
    this.log = h('div', { class: 'msg-log', role: 'log', 'aria-live': 'polite' });
    const input = h('input', { class: 'input', maxlength: String(MAX_LEN), placeholder: 'Type a message…', 'aria-label': 'Message', enterkeyhint: 'send' }) as HTMLInputElement;
    const form = h('form', { class: 'msg-form', onsubmit: async (e: Event) => {
      e.preventDefault();
      if (await this.sendText(input.value)) input.value = '';
    } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Send'));
    this.renderLog();
    const body = h('div', { class: 'sheet-body chat-body' }, quick, emoji, h('h3', { class: 'chat-h' }, 'Messages'), this.log, form,
      h('p', { class: 'muted small center' }, 'Messages disappear when the room closes.'));
    const doClose = sheet('Chat', body);
    close = () => {
      this.open = false;
      this.log = null;
      doClose();
    };
    // Closing via backdrop/Escape: watch for the sheet leaving the DOM.
    const sheetEl = body.closest('.sheet');
    const obs = new MutationObserver(() => {
      if (sheetEl && !sheetEl.isConnected) {
        this.open = false;
        this.log = null;
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
  }
}
