import { useRef } from 'react';

export interface UndoRedoSnapshot {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export type UndoRedoSource = 'input' | 'programmatic' | 'system';

export interface CommitSnapshotOptions {
  source?: UndoRedoSource;
  timestamp?: number;
  inputType?: string;
  forceNewTransaction?: boolean;
  selectionReplaced?: boolean;
  isComposing?: boolean;
}

export interface UndoRedoHistoryOptions {
  maxTransactions?: number;
  mergeWindowMs?: number;
}

interface UndoRedoHistoryState {
  past: UndoRedoSnapshot[];
  present: UndoRedoSnapshot | null;
  future: UndoRedoSnapshot[];
  lastCommittedAt: number;
  lastSource: UndoRedoSource | null;
  lastEndedAtBoundary: boolean;
}

export interface UndoRedoHistoryManager {
  commitSnapshot: (snapshot: UndoRedoSnapshot, options?: CommitSnapshotOptions) => boolean;
  undo: () => UndoRedoSnapshot | null;
  redo: () => UndoRedoSnapshot | null;
  reset: (snapshot?: UndoRedoSnapshot) => void;
  getPresent: () => UndoRedoSnapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getState: () => {
    canUndo: boolean;
    canRedo: boolean;
    pastCount: number;
    futureCount: number;
    present: UndoRedoSnapshot | null;
  };
}

const DEFAULT_MAX_TRANSACTIONS = 100;
const DEFAULT_MERGE_WINDOW_MS = 400;
const WHITESPACE_OR_NEWLINE_RE = /[\s\r\n\t]/;
const TRAILING_BOUNDARY_RE = /[\s\r\n\t]$/;

function clampSelection(value: number, textLength: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  if (normalized < 0) return 0;
  if (normalized > textLength) return textLength;
  return normalized;
}

function normalizeSnapshot(snapshot: UndoRedoSnapshot): UndoRedoSnapshot {
  const text = snapshot.text ?? '';
  const textLength = text.length;
  const start = clampSelection(snapshot.selectionStart, textLength);
  const end = clampSelection(snapshot.selectionEnd, textLength);
  return start <= end
    ? { text, selectionStart: start, selectionEnd: end }
    : { text, selectionStart: end, selectionEnd: start };
}

function cloneSnapshot(snapshot: UndoRedoSnapshot): UndoRedoSnapshot {
  return {
    text: snapshot.text,
    selectionStart: snapshot.selectionStart,
    selectionEnd: snapshot.selectionEnd,
  };
}

function snapshotsEqual(a: UndoRedoSnapshot, b: UndoRedoSnapshot): boolean {
  return (
    a.text === b.text &&
    a.selectionStart === b.selectionStart &&
    a.selectionEnd === b.selectionEnd
  );
}

function getDiffSegment(previous: string, current: string): {
  inserted: string;
  removed: string;
} {
  let start = 0;
  const minLength = Math.min(previous.length, current.length);
  while (start < minLength && previous[start] === current[start]) {
    start += 1;
  }

  let suffix = 0;
  const previousRemaining = previous.length - start;
  const currentRemaining = current.length - start;
  const maxSuffix = Math.min(previousRemaining, currentRemaining);
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    inserted: current.slice(start, current.length - suffix),
    removed: previous.slice(start, previous.length - suffix),
  };
}

function isInputTypeBoundary(inputType?: string): boolean {
  if (!inputType) return false;
  if (inputType.startsWith('insertFromPaste')) return true;
  if (inputType.startsWith('insertFromDrop')) return true;
  if (inputType.startsWith('insertParagraph')) return true;
  if (inputType.startsWith('delete')) return true;
  return false;
}

function shouldBoundaryByContent(previousText: string, nextText: string): boolean {
  const { inserted, removed } = getDiffSegment(previousText, nextText);
  if (WHITESPACE_OR_NEWLINE_RE.test(inserted)) return true;
  if (removed.includes('\n')) return true;
  return false;
}

function shouldEndAtBoundary(text: string): boolean {
  return TRAILING_BOUNDARY_RE.test(text);
}

