// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeEventCapture } from './useNativeEventCapture';

function createBeforeInputEvent(inputType: string): Event {
  const event = new Event('beforeinput', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'inputType', {
    value: inputType,
    configurable: true,
  });
  return event;
}

function Harness({
  sendShortcut,
  onSubmit,
}: {
  sendShortcut: 'enter' | 'cmdEnter';
  onSubmit: () => void;
}) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndTimeRef = useRef(0);
  const completionSelectedRef = useRef(false);
  const submittedOnEnterRef = useRef(false);
  const closedCompletion = { isOpen: false };

  useNativeEventCapture({
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    sendShortcut,
    fileCompletion: closedCompletion,
    commandCompletion: closedCompletion,
    agentCompletion: closedCompletion,
    promptCompletion: closedCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit: onSubmit,
    handleEnhancePrompt: () => {},
  });

  return <div ref={editableRef} data-testid="editable" tabIndex={0} />;
}

describe('useNativeEventCapture', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not submit when Shift+Enter triggers beforeinput in enter mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps beforeinput fallback submit for plain enter mode', () => {
    const onSubmit = vi.fn();
    render(<Harness sendShortcut="enter" onSubmit={onSubmit} />);
    const editable = screen.getByTestId('editable');

    editable.dispatchEvent(createBeforeInputEvent('insertParagraph'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
