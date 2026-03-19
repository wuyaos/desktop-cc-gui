import { describe, expect, it } from 'vitest';
import { createUndoRedoHistory, type UndoRedoSnapshot } from './useUndoRedoHistory.js';

function snapshot(text: string, cursor = text.length): UndoRedoSnapshot {
  return {
    text,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

describe('createUndoRedoHistory', () => {
  it('supports push, undo, redo, reset, and max stack size', () => {
    const history = createUndoRedoHistory({ maxTransactions: 2, mergeWindowMs: 0 });
    history.reset(snapshot(''));

    history.commitSnapshot(snapshot('a'), { timestamp: 100, source: 'input' });
    history.commitSnapshot(snapshot('ab'), { timestamp: 200, source: 'input', forceNewTransaction: true });
    history.commitSnapshot(snapshot('abc'), { timestamp: 300, source: 'input', forceNewTransaction: true });

    expect(history.undo()).toEqual(snapshot('ab'));
    expect(history.undo()).toEqual(snapshot('a'));
    expect(history.undo()).toBeNull();

    expect(history.redo()).toEqual(snapshot('ab'));
    history.reset(snapshot(''));
    expect(history.getState().present).toEqual(snapshot(''));
    expect(history.getState().pastCount).toBe(0);
  });

  it('merges continuous typing within merge window', () => {
    const history = createUndoRedoHistory({ mergeWindowMs: 400 });
    history.reset(snapshot(''));

    history.commitSnapshot(snapshot('h'), { source: 'input', inputType: 'insertText', timestamp: 100 });
    history.commitSnapshot(snapshot('he'), { source: 'input', inputType: 'insertText', timestamp: 180 });
    history.commitSnapshot(snapshot('hel'), { source: 'input', inputType: 'insertText', timestamp: 260 });

    expect(history.undo()).toEqual(snapshot(''));
    expect(history.undo()).toBeNull();
  });

  it('starts new transactions on whitespace and paste boundaries', () => {
    const history = createUndoRedoHistory({ mergeWindowMs: 400 });
    history.reset(snapshot(''));

    history.commitSnapshot(snapshot('hello'), { source: 'input', inputType: 'insertText', timestamp: 100 });
    history.commitSnapshot(snapshot('hello '), { source: 'input', inputType: 'insertText', timestamp: 180 });
    history.commitSnapshot(snapshot('hello w'), { source: 'input', inputType: 'insertText', timestamp: 260 });
    history.commitSnapshot(snapshot('hello world'), {
      source: 'input',
      inputType: 'insertFromPaste',
      timestamp: 320,
    });

    expect(history.undo()).toEqual(snapshot('hello w'));
    expect(history.undo()).toEqual(snapshot('hello '));
    expect(history.undo()).toEqual(snapshot('hello'));
  });

  it('creates a dedicated transaction for selection replacement', () => {
    const history = createUndoRedoHistory({ mergeWindowMs: 400 });
    history.reset(snapshot('hello world'));

    history.commitSnapshot(
      {
        text: 'hello x',
        selectionStart: 7,
        selectionEnd: 7,
      },
      {
        source: 'input',
        inputType: 'insertText',
        selectionReplaced: true,
        timestamp: 100,
      }
    );

    expect(history.undo()).toEqual(snapshot('hello world'));
  });

  it('clears redo chain on new input and skips no-op commits', () => {
    const history = createUndoRedoHistory({ mergeWindowMs: 0 });
    history.reset(snapshot(''));

    history.commitSnapshot(snapshot('a'), { source: 'input', timestamp: 1 });
    history.commitSnapshot(snapshot('ab'), { source: 'input', timestamp: 2, forceNewTransaction: true });
    expect(history.undo()).toEqual(snapshot('a'));

    history.commitSnapshot(snapshot('ac'), { source: 'input', timestamp: 3, forceNewTransaction: true });
    expect(history.redo()).toBeNull();

    const changed = history.commitSnapshot(snapshot('ac'), { source: 'programmatic', timestamp: 4 });
    expect(changed).toBe(false);
  });

  it('ignores IME interim composing snapshots and keeps finalized result undoable', () => {
    const history = createUndoRedoHistory({ mergeWindowMs: 400 });
    history.reset(snapshot(''));

    const interimCommitted = history.commitSnapshot(snapshot('ni'), {
      source: 'input',
      inputType: 'insertCompositionText',
      isComposing: true,
      timestamp: 100,
    });
    expect(interimCommitted).toBe(false);

    const finalizedCommitted = history.commitSnapshot(snapshot('你'), {
      source: 'input',
      inputType: 'insertText',
      isComposing: false,
      timestamp: 220,
    });
    expect(finalizedCommitted).toBe(true);
    expect(history.undo()).toEqual(snapshot(''));
  });
});
