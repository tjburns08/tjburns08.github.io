(function () {
  "use strict";

  const STORAGE_KEY = "theme";
  const DEFAULT_THEME = "dark";
  const THEMES = [
    { name: "light", label: "Light" },
    { name: "dark", label: "Dark" }
  ];

  const themeByName = new Map(THEMES.map((theme) => [theme.name, theme]));

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function writeStorage(name) {
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch (_error) {
      // Theme selection should still work when storage is unavailable.
    }
  }

  function normalizeTheme(name) {
    return themeByName.has(name) ? name : DEFAULT_THEME;
  }

  function applyTheme(name, options) {
    const shouldPersist = !options || options.persist !== false;
    const normalizedName = normalizeTheme(name);

    document.body.classList.toggle("dark-mode", normalizedName === "dark");

    if (shouldPersist) {
      writeStorage(normalizedName);
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
