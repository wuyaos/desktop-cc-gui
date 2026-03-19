import { describe, expect, it } from 'vitest';
import {
  resolveShortcutPlatform,
  resolveUndoRedoShortcutAction,
} from './undoRedoShortcut.js';

describe('resolveShortcutPlatform', () => {
  it('normalizes platform names', () => {
    expect(resolveShortcutPlatform('MacIntel')).toBe('mac');
    expect(resolveShortcutPlatform('Win32')).toBe('windows');
    expect(resolveShortcutPlatform('Linux x86_64')).toBe('linux');
    expect(resolveShortcutPlatform('FreeBSD')).toBe('unknown');
  });
});

describe('resolveUndoRedoShortcutAction', () => {
  it('maps mac shortcuts', () => {
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', metaKey: true, shiftKey: false },
        'mac'
      )
    ).toBe('undo');
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', metaKey: true, shiftKey: true },
        'mac'
      )
    ).toBe('redo');
  });

  it('maps windows shortcuts', () => {
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', ctrlKey: true, shiftKey: false },
        'windows'
      )
    ).toBe('undo');
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'y', ctrlKey: true, shiftKey: false },
        'windows'
      )
    ).toBe('redo');
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', ctrlKey: true, shiftKey: true },
        'windows'
      )
    ).toBe('redo');
  });

  it('maps linux shortcuts', () => {
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', ctrlKey: true, shiftKey: false },
        'linux'
      )
    ).toBe('undo');
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'z', ctrlKey: true, shiftKey: true },
        'linux'
      )
    ).toBe('redo');
    expect(
      resolveUndoRedoShortcutAction(
        { key: 'y', ctrlKey: true, shiftKey: false },
        'linux'
      )
    ).toBeNull();
  });
});
