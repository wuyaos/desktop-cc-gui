// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  getVirtualSelectionRange,
  setVirtualSelectionRange,
} from './virtualCursorUtils.js';

function createEditable(html: string): HTMLDivElement {
  const editable = document.createElement('div');
  editable.contentEditable = 'true';
  editable.innerHTML = html;
  document.body.appendChild(editable);
  return editable;
}

describe('virtualCursorUtils selection range', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    const selection = window.getSelection();
    selection?.removeAllRanges();
  });

  it('reads and restores plain text selection ranges', () => {
    const editable = createEditable('hello world');
    const textNode = editable.firstChild as Text;

    const initialRange = document.createRange();
    initialRange.setStart(textNode, 1);
    initialRange.setEnd(textNode, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(initialRange);

    expect(getVirtualSelectionRange(editable)).toEqual({ start: 1, end: 5 });

    const restored = setVirtualSelectionRange(editable, 0, 5);
    expect(restored).toBe(true);
    expect(getVirtualSelectionRange(editable)).toEqual({ start: 0, end: 5 });
  });

  it('counts file tags as @filepath in virtual offsets', () => {
    const filePath = 'src/a.ts';
    const editable = createEditable(
      `start <span class="file-tag" data-file-path="${filePath}" contenteditable="false"><span class="file-tag-text">a.ts</span></span> end`
    );

    const expectedOffsetAfterTag = 'start '.length + filePath.length + 1;
    const moved = setVirtualSelectionRange(
      editable,
      expectedOffsetAfterTag,
      expectedOffsetAfterTag
    );
    expect(moved).toBe(true);
    const resolved = getVirtualSelectionRange(editable);
    expect(resolved).not.toBeNull();
    expect(resolved?.start).toBe(resolved?.end);
    expect(resolved?.start).toBeGreaterThanOrEqual(expectedOffsetAfterTag);

    const stabilized = setVirtualSelectionRange(
      editable,
      resolved?.start ?? 0,
      resolved?.end ?? 0
    );
    expect(stabilized).toBe(true);
    expect(getVirtualSelectionRange(editable)).toEqual(resolved);
  });
});
