import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { beginPointerDragSession } from "./usePointerDragSession";

export const RAIL_COLLAPSE_OVERSHOOT = 32;

interface UseHorizontalResizeOptions {
  min: number;
  max: number;
  defaultSize: number;
  storageKey?: string;
  resizeTargetRef?: RefObject<HTMLElement>;
  onCollapse?: () => void;
  onExpand?: () => void;
}

function loadSize(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Drag-to-resize a left panel width (pixels).
 *
 * During drag, width is written to the tree pane via rAF — React state commits
 * only on pointerup so tree/Monaco panels stay smooth.
 */
export function useHorizontalResize({
  min,
  max,
  defaultSize,
  storageKey,
  resizeTargetRef,
  onCollapse,
  onExpand,
}: UseHorizontalResizeOptions) {
  const [size, setSize] = useState(() =>
    clamp(loadSize(storageKey, defaultSize), min, max),
  );
  const [isResizing, setIsResizing] = useState(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const targetRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, w: 0 });

  const onResizeStart = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      if ("button" in e && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const handle = e.currentTarget as HTMLElement;

      // Prefer previous sibling (tree pane); fall back to parent of divider.
      const prev = handle.previousElementSibling;
      const parent = handle.parentElement;
      const treeCandidate =
        prev instanceof HTMLElement
          ? prev
          : parent?.previousElementSibling instanceof HTMLElement
          ? parent.previousElementSibling
          : null;
      // WorkspaceDrawer: resizeHandle is inside splitDivider; tree is
      // splitDivider.previousElementSibling.
      const divider =
        handle.closest("[data-split-divider]") ?? handle.parentElement;
      const fromDivider =
        divider?.previousElementSibling instanceof HTMLElement
          ? divider.previousElementSibling
          : null;
      targetRef.current = resizeTargetRef
        ? resizeTargetRef.current
        : fromDivider ?? treeCandidate;

      const savedSize = sizeRef.current;
      const targetWidth = resizeTargetRef?.current?.getBoundingClientRect().width;
      const isCollapsed = Boolean(
        onExpand && targetWidth !== undefined && targetWidth < min,
      );
      const startWidth = isCollapsed ? min : targetWidth || sizeRef.current;
      startRef.current = { x: e.clientX, w: startWidth };
      pendingRef.current = startWidth;
      setIsResizing(true);
      if (targetRef.current) {
        targetRef.current.style.width = `${startWidth}px`;
      }
      if (isCollapsed) {
        sizeRef.current = startWidth;
        setSize(startWidth);
        onExpand?.();
      }

      let collapseOnRelease = false;
      const onDrag = (clientX: number) => {
        const requested = Math.round(
          startRef.current.w + clientX - startRef.current.x,
        );
        collapseOnRelease = requested <= min - RAIL_COLLAPSE_OVERSHOOT;
        const next = clamp(requested, min, max);
        pendingRef.current = next;
        if (targetRef.current) {
          targetRef.current.style.width = `${next}px`;
        }
      };
      const finishDrag = () => {
        const finalSize = pendingRef.current ?? sizeRef.current;
        const target = targetRef.current;
        pendingRef.current = null;
        targetRef.current = null;
        setIsResizing(false);
        if (collapseOnRelease && onCollapse) {
          sizeRef.current = savedSize;
          setSize(savedSize);
          if (target) target.style.width = `${savedSize}px`;
          onCollapse();
          return;
        }
        sizeRef.current = finalSize;
        setSize(finalSize);
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, String(finalSize));
          } catch {
            /* ignore */
          }
        }
      };

      // MouseEvent path (no pointerId).
      if (!("pointerId" in e)) {
        const onMove = (ev: MouseEvent) => onDrag(ev.clientX);
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          finishDrag();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        return;
      }

      beginPointerDragSession({
        pointerId: e.pointerId,
        target: handle,
        cursor: "col-resize",
        onMove: onDrag,
        onEnd: finishDrag,
      });
    },
    [min, max, storageKey, resizeTargetRef, onCollapse, onExpand],
  );

  useEffect(() => {
    const clamped = clamp(size, min, max);
    if (clamped !== size) setSize(clamped);
  }, [min, max, size]);

  return { size, isResizing, onResizeStart };
}
