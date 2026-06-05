import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  // Optional post-action confirmation. When set, the menu item briefly
  // renders feedback.label + feedback.icon in place of its own label/icon
  // before the menu closes — gives the user visible proof the action
  // succeeded (e.g. "Copied" after a clipboard write). Other items are
  // disabled while feedback is showing so a second click can't fire.
  feedback?: {
    label: string;
    icon?: ReactNode;
  };
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const FEEDBACK_DURATION_MS = 750;

export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [feedbackIdx, setFeedbackIdx] = useState<number | null>(null);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    // Position so the menu stays in viewport
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;

    if (x + rect.width > vw) left = vw - rect.width - 8;
    if (y + rect.height > vh) top = vh - rect.height - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // Focus first item (skip past the feedback state so we don't focus
    // an item that's about to be replaced)
    if (feedbackIdx === null) {
      const firstItem = menu.querySelector<HTMLButtonElement>('.context-menu-item');
      firstItem?.focus();
    }
  }, [x, y, feedbackIdx]);

  // Dismiss on outside click or Escape
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    // Delay adding listeners so the right-click that opened the menu
    // doesn't immediately close it via the pointerup→pointerdown cycle
    const id = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKeyDown);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close]);

  const runItem = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item || item.disabled) return;
      item.action();
      if (item.feedback) {
        setFeedbackIdx(idx);
        setTimeout(() => close(), FEEDBACK_DURATION_MS);
      } else {
        close();
      }
    },
    [items, close],
  );

  const onItemKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (feedbackIdx !== null) return;
      const menu = menuRef.current;
      if (!menu) return;
      const allItems = Array.from(menu.querySelectorAll<HTMLButtonElement>('.context-menu-item'));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (idx + 1) % allItems.length;
        allItems[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (idx - 1 + allItems.length) % allItems.length;
        allItems[prev]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        runItem(idx);
      }
    },
    [runItem, feedbackIdx],
  );

  const showingFeedback = feedbackIdx !== null;

  return createPortal(
    <div
      className={`context-menu${showingFeedback ? ' is-confirming' : ''}`}
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
    >
      {items.map((item, i) => {
        const isFeedback = feedbackIdx === i;
        const isShowingFeedback = isFeedback && item.feedback;
        const label = isShowingFeedback ? item.feedback!.label : item.label;
        const iconNode = isShowingFeedback ? item.feedback!.icon : item.icon;
        return (
          <button
            key={i}
            type="button"
            className={`context-menu-item${isFeedback ? ' is-confirmed' : ''}`}
            role="menuitem"
            disabled={item.disabled || (showingFeedback && !isFeedback)}
            tabIndex={0}
            onClick={() => runItem(i)}
            onKeyDown={(e) => onItemKeyDown(e, i)}
          >
            <span className="context-menu-icon">{iconNode}</span>
            <span className="context-menu-label">{label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
