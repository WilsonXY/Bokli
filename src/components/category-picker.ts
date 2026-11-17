import type { SelectHTMLAttributes } from "react";

function canPositionPicker(select: HTMLSelectElement): boolean {
  return !select.disabled && window.innerWidth <= 767 && window.top === window &&
    CSS.supports("appearance: base-select") && typeof select.showPicker === "function" &&
    !select.matches(":open");
}

function openPicker(select: HTMLSelectElement): void {
  select.focus({ preventScroll: true });
  // Make room before opening, while this trusted event still has user activation.
  select.scrollIntoView({ block: "start", behavior: "instant" });
  select.showPicker();
}

export const phoneCategoryPickerEvents: Pick<
  SelectHTMLAttributes<HTMLSelectElement>, "onPointerDown" | "onClick" | "onKeyDown"
> = {
  onPointerDown(event) {
    if (event.isTrusted && !event.defaultPrevented && event.target === event.currentTarget &&
      event.button === 0 && canPositionPicker(event.currentTarget)) event.preventDefault();
  },
  onClick(event) {
    if (event.isTrusted && !event.defaultPrevented && event.target === event.currentTarget &&
      event.button === 0 && canPositionPicker(event.currentTarget)) {
      event.preventDefault();
      openPicker(event.currentTarget);
    }
  },
  onKeyDown(event) {
    if (event.isTrusted && !event.defaultPrevented && event.target === event.currentTarget &&
      [" ", "Enter", "ArrowDown", "ArrowUp"].includes(event.key) && canPositionPicker(event.currentTarget)) {
      event.preventDefault();
      openPicker(event.currentTarget);
    }
  },
};
