import { api, isStopped } from './api.ts';
import { foldActivity } from './agentActivity.ts';
import type { AgentActivity, MemoryMessage } from '../shared/types.ts';

// A module-level store for the copilot chat turn. It lives OUTSIDE the React
// component tree so an in-flight turn survives navigating away from the copilot
// pane: the streaming fetch keeps running, the reply still streams into this
// store, and returning to the pane re-subscribes and shows it live (then the
// finished, persisted message). Without this the turn's state died with the
// unmounted component and the reply "disappeared" on navigation.
//
// Scoped to one profile at a time (each profile has its own copilot
// conversation); switching profiles resets it and abandons any in-flight turn.

export interface CopilotTurnState {
  profileId: string | null;
  messages: MemoryMessage[];
  // True while a turn is generating. Drives the composer's busy/Stop state.
  busy: boolean;
  // The reply currently streaming in, shown live until the saved message lands.
  streaming: string;
  // The agent's live working process (thinking + tool steps) for this turn.
  activity: AgentActivity[];
  error: string;
  // Whether the persisted history has been loaded at least once for this profile.
  loaded: boolean;
}

const EMPTY: CopilotTurnState = {
  profileId: null,
  messages: [],
  busy: false,
  streaming: '',
  activity: [],
  error: '',
  loaded: false
};

let state: CopilotTurnState = EMPTY;
// The in-flight turn's abort handle (the Stop button), kept at module scope so it
// outlives the component that started it.
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(patch: Partial<CopilotTurnState>): void {
  state = { ...state, ...patch };
  emit();
}

export const copilotTurn = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  // Stable snapshot for useSyncExternalStore — the same object reference until the
  // next set(), so React doesn't loop.
  getState(): CopilotTurnState {
    return state;
  },

  // Point the store at the active profile and load its history. On a profile
  // change the store resets and any in-flight turn is abandoned (it belonged to
  // the previous profile). A re-mount for the SAME profile only refreshes the
  // persisted messages and never clobbers an in-flight turn's streaming state.
  async init(profileId: string): Promise<void> {
    if (state.profileId !== profileId) {
      abort?.abort();
      abort = null;
      state = { ...EMPTY, profileId };
      emit();
    }
    try {
      const messages = await api.getMemoryMessages();
      set({ messages, loaded: true });
    } catch (e) {
      set({ error: (e as Error).message, loaded: true });
    }
  },

  // Send a message and stream the reply into the store. Safe to leave running
  // after the component unmounts — completion persists server-side and updates the
  // store so the result is there on return.
  async send(content: string, personaId: string): Promise<void> {
    set({
      error: '',
      messages: [...state.messages, { id: `tmp-${Date.now()}`, role: 'user', content, created_at: '' }],
      busy: true,
      streaming: '',
      activity: []
    });
    const ac = new AbortController();
    abort = ac;
    try {
      await api.sendMemoryMessageStream(
        content,
        personaId,
        (text) => set({ streaming: state.streaming + text }),
        { onStatus: (s) => set({ activity: foldActivity(state.activity, s) }) },
        ac.signal
      );
      // Resync to the persisted transcript (which now includes the saved reply).
      set({ messages: await api.getMemoryMessages() });
    } catch (e) {
      // A user stop saved no reply — resync to the persisted user message, no error.
      if (isStopped(e)) {
        try { set({ messages: await api.getMemoryMessages() }); } catch { /* keep optimistic */ }
      } else {
        set({ error: (e as Error).message });
      }
    } finally {
      if (abort === ac) abort = null;
      set({ busy: false, streaming: '', activity: [] });
    }
  },

  // Stop the in-flight turn (the Stop button). Cancels generation server-side.
  stop(): void {
    abort?.abort();
  },

  // Replace the message list (e.g. after "Review what I learned" or a manual
  // refresh) without touching the in-flight turn.
  setMessages(messages: MemoryMessage[]): void {
    set({ messages });
  },

  // Clear the conversation locally after the server transcript was wiped.
  clear(): void {
    set({ messages: [], error: '' });
  },

  setError(error: string): void {
    set({ error });
  }
};
