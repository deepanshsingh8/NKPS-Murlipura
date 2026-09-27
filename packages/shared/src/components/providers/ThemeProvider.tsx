"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useMediaQuery } from "@nkps/shared/hooks/useMediaQuery";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "nkps-theme";

/** Status-bar / title-bar colour per resolved theme. Kept beside the theme
 *  logic because the two have to agree: a navy title bar over a dark app is
 *  fine, a navy title bar over a white one is the brand, and a mismatch reads
 *  as a rendering bug. */
const THEME_COLORS = { light: "#0A3D2A", dark: "#05241A" } as const;

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
  /** False until the stored preference has been read. A control that renders
   *  the current choice should wait for this rather than flash "Light". */
  hydrated: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  setTheme: () => {},
  resolvedTheme: "light",
  hydrated: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : null;
  } catch {
    // Safari in private mode throws on localStorage access.
    return null;
  }
}

/**
 * The script that has to run before the first paint.
 *
 * React cannot do this job: by the time the provider below mounts, the browser
 * has already painted a white page, and a dark-mode user sees a white flash on
 * every single navigation that reloads the document. So the class is stamped
 * onto <html> synchronously in <head>, and the provider takes over afterwards.
 *
 * Exported as a string for the layouts to inline. It is deliberately tiny and
 * deliberately wrapped in try/catch — a throw here would block rendering.
 *
 * Note the default: no stored preference means LIGHT, not "system". These apps
 * have shipped light-only for their whole life and the dark styling has never
 * been exercised in anger; opting every user with a dark phone into it
 * unannounced is not a change anyone asked for. Dark is a choice you make in
 * Settings, and "System" is right there for anyone who wants it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}");}catch(e){}})();`;

/**
 * Owns the theme choice and applies it to <html>.
 *
 * The previous version of this file deliberately did NOT touch
 * document.documentElement, on the grounds that it would affect the public
 * website. That reasoning predates the monorepo split: apps/website is now a
 * separate Next app with its own globals.css and cannot see this class. The
 * consequence of the old caution was ~3,300 `dark:` utilities across the
 * codebase that had never once applied to anything.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);

  const systemPrefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;

  // Read the stored preference once, after hydration. A lazy useState
  // initialiser can't do it — localStorage doesn't exist during SSR, and
  // reading it on the first client render would make that render disagree with
  // the server's.
  useEffect(() => {
    const stored = readStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setThemeState(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Before the read above lands, <html> already carries whatever
    // THEME_INIT_SCRIPT decided. Touching it here would undo that and
    // reintroduce exactly the flash the script exists to prevent.
    if (!hydrated) return;

    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    // Tells the browser to render its own furniture — form controls, scrollbars,
    // the caret — for this theme. Without it a dark page gets white dropdowns.
    root.style.colorScheme = resolvedTheme;

    // The browser paints its own chrome — the address bar on Android, the
    // status bar in an installed app — from this. It is the one piece of the
    // theme that lives outside the page, and it used to be the one piece that
    // did not follow the in-app choice.
    //
    // It was previously declared in each app's `viewport` export, as a
    // light/dark PAIR carrying media queries, and corrected here on the client.
    // The correction did not survive: Next re-renders the metadata on every
    // client-side navigation, which put the LIGHT colour back while the app
    // was still dark. Switching to dark and then opening any page from the
    // menu was enough to reproduce it.
    //
    // So the static declaration is gone from both layouts and this owns the
    // tag outright: THEME_INIT_SCRIPT creates it before first paint, and this
    // keeps it in step. Nothing re-renders it, so nothing can revert it. No
    // media attribute either — the app's own choice is the answer, and an
    // unmatched media query would hand it back to the OS preference.
    const color = THEME_COLORS[resolvedTheme];
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }, [hydrated, resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode — the choice applies for this session and is not kept.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, hydrated }}>
      {children}
    </ThemeContext.Provider>
  );
}
