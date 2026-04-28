(() => {
  const key = "minimaths_theme";
  const root = document.documentElement;
  const saved = localStorage.getItem(key);
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  // Default: follow system should look like light mode.
  else root.setAttribute("data-theme", "light");
})();
