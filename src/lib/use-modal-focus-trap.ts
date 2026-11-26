"use client";

import { useEffect, useRef } from "react";

interface UseModalFocusTrapOptions {
  isOpen: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  onClose?: () => void;
  canClose?: boolean;
  returnFocusTo?: HTMLElement | null;
  /** Live fallback control if returnFocusTo / invoker is detached when the modal closes. */
  fallbackFocusRef?: React.RefObject<HTMLElement | null>;
  /** Skip restoring focus to invoker when closing because another modal (e.g. Discard guard) is taking focus. */
  suppressFocusRestore?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const openModalStack: HTMLElement[] = [];
const inertRefCounts = new WeakMap<HTMLElement, number>();

let scrollLockCount = 0;
let savedScrollState: {
  scrollX: number;
  scrollY: number;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyPaddingRight: string;
} | null = null;

/**
 * Reference-counted document scroll lock for open modal dialogs & pickers.
 * Prevents wheel and touch-swipe scrolling of the background page while
 * preserving internal scrolling inside modal content and restoring exact
 * window scroll coordinates when the last modal closes.
 */
export function acquireDocumentScrollLock(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const html = document.documentElement;
  const body = document.body;
  if (scrollLockCount === 0) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    savedScrollState = {
      scrollX,
      scrollY,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
    };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  scrollLockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0 && savedScrollState) {
      const prev = savedScrollState;
      savedScrollState = null;
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscrollBehavior;
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.right = prev.bodyRight;
      body.style.width = prev.bodyWidth;
      body.style.paddingRight = prev.bodyPaddingRight;
      window.scrollTo(prev.scrollX, prev.scrollY);
    }
  };
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.closest("[inert]") || el.hasAttribute("hidden")) return false;
  if (typeof window !== "undefined") {
    let curr: HTMLElement | null = el;
    while (curr && curr !== document.body) {
      const style = window.getComputedStyle(curr);
      if (style.display === "none" || style.visibility === "hidden") return false;
      curr = curr.parentElement;
    }
  }
  return el.getClientRects().length > 0;
}

/**
 * Shared modal isolation hook: reference-counts inert background siblings up to
 * document.body so overlapping traps never un-inert a live dialog's backdrop,
 * moves initial focus into the dialog, wraps Tab/Shift+Tab among visible controls,
 * routes Escape only to the topmost open modal, and restores focus to a live,
 * enabled, visible invoker (or live fallbackFocusRef) on close.
 */
export function useModalFocusTrap({
  isOpen,
  containerRef,
  onClose,
  canClose = true,
  returnFocusTo,
  fallbackFocusRef,
  suppressFocusRestore = false,
}: UseModalFocusTrapOptions) {
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const suppressFocusRestoreRef = useRef(suppressFocusRestore);
  suppressFocusRestoreRef.current = suppressFocusRestore;

  useEffect(() => {
    onCloseRef.current = onClose;
    canCloseRef.current = canClose;
  }, [onClose, canClose]);

  useEffect(() => {
    if (!isOpen) return;
    const modal = containerRef.current;
    if (!modal) return;

    openModalStack.push(modal);
    const releaseScrollLock = acquireDocumentScrollLock();

    const invoker =
      returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const inerted: HTMLElement[] = [];
    for (
      let node: HTMLElement | null = modal;
      node && node !== document.body;
      node = node.parentElement
    ) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (
          sibling !== node &&
          sibling instanceof HTMLElement &&
          !sibling.hasAttribute("data-inert-exempt")
        ) {
          const prevCount = inertRefCounts.get(sibling) ?? 0;
          if (prevCount > 0 || !sibling.inert) {
            sibling.inert = true;
            inertRefCounts.set(sibling, prevCount + 1);
            inerted.push(sibling);
          }
        }
      }
    }

    const focusableInModal = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        isElementVisible
      );

    const focusDialogOrFirst = () => {
      const first = focusableInModal()[0];
      if (first) {
        first.focus();
      } else {
        if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
        modal.focus();
      }
    };

    if (!modal.contains(document.activeElement)) {
      focusDialogOrFirst();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== modal) return;
      if (e.key === "Escape") {
        if (canCloseRef.current && onCloseRef.current) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = focusableInModal();
      if (focusable.length === 0) {
        e.preventDefault();
        if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !modal.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    const readFallbackTarget = () => fallbackFocusRef?.current ?? null;
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      releaseScrollLock();
      const stackIdx = openModalStack.lastIndexOf(modal);
      if (stackIdx !== -1) openModalStack.splice(stackIdx, 1);
      document.removeEventListener("keydown", handleKeyDown);
      for (const el of inerted) {
        const nextCount = Math.max(0, (inertRefCounts.get(el) ?? 1) - 1);
        if (nextCount === 0) {
          inertRefCounts.delete(el);
          el.inert = false;
        } else {
          inertRefCounts.set(el, nextCount);
        }
      }
      if (!suppressFocusRestoreRef.current) {
        const fallbackTarget = readFallbackTarget();
        const canFocusInvoker =
          invoker &&
          invoker !== document.body &&
          document.contains(invoker) &&
          !invoker.hasAttribute("disabled") &&
          isElementVisible(invoker);
        if (canFocusInvoker) {
          invoker.focus({ preventScroll: true });
        } else if (
          fallbackTarget &&
          document.contains(fallbackTarget) &&
          !fallbackTarget.hasAttribute("disabled") &&
          isElementVisible(fallbackTarget)
        ) {
          fallbackTarget.focus({ preventScroll: true });
        }
      }
    };
  }, [isOpen, containerRef, returnFocusTo, fallbackFocusRef]);
}