export function createUndoRedoHistory(
  options: UndoRedoHistoryOptions = {}
): UndoRedoHistoryManager {
  const maxTransactions = Math.max(1, options.maxTransactions ?? DEFAULT_MAX_TRANSACTIONS);
  const mergeWindowMs = Math.max(0, options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS);

  const state: UndoRedoHistoryState = {
    past: [],
    present: null,
    future: [],
    lastCommittedAt: 0,
    lastSource: null,
    lastEndedAtBoundary: false,
  };

  const trimPast = () => {
    if (state.past.length <= maxTransactions) return;
    state.past.splice(0, state.past.length - maxTransactions);
  };

  const commitSnapshot = (
    rawSnapshot: UndoRedoSnapshot,
    options: CommitSnapshotOptions = {}
  ): boolean => {
    if (options.isComposing) {
      return false;
    }

    const source = options.source ?? 'input';
    const nextSnapshot = normalizeSnapshot(rawSnapshot);
    const timestamp = options.timestamp ?? Date.now();

    if (!state.present) {
      state.present = cloneSnapshot(nextSnapshot);
      state.lastCommittedAt = timestamp;
      state.lastSource = source;
      state.lastEndedAtBoundary = shouldEndAtBoundary(nextSnapshot.text);
      return true;
    }

    const previousSnapshot = state.present;
    if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
      return false;
    }

    const explicitBoundary = !!options.forceNewTransaction;
    const inputTypeBoundary = isInputTypeBoundary(options.inputType);
    const selectionBoundary = !!options.selectionReplaced;
    const contentBoundary = shouldBoundaryByContent(previousSnapshot.text, nextSnapshot.text);
    const hasBoundary = explicitBoundary || inputTypeBoundary || selectionBoundary || contentBoundary;

    const withinMergeWindow = timestamp - state.lastCommittedAt <= mergeWindowMs;
    const shouldMerge =
      source === 'input' &&
      state.lastSource === 'input' &&
      withinMergeWindow &&
      !hasBoundary &&
      !state.lastEndedAtBoundary;

    if (shouldMerge) {
      state.present = cloneSnapshot(nextSnapshot);
      state.lastCommittedAt = timestamp;
      state.lastSource = source;
      state.lastEndedAtBoundary = shouldEndAtBoundary(nextSnapshot.text);
      return true;
    }

    state.past.push(cloneSnapshot(previousSnapshot));
    trimPast();
    state.present = cloneSnapshot(nextSnapshot);
    state.future = [];
    state.lastCommittedAt = timestamp;
    state.lastSource = source;
    state.lastEndedAtBoundary = hasBoundary || shouldEndAtBoundary(nextSnapshot.text);
    return true;
  };

  const undo = (): UndoRedoSnapshot | null => {
    if (!state.present || state.past.length === 0) {
      return null;
    }

    const previous = state.past.pop();
    if (!previous) {
      return null;
    }

    state.future.unshift(cloneSnapshot(state.present));
    state.present = cloneSnapshot(previous);
    state.lastCommittedAt = Date.now();
    state.lastSource = 'system';
    state.lastEndedAtBoundary = shouldEndAtBoundary(state.present.text);
    return cloneSnapshot(state.present);
  };

  const redo = (): UndoRedoSnapshot | null => {
    if (!state.present || state.future.length === 0) {
      return null;
    }

    const next = state.future.shift();
    if (!next) {
      return null;
    }

    state.past.push(cloneSnapshot(state.present));
    trimPast();
    state.present = cloneSnapshot(next);
    state.lastCommittedAt = Date.now();
    state.lastSource = 'system';
    state.lastEndedAtBoundary = shouldEndAtBoundary(state.present.text);
    return cloneSnapshot(state.present);
  };

  const reset = (snapshot?: UndoRedoSnapshot): void => {
    state.past = [];
    state.future = [];
    state.present = snapshot ? normalizeSnapshot(snapshot) : null;
    state.lastCommittedAt = Date.now();
    state.lastSource = null;
    state.lastEndedAtBoundary = snapshot ? shouldEndAtBoundary(snapshot.text) : false;
  };

  return {
    commitSnapshot,
    undo,
    redo,
    reset,
    getPresent: () => (state.present ? cloneSnapshot(state.present) : null),
    canUndo: () => state.past.length > 0,
    canRedo: () => state.future.length > 0,
    getState: () => ({
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      pastCount: state.past.length,
      futureCount: state.future.length,
      present: state.present ? cloneSnapshot(state.present) : null,
    }),
  };
}

export function useUndoRedoHistory(
  options: UndoRedoHistoryOptions = {}
): UndoRedoHistoryManager {
  const managerRef = useRef<UndoRedoHistoryManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = createUndoRedoHistory(options);
  }
  return managerRef.current;
}
