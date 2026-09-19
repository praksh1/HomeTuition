/**
 * The small, deterministic contract behind Fadko's classroom pages.
 *
 * Pages are metadata, not drawings. The server owns the page list and the active page; the
 * Excalidraw scene for each page is synchronised separately. Keeping the rules here means the
 * web board, the native WebView bridge, and future board menus can all agree without copying
 * edge cases into components.
 */

export const BOARD_TEMPLATES = [
  "blank",
  "lined",
  "graph",
  "dots",
  "math-grid",
  "coordinate",
  "music-staff",
] as const;

export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

export interface WhiteboardPage {
  id: string;
  title: string;
  template: BoardTemplate;
  locked: boolean;
}

export interface WhiteboardPagesState {
  pages: WhiteboardPage[];
  activePageId: string;
}

export type WhiteboardPageAction =
  | { type: "add"; id: string; title?: string; template?: BoardTemplate }
  | { type: "duplicate"; id: string; newId: string; title?: string }
  | { type: "rename"; id: string; title: string }
  | { type: "template"; id: string; template: BoardTemplate }
  | { type: "lock"; id: string; locked: boolean }
  | { type: "delete"; id: string }
  | { type: "reorder"; id: string; toIndex: number }
  | { type: "select"; id: string };

const MAX_PAGES = 80;
const MAX_TITLE_LENGTH = 80;

function cleanTitle(title: string | undefined, fallback: string): string {
  const cleaned = (title ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_LENGTH);
  return cleaned || fallback;
}

function validTemplate(template: string | undefined): BoardTemplate {
  return BOARD_TEMPLATES.includes(template as BoardTemplate) ? (template as BoardTemplate) : "blank";
}

export function firstWhiteboardPage(): WhiteboardPage {
  return { id: "page-1", title: "Page 1", template: "blank", locked: false };
}

export function initialWhiteboardPages(): WhiteboardPagesState {
  const page = firstWhiteboardPage();
  return { pages: [page], activePageId: page.id };
}

export function normalizeWhiteboardPages(raw: unknown): WhiteboardPagesState {
  if (!raw || typeof raw !== "object") return initialWhiteboardPages();
  const source = raw as { pages?: unknown; activePageId?: unknown };
  const pages = Array.isArray(source.pages)
    ? source.pages
        .map((value, index) => {
          if (!value || typeof value !== "object") return null;
          const page = value as Record<string, unknown>;
          const id = typeof page.id === "string" && page.id.trim() ? page.id.trim().slice(0, 100) : `page-${index + 1}`;
          return {
            id,
            title: cleanTitle(typeof page.title === "string" ? page.title : undefined, `Page ${index + 1}`),
            template: validTemplate(typeof page.template === "string" ? page.template : undefined),
            locked: page.locked === true,
          } satisfies WhiteboardPage;
        })
        .filter((page): page is WhiteboardPage => page !== null)
        .slice(0, MAX_PAGES)
    : [];
  const unique: WhiteboardPage[] = [];
  const ids = new Set<string>();
  for (const page of pages) {
    if (ids.has(page.id)) continue;
    ids.add(page.id);
    unique.push(page);
  }
  const resultPages = unique.length > 0 ? unique : [firstWhiteboardPage()];
  const requested = typeof source.activePageId === "string" ? source.activePageId : "";
  const activePageId = resultPages.some((page) => page.id === requested) ? requested : resultPages[0].id;
  return { pages: resultPages, activePageId };
}

function withActive(state: WhiteboardPagesState, pages: WhiteboardPage[], activePageId = state.activePageId): WhiteboardPagesState {
  const nextPages = pages.length > 0 ? pages : [firstWhiteboardPage()];
  const active = nextPages.some((page) => page.id === activePageId) ? activePageId : nextPages[0].id;
  return { pages: nextPages, activePageId: active };
}

export function applyWhiteboardPageAction(
  input: WhiteboardPagesState,
  action: WhiteboardPageAction,
): WhiteboardPagesState {
  const state = normalizeWhiteboardPages(input);
  const index = state.pages.findIndex((page) => page.id === action.id);
  switch (action.type) {
    case "add": {
      if (state.pages.length >= MAX_PAGES || state.pages.some((page) => page.id === action.id)) return state;
      const page: WhiteboardPage = {
        id: action.id.trim().slice(0, 100),
        title: cleanTitle(action.title, `Page ${state.pages.length + 1}`),
        template: validTemplate(action.template),
        locked: false,
      };
      if (!page.id) return state;
      return withActive(state, [...state.pages, page], page.id);
    }
    case "duplicate": {
      if (index < 0 || !action.newId.trim() || state.pages.some((page) => page.id === action.newId)) return state;
      if (state.pages.length >= MAX_PAGES) return state;
      const source = state.pages[index];
      const copy: WhiteboardPage = {
        ...source,
        id: action.newId.trim().slice(0, 100),
        title: cleanTitle(action.title, `${source.title} copy`),
        locked: false,
      };
      const pages = [...state.pages];
      pages.splice(index + 1, 0, copy);
      return withActive(state, pages, copy.id);
    }
    case "rename":
      if (index < 0) return state;
      return withActive(state, state.pages.map((page, i) => i === index ? { ...page, title: cleanTitle(action.title, page.title) } : page));
    case "template":
      if (index < 0) return state;
      return withActive(state, state.pages.map((page, i) => i === index ? { ...page, template: validTemplate(action.template) } : page));
    case "lock":
      if (index < 0) return state;
      return withActive(state, state.pages.map((page, i) => i === index ? { ...page, locked: action.locked === true } : page));
    case "delete": {
      if (index < 0 || state.pages.length === 1) return state;
      const pages = state.pages.filter((page) => page.id !== action.id);
      const active = state.activePageId === action.id ? pages[Math.max(0, index - 1)].id : state.activePageId;
      return withActive(state, pages, active);
    }
    case "reorder": {
      if (index < 0) return state;
      const pages = [...state.pages];
      const [page] = pages.splice(index, 1);
      const to = Math.max(0, Math.min(pages.length, Math.trunc(action.toIndex)));
      pages.splice(to, 0, page);
      return withActive(state, pages);
    }
    case "select":
      return state.pages.some((page) => page.id === action.id) ? { ...state, activePageId: action.id } : state;
  }
}

export function nextWhiteboardPage(state: WhiteboardPagesState): WhiteboardPage {
  const index = state.pages.findIndex((page) => page.id === state.activePageId);
  return state.pages[Math.min(state.pages.length - 1, Math.max(0, index + 1))];
}

export function previousWhiteboardPage(state: WhiteboardPagesState): WhiteboardPage {
  const index = state.pages.findIndex((page) => page.id === state.activePageId);
  return state.pages[Math.max(0, index - 1)];
}

export function activeWhiteboardPage(state: WhiteboardPagesState): WhiteboardPage {
  return state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0] ?? firstWhiteboardPage();
}

export const whiteboardPageLimits = { maxPages: MAX_PAGES, maxTitleLength: MAX_TITLE_LENGTH } as const;
