import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";

const MIN_SIDEBAR_WIDTH = 210;
const MAX_SIDEBAR_WIDTH = 360;
const MIN_RIGHT_PANEL_WIDTH = 270;
const MAX_RIGHT_PANEL_WIDTH = 420;
const MIN_PLAN_PANEL_HEIGHT = 140;
const MAX_PLAN_PANEL_HEIGHT = 420;
const MIN_TERMINAL_PANEL_HEIGHT = 140;
const MAX_TERMINAL_PANEL_HEIGHT = 480;
const MIN_DEBUG_PANEL_HEIGHT = 120;
const MAX_DEBUG_PANEL_HEIGHT = 420;
const MIN_KANBAN_CONVERSATION_WIDTH = 340;
const MAX_KANBAN_CONVERSATION_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 210;
const DEFAULT_RIGHT_PANEL_WIDTH = 230;
const DEFAULT_PLAN_PANEL_HEIGHT = 220;
const DEFAULT_TERMINAL_PANEL_HEIGHT = 220;
const DEFAULT_DEBUG_PANEL_HEIGHT = 180;
const DEFAULT_KANBAN_CONVERSATION_WIDTH = 420;

type ResizeState = {
  type: "sidebar" | "right-panel" | "plan-panel" | "terminal-panel" | "debug-panel" | "kanban-conversation";
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredNum(key: string, fallback: number, min: number, max: number) {
  const stored = getClientStoreSync<number>("layout", key);
  if (stored === undefined || !Number.isFinite(stored)) {
    return fallback;
  }
  return clamp(stored, min, max);
}

export function useResizablePanels() {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredNum("sidebarWidth", DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredNum("rightPanelWidth", DEFAULT_RIGHT_PANEL_WIDTH, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH),
  );
  const [planPanelHeight, setPlanPanelHeight] = useState(() =>
    readStoredNum("planPanelHeight", DEFAULT_PLAN_PANEL_HEIGHT, MIN_PLAN_PANEL_HEIGHT, MAX_PLAN_PANEL_HEIGHT),
  );
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    readStoredNum("terminalPanelHeight", DEFAULT_TERMINAL_PANEL_HEIGHT, MIN_TERMINAL_PANEL_HEIGHT, MAX_TERMINAL_PANEL_HEIGHT),
  );
  const [debugPanelHeight, setDebugPanelHeight] = useState(() =>
    readStoredNum("debugPanelHeight", DEFAULT_DEBUG_PANEL_HEIGHT, MIN_DEBUG_PANEL_HEIGHT, MAX_DEBUG_PANEL_HEIGHT),
  );
  const [kanbanConversationWidth, setKanbanConversationWidth] = useState(() =>
    readStoredNum("kanbanConversationWidth", DEFAULT_KANBAN_CONVERSATION_WIDTH, MIN_KANBAN_CONVERSATION_WIDTH, MAX_KANBAN_CONVERSATION_WIDTH),
  );
  const resizeRef = useRef<ResizeState | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const appNodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    writeClientStoreValue("layout", "sidebarWidth", sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writeClientStoreValue("layout", "rightPanelWidth", rightPanelWidth);
  }, [rightPanelWidth]);

  useEffect(() => {
    writeClientStoreValue("layout", "planPanelHeight", planPanelHeight);
  }, [planPanelHeight]);

  useEffect(() => {
    writeClientStoreValue("layout", "terminalPanelHeight", terminalPanelHeight);
  }, [terminalPanelHeight]);

  useEffect(() => {
    writeClientStoreValue("layout", "debugPanelHeight", debugPanelHeight);
  }, [debugPanelHeight]);

  useEffect(() => {
    writeClientStoreValue("layout", "kanbanConversationWidth", kanbanConversationWidth);
  }, [kanbanConversationWidth]);

  const getAppNode = useCallback(() => {
    if (appNodeRef.current?.isConnected) {
      return appNodeRef.current;
    }
    const node = document.querySelector(".app");
    if (!(node instanceof HTMLElement)) {
      appNodeRef.current = null;
      return null;
    }
    appNodeRef.current = node;
    return node;
  }, []);

  const setResizingMode = useCallback(
    (active: boolean) => {
      const appNode = getAppNode();
      if (!appNode) {
        return;
      }
      if (active) {
        appNode.classList.add("is-resizing");
      } else {
        appNode.classList.remove("is-resizing");
      }
    },
    [getAppNode],
  );

  useEffect(() => {
    const flushPendingResize = () => {
      if (!resizeRef.current || pendingValueRef.current == null) {
        return;
      }
      const next = pendingValueRef.current;
      pendingValueRef.current = null;
      if (resizeRef.current.type === "sidebar") {
        setSidebarWidth((current) => (current === next ? current : next));
      } else if (resizeRef.current.type === "right-panel") {
        setRightPanelWidth((current) => (current === next ? current : next));
      } else if (resizeRef.current.type === "plan-panel") {
        setPlanPanelHeight((current) => (current === next ? current : next));
      } else if (resizeRef.current.type === "terminal-panel") {
        setTerminalPanelHeight((current) => (current === next ? current : next));
      } else if (resizeRef.current.type === "kanban-conversation") {
        setKanbanConversationWidth((current) => (current === next ? current : next));
      } else {
        setDebugPanelHeight((current) => (current === next ? current : next));
      }
    };

    const scheduleResizeApply = (next: number) => {
      pendingValueRef.current = next;
      if (resizeRafRef.current != null) {
        return;
      }
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        flushPendingResize();
      });
    };

    function handleMouseMove(event: MouseEvent) {
      if (!resizeRef.current) {
        return;
      }
      if (resizeRef.current.type === "sidebar") {
        const delta = event.clientX - resizeRef.current.startX;
        const next = clamp(
          resizeRef.current.startWidth + delta,
          MIN_SIDEBAR_WIDTH,
          MAX_SIDEBAR_WIDTH,
        );
        scheduleResizeApply(next);
      } else if (resizeRef.current.type === "right-panel") {
        const delta = event.clientX - resizeRef.current.startX;
        const next = clamp(
          resizeRef.current.startWidth - delta,
          MIN_RIGHT_PANEL_WIDTH,
          MAX_RIGHT_PANEL_WIDTH,
        );
        scheduleResizeApply(next);
      } else if (resizeRef.current.type === "plan-panel") {
        const delta = event.clientY - resizeRef.current.startY;
        const next = clamp(
          resizeRef.current.startHeight - delta,
          MIN_PLAN_PANEL_HEIGHT,
          MAX_PLAN_PANEL_HEIGHT,
        );
        scheduleResizeApply(next);
      } else if (resizeRef.current.type === "terminal-panel") {
        const delta = event.clientY - resizeRef.current.startY;
        const next = clamp(
          resizeRef.current.startHeight - delta,
          MIN_TERMINAL_PANEL_HEIGHT,
          MAX_TERMINAL_PANEL_HEIGHT,
        );
        scheduleResizeApply(next);
      } else if (resizeRef.current.type === "kanban-conversation") {
        const delta = event.clientX - resizeRef.current.startX;
        const next = clamp(
          resizeRef.current.startWidth - delta,
          MIN_KANBAN_CONVERSATION_WIDTH,
          MAX_KANBAN_CONVERSATION_WIDTH,
        );
        scheduleResizeApply(next);
      } else {
        const delta = event.clientY - resizeRef.current.startY;
        const next = clamp(
          resizeRef.current.startHeight - delta,
          MIN_DEBUG_PANEL_HEIGHT,
          MAX_DEBUG_PANEL_HEIGHT,
        );
        scheduleResizeApply(next);
      }
    }

    function handleMouseUp() {
      if (!resizeRef.current) {
        return;
      }
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      flushPendingResize();
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      setResizingMode(false);
    }

    function handleSelectStart(event: Event) {
      if (resizeRef.current) {
        event.preventDefault();
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleMouseUp);
    document.addEventListener("selectstart", handleSelectStart);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
      document.removeEventListener("selectstart", handleSelectStart);
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingValueRef.current = null;
      setResizingMode(false);
    };
  }, [setResizingMode]);

  const onSidebarResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "sidebar",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: sidebarWidth,
        startHeight: planPanelHeight,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [planPanelHeight, setResizingMode, sidebarWidth],
  );

  const onRightPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "right-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: planPanelHeight,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [planPanelHeight, rightPanelWidth, setResizingMode],
  );

  const onPlanPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "plan-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: planPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [planPanelHeight, rightPanelWidth, setResizingMode],
  );

  const onTerminalPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "terminal-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: terminalPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [rightPanelWidth, setResizingMode, terminalPanelHeight],
  );

  const onDebugPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "debug-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: debugPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [debugPanelHeight, rightPanelWidth, setResizingMode],
  );

  const onKanbanConversationResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      setResizingMode(true);
      resizeRef.current = {
        type: "kanban-conversation",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: kanbanConversationWidth,
        startHeight: 0,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [kanbanConversationWidth, setResizingMode],
  );

  return {
    sidebarWidth,
    rightPanelWidth,
    planPanelHeight,
    terminalPanelHeight,
    debugPanelHeight,
    kanbanConversationWidth,
    onSidebarResizeStart,
    onRightPanelResizeStart,
    onPlanPanelResizeStart,
    onTerminalPanelResizeStart,
    onDebugPanelResizeStart,
    onKanbanConversationResizeStart,
  };
}
