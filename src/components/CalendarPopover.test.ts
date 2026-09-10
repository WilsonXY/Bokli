import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { CalendarPopover } from "./CalendarPopover";

// Helper to find React elements matching a predicate in a rendered VDOM tree
function findReactElements(
  node: any,
  predicate: (elem: React.ReactElement<any>) => boolean,
): React.ReactElement<any>[] {
  const matches: React.ReactElement<any>[] = [];
  function traverse(current: any) {
    if (!current) return;
    if (React.isValidElement(current)) {
      if (predicate(current)) {
        matches.push(current);
      }
      const children = (current.props as any)?.children;
      if (Array.isArray(children)) {
        children.forEach(traverse);
      } else if (children) {
        traverse(children);
      }
    } else if (Array.isArray(current)) {
      current.forEach(traverse);
    }
  }
  traverse(node);
  return matches;
}

describe("CalendarPopover", () => {
  describe("popover open and close states", () => {
    it("renders nothing when isOpen is false", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CalendarPopover, {
          date: "2026-05-15",
          todayKl: "2026-05-20",
          isOpen: false,
          onClose: vi.fn(),
          onSelectDate: vi.fn(),
        }),
      );
      expect(html).toBe("");
    });

    it("renders dialog and calendar structure when isOpen is true", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CalendarPopover, {
          date: "2026-05-15",
          todayKl: "2026-05-20",
          isOpen: true,
          onClose: vi.fn(),
          onSelectDate: vi.fn(),
        }),
      );
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-label="Date Picker"');
      expect(html).toContain("2026");
    });
  });

  describe("future dates disabled and past/today dates enabled", () => {
    it("disables future dates and marks them not selectable", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CalendarPopover, {
          date: "2026-05-15",
          todayKl: "2026-05-20",
          isOpen: true,
          onClose: vi.fn(),
          onSelectDate: vi.fn(),
        }),
      );

      // Past date (2026-05-15) and today (2026-05-20) are not disabled
      const btn15 = html.match(/<button[^>]*aria-label="2026-05-15"[^>]*>/)?.[0];
      expect(btn15).toBeDefined();
      expect(btn15).not.toContain("disabled");

      const btn20 = html.match(/<button[^>]*aria-label="2026-05-20"[^>]*>/)?.[0];
      expect(btn20).toBeDefined();
      expect(btn20).not.toContain("disabled");

      // Future dates (2026-05-21, 2026-05-31) must have disabled attribute and cursor-not-allowed
      const btn21 = html.match(/<button[^>]*aria-label="2026-05-21"[^>]*>/)?.[0];
      expect(btn21).toBeDefined();
      expect(btn21).toContain("disabled");
      expect(btn21).toContain("cursor-not-allowed");

      const btn31 = html.match(/<button[^>]*aria-label="2026-05-31"[^>]*>/)?.[0];
      expect(btn31).toBeDefined();
      expect(btn31).toContain("disabled");
    });

    it("disables next-month button when currently viewing todayKl month", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(CalendarPopover, {
          date: "2026-05-15",
          todayKl: "2026-05-20",
          isOpen: true,
          onClose: vi.fn(),
          onSelectDate: vi.fn(),
        }),
      );
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next Month"/);
    });
  });

  describe("date selection callbacks", () => {
    it("fires onSelectDate and onClose when a valid past or today date is selected", () => {
      const onSelectDate = vi.fn();
      const onClose = vi.fn();

      let tree: any = null;
      function TestWrapper() {
        tree = CalendarPopover({
          date: "2026-05-15",
          todayKl: "2026-05-20",
          isOpen: true,
          onClose,
          onSelectDate,
        });
        return tree;
      }

      ReactDOMServer.renderToStaticMarkup(React.createElement(TestWrapper));

      const dayButtons = findReactElements(
        tree,
        (el) => el.type === "button" && Boolean(el.props?.["aria-label"]?.match(/^\d{4}-\d{2}-\d{2}$/)),
      );

      // Select valid past date 2026-05-10
      const pastButton = dayButtons.find((btn) => btn.props["aria-label"] === "2026-05-10");
      expect(pastButton).toBeDefined();
      expect(pastButton?.props.disabled).toBe(false);

      pastButton?.props.onClick();
      expect(onSelectDate).toHaveBeenCalledWith("2026-05-10");
      expect(onClose).toHaveBeenCalledTimes(1);

      // Select today 2026-05-20
      const todayButton = dayButtons.find((btn) => btn.props["aria-label"] === "2026-05-20");
      expect(todayButton).toBeDefined();
      expect(todayButton?.props.disabled).toBe(false);

      todayButton?.props.onClick();
      expect(onSelectDate).toHaveBeenCalledWith("2026-05-20");
      expect(onClose).toHaveBeenCalledTimes(2);

      // Future date 2026-05-25 must have disabled=true
      const futureButton = dayButtons.find((btn) => btn.props["aria-label"] === "2026-05-25");
      expect(futureButton).toBeDefined();
      expect(futureButton?.props.disabled).toBe(true);
    });
  });
});
