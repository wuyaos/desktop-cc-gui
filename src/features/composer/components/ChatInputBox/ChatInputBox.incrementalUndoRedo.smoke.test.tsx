// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ChatInputBoxHeader.js', () => ({
  ChatInputBoxHeader: () => null,
}));

vi.mock('./ChatInputBoxFooter.js', () => ({
  ChatInputBoxFooter: () => null,
}));

vi.mock('./ContextBar.js', () => ({
  ContextBar: () => null,
}));

vi.mock('./ResizeHandles.js', () => ({
  ResizeHandles: () => null,
}));

import { ChatInputBox } from './ChatInputBox.js';
import { resolveShortcutPlatform } from './utils/undoRedoShortcut.js';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    initReactI18next: {
      type: '3rdParty' as const,
      init: () => {},
    },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (options && typeof options.count === 'number') {
          return `${key}:${options.count}`;
        }
        return key;
      },
    }),
  };
});

function setEditableText(
  editable: HTMLDivElement,
  text: string,
  selectionStart = text.length,
  selectionEnd = selectionStart
) {
  editable.innerText = text;
  let textNode = editable.firstChild as Text | null;
  if (!(textNode instanceof Text)) {
    textNode = document.createTextNode(text);
    editable.innerHTML = '';
    editable.appendChild(textNode);
  }
  textNode.textContent = text;

  const range = document.createRange();
  range.setStart(textNode, Math.min(selectionStart, text.length));
  range.setEnd(textNode, Math.min(selectionEnd, text.length));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dispatchBeforeInput(editable: HTMLDivElement, inputType: string) {
  const beforeInput = new Event('beforeinput', { bubbles: true, cancelable: true });
  Object.defineProperty(beforeInput, 'inputType', {
    value: inputType,
    configurable: true,
  });
  editable.dispatchEvent(beforeInput);
}

describe('ChatInputBox incremental undo/redo smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
    delete (window as Window & { insertCodeSnippetAtCursor?: (selectionInfo: string) => void })
      .insertCodeSnippetAtCursor;
    delete (window as Window & { handleFilePathFromJava?: (filePathInput: string | string[]) => void })
      .handleFilePathFromJava;
  });

  it('supports typing undo/redo in a real ChatInputBox render', async () => {
    const view = render(<ChatInputBox showHeader={false} />);
    const editable = view.container.querySelector('.input-editable') as HTMLDivElement | null;
    expect(editable).toBeTruthy();
    if (!editable) return;
    Object.defineProperty(editable, 'isContentEditable', {
      value: true,
      configurable: true,
    });

    editable.focus();
    setEditableText(editable, 'hello');
    dispatchBeforeInput(editable, 'insertText');
    fireEvent.input(editable);
    await act(async () => {
      vi.runAllTimers();
    });

    setEditableText(editable, 'hello world');
    dispatchBeforeInput(editable, 'insertText');
    fireEvent.input(editable);
    await act(async () => {
      vi.runAllTimers();
    });

    const platform = resolveShortcutPlatform();
    const undoEvent =
      platform === 'mac' ? { key: 'z', metaKey: true } : { key: 'z', ctrlKey: true };
    const redoEvent =
      platform === 'mac'
        ? { key: 'z', metaKey: true, shiftKey: true }
        : platform === 'windows'
          ? { key: 'y', ctrlKey: true }
          : { key: 'z', ctrlKey: true, shiftKey: true };

    fireEvent.keyDown(editable, undoEvent);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(editable.innerText).toBe('hello');

    fireEvent.keyDown(editable, redoEvent);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(editable.innerText).toContain('hello world');

  });
});
