(function () {
  "use strict";

  const STORAGE_KEY = "theme";
  const DEFAULT_THEME = "dark";
  const THEMES = [
    { name: "light", label: "Light" },
    { name: "dark", label: "Dark" }
  ];

  // View-mode preference: the regular scrolling site vs. the game-mode overworld.
  // Set only by the explicit Game Mode / Regular Mode toggle buttons.
  const MODE_KEY = "viewMode";
  const GAME_MODE_URL = "game_mode/game_mode.html";

  const themeByName = new Map(THEMES.map((theme) => [theme.name, theme]));

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Selections should still work when storage is unavailable.
    }
  }

  // True only on the site's home page, so deep links to individual
  // articles are never auto-redirected into game mode.
  function isHomePage() {
    const path = window.location.pathname;
    return path.endsWith("/index.html") || path.endsWith("/");
  }

  // Returning visitors who last chose game mode land back in it from home.
  // Runs synchronously in <head> before the body renders, so there is no flash.
  if (readStorage(MODE_KEY) === "game" && isHomePage()) {
    window.location.replace(GAME_MODE_URL);
  }

  window.enterGameMode = function enterGameMode() {
    writeStorage(MODE_KEY, "game");
    window.location.href = GAME_MODE_URL;
  };

  function normalizeTheme(name) {
    return themeByName.has(name) ? name : DEFAULT_THEME;
  }

  function applyTheme(name, options) {
    const shouldPersist = !options || options.persist !== false;
    const normalizedName = normalizeTheme(name);

    document.body.classList.toggle("dark-mode", normalizedName === "dark");

    if (shouldPersist) {
      writeStorage(STORAGE_KEY, normalizedName);
    }
  }

  function setDefaultTheme() {
    applyTheme(readStorage(STORAGE_KEY) || DEFAULT_THEME, { persist: false });
  }

  window.toggleDarkMode = function toggleDarkMode() {
    const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
    applyTheme(nextTheme);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setDefaultTheme);
  } else {
    setDefaultTheme();
  }
})();
