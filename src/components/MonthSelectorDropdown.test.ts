import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  MonthSelectorDropdown,
  type MonthOption,
} from "./MonthSelectorDropdown";
import { DICTIONARY } from "@/lib/i18n";

const t = DICTIONARY.zh;

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

describe("MonthSelectorDropdown", () => {
  const defaultOptions: MonthOption[] = [
    { month: "2026-05", status: "open" },
    { month: "2026-04", status: "closed" },
    { month: "2026-03", status: "reopened" },
  ];

  describe("rendering provided month options", () => {
    it("renders trigger button with current month and status badge", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthSelectorDropdown, {
          currentMonth: "2026-05",
          options: defaultOptions,
          onSelect: vi.fn(),
        }),
      );

      // Trigger button shows currentMonth and openStatus badge
      expect(html).toContain("2026-05");
      expect(html).toContain(t.openStatus);
      expect(html).not.toContain('role="listbox"');
    });

    it("renders full listbox with all options and status badges when open", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthSelectorDropdown, {
          currentMonth: "2026-05",
          options: defaultOptions,
          onSelect: vi.fn(),
          defaultOpen: true,
        }),
      );

      expect(html).toContain('role="listbox"');
      expect(html).toContain("2026-05");
      expect(html).toContain("2026-04");
      expect(html).toContain("2026-03");
      expect(html).toContain(t.openStatus);
      expect(html).toContain(t.closedStatus);
      expect(html).toContain(t.reopenedStatus);
    });
  });

  describe("selection callback handling", () => {
    it("calls onSelect when an unselected enabled month is clicked", () => {
      const onSelect = vi.fn();
      let tree: any = null;

      function TestWrapper() {
        tree = MonthSelectorDropdown({
          currentMonth: "2026-05",
          options: defaultOptions,
          onSelect,
          defaultOpen: true,
        });
        return tree;
      }

      ReactDOMServer.renderToStaticMarkup(React.createElement(TestWrapper));

      const optionButtons = findReactElements(
        tree,
        (el) => el.type === "button" && el.props?.role === "option",
      );
      expect(optionButtons).toHaveLength(3);

      // Click "2026-04" (closed month, but enabled and different from current)
      const aprilButton = optionButtons.find(
        (b) => b.props.children?.[0]?.props?.children === "2026-04",
      );
      expect(aprilButton).toBeDefined();

      aprilButton?.props.onClick();
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith("2026-04");
    });

    it("does not call onSelect when clicking the currently active month", () => {
      const onSelect = vi.fn();
      let tree: any = null;

      function TestWrapper() {
        tree = MonthSelectorDropdown({
          currentMonth: "2026-05",
          options: defaultOptions,
          onSelect,
          defaultOpen: true,
        });
        return tree;
      }

      ReactDOMServer.renderToStaticMarkup(React.createElement(TestWrapper));

      const optionButtons = findReactElements(
        tree,
        (el) => el.type === "button" && el.props?.role === "option",
      );

      // Click "2026-05" (already currentMonth)
      const mayButton = optionButtons.find(
        (b) => b.props.children?.[0]?.props?.children === "2026-05",
      );
      expect(mayButton).toBeDefined();

      mayButton?.props.onClick();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("disabled / locked months gating", () => {
    it("renders disabled month option with disabled attribute and cursor-not-allowed", () => {
      const optionsWithDisabled: MonthOption[] = [
        { month: "2026-05", status: "open" },
        { month: "2026-06", status: "open", disabled: true },
      ];

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MonthSelectorDropdown, {
          currentMonth: "2026-05",
          options: optionsWithDisabled,
          onSelect: vi.fn(),
          defaultOpen: true,
        }),
      );

      const juneBtn = html.match(/<button[^>]*disabled=""[^>]*>.*?2026-06.*?<\/button>/s)?.[0];
      expect(juneBtn).toBeDefined();
      expect(juneBtn).toContain("cursor-not-allowed");
    });

    it("does not trigger onSelect when a disabled month option is clicked", () => {
      const onSelect = vi.fn();
      const optionsWithDisabled: MonthOption[] = [
        { month: "2026-05", status: "open" },
        { month: "2026-06", status: "open", disabled: true },
      ];

      let tree: any = null;
      function TestWrapper() {
        tree = MonthSelectorDropdown({
          currentMonth: "2026-05",
          options: optionsWithDisabled,
          onSelect,
          defaultOpen: true,
        });
        return tree;
      }

      ReactDOMServer.renderToStaticMarkup(React.createElement(TestWrapper));

      const optionButtons = findReactElements(
        tree,
        (el) => el.type === "button" && el.props?.role === "option",
      );

      const juneButton = optionButtons.find(
        (b) => b.props.children?.[0]?.props?.children === "2026-06",
      );
      expect(juneButton).toBeDefined();
      expect(juneButton?.props.disabled).toBe(true);

      juneButton?.props.onClick();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
