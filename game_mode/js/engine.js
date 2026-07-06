/* ------------------------------------------------------------------
   Tyler's World — shared overworld engine.

   createWorld(config) builds one playable overworld inside the page's
   existing DOM skeleton (#world, #map-grid, #avatar, #legend, the HUD
   chips, the mobile title bar, etc.). game_mode.html (the main site
   map), sword_cave.html and meditations_dungeon.html call this with
   their own config so a single engine drives all three worlds.
   (social_mode.html is a separate, self-contained implementation.)

   config fields:
     cols, rows            grid size
     pageBase              prefix for internal urls ("" for same dir)
     spawn                 {x, y} starting tile for the cat
     regions               [{id, name, x0, y0, x1, y1}]
     articles              [{id, region, x, y, kind, token, title, date,
                             url, summary, secret?, kindLabel?,
                             collectible?, collectStatus?, takeStatus?,
                             haveStatus?, celebrate?, dialogue?,
                             requiresGremlinClear?, requiresFlags?}]
     connections           [[aId, bId], ...] straight paths to pave
     bridges               ["x,y", ...] walkable tiles spanning gaps
     corridors             [[x0,y0,x1,y1], ...] extra axis-aligned paths
     adjacencyExtensions   [[bridgeTile, extTile], ...]
     decorationRules       {regionId: {forest, hill}} (legacy pseudo-art)
                           or {regionId: {kinds: [{kind, p}, ...]}} for
                           weighted SVG props from the DECOR_SVGS library
     decorSvgs             optional {kind: "<rect .../>"} additions or
                           overrides for the decoration sprite library
     landmarks             [{x, y, w, h, svg}] multi-tile decorative
                           sprites rendered above tiles, below the avatar
     coast                 true to carve irregular coastlines out of the
                           region rectangles (visual only — walkable tiles
                           are never eroded). Adds sandy shore edges on
                           land and a lighter "shallow" band in the water.
     secrets               {id: {trigger, pathTiles, articleId, storageKey}}
     visitedKey            localStorage key for visited tracking
     gremlins              {count, intervalMs, staggerMs, svg,
                            caughtUrl?, spawnAnywhere?, minSpawnDistance?,
                            killItem?, clearedKey?,
                            speedster?: {svg, targetUrl, caughtKey, intervalMs?}}
------------------------------------------------------------------ */

function createWorld(config) {
  const DEFAULT_GREMLIN_SVG = `
    <svg class="gremlin-sprite" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="0" width="1" height="2" fill="#52297a"></rect>
      <rect x="12" y="0" width="1" height="2" fill="#52297a"></rect>
      <rect x="2" y="2" width="12" height="11" fill="#241812"></rect>
      <rect x="3" y="3" width="10" height="9" fill="#6cc55e"></rect>
      <rect x="3" y="9" width="10" height="3" fill="#4a8c3e"></rect>
      <rect x="4" y="5" width="3" height="2" fill="#c03050"></rect>
      <rect x="9" y="5" width="3" height="2" fill="#c03050"></rect>
      <rect x="5" y="5" width="1" height="1" fill="#ffffff"></rect>
      <rect x="10" y="5" width="1" height="1" fill="#ffffff"></rect>
      <rect x="6" y="10" width="4" height="2" fill="#241812"></rect>
      <rect x="6" y="10" width="1" height="1" fill="#ffe2a2"></rect>
      <rect x="9" y="10" width="1" height="1" fill="#ffe2a2"></rect>
      <rect x="4" y="13" width="2" height="2" fill="#241812"></rect>
      <rect x="10" y="13" width="2" height="2" fill="#241812"></rect>
      <rect x="4" y="13" width="2" height="1" fill="#4a8c3e"></rect>
      <rect x="10" y="13" width="2" height="1" fill="#4a8c3e"></rect>
    </svg>`;
  const CAT_BACK_SVG = `
                <rect x="4" y="1" width="2" height="2" fill="#241812"></rect>
                <rect x="10" y="1" width="2" height="2" fill="#241812"></rect>
                <rect x="3" y="2" width="4" height="2" fill="#241812"></rect>
                <rect x="9" y="2" width="4" height="2" fill="#241812"></rect>
                <rect x="4" y="2" width="2" height="2" fill="#f3a944"></rect>
                <rect x="10" y="2" width="2" height="2" fill="#f3a944"></rect>
                <rect x="3" y="4" width="10" height="7" fill="#241812"></rect>
                <rect x="4" y="4" width="8" height="6" fill="#d9842d"></rect>
                <rect x="5" y="5" width="6" height="3" fill="#f3a944"></rect>
                <rect x="4" y="8" width="8" height="2" fill="#c06f2a"></rect>
                <rect x="4" y="11" width="8" height="3" fill="#241812"></rect>
                <rect x="5" y="11" width="6" height="2" fill="#e99433"></rect>
                <rect x="2" y="10" width="3" height="2" fill="#241812"></rect>
                <rect x="2" y="9" width="2" height="2" fill="#e99433"></rect>
                <rect x="12" y="10" width="3" height="2" fill="#241812"></rect>
                <rect x="12" y="9" width="2" height="2" fill="#e99433"></rect>
                <rect x="4" y="14" width="3" height="1" fill="#241812"></rect>
                <rect x="9" y="14" width="3" height="1" fill="#241812"></rect>`;
  // Worn by the cat in every world once the Throne Room grants it.
  const CROWN_SVG = `
    <svg class="crown-sprite" viewBox="0 0 12 8" aria-hidden="true">
      <rect x="1" y="1" width="2" height="4" fill="#f4c542"></rect>
      <rect x="5" y="0" width="2" height="5" fill="#f4c542"></rect>
      <rect x="9" y="1" width="2" height="4" fill="#f4c542"></rect>
      <rect x="1" y="0" width="1" height="1" fill="#ffe14d"></rect>
      <rect x="5" y="0" width="1" height="1" fill="#ffe14d"></rect>
      <rect x="9" y="0" width="1" height="1" fill="#ffe14d"></rect>
      <rect x="1" y="4" width="10" height="3" fill="#f4c542"></rect>
      <rect x="1" y="6" width="10" height="1" fill="#d8a63c"></rect>
      <rect x="3" y="5" width="1" height="1" fill="#c94b37"></rect>
      <rect x="6" y="5" width="1" height="1" fill="#2d5e9e"></rect>
      <rect x="8" y="5" width="1" height="1" fill="#2d8a3e"></rect>
    </svg>`;
    "use strict";

    const COLS = config.cols;
    const ROWS = config.rows;
    const pageBase = config.pageBase || "";

    document.documentElement.style.setProperty("--cols", COLS);
    document.documentElement.style.setProperty("--rows", ROWS);

    /* ------------------------------------------------------------------
       DOM CACHE — every element the engine touches, looked up once.
       update() runs on every step, so this avoids re-querying the DOM on
       each frame and keeps the rest of the code free of getElementById
       noise. setStatus()/setSummary() centralise the two most-written
       text fields so callers read clearly.
    ------------------------------------------------------------------ */

    const dom = {
      world: document.getElementById("world"),
      viewport: document.getElementById("viewport"),
      avatar: document.getElementById("avatar"),
      mapGrid: document.getElementById("map-grid"),
      hud: document.querySelector(".hud"),
      regionChip: document.getElementById("region-chip"),
      visitedChip: document.getElementById("visited-chip"),
      legend: document.getElementById("legend"),
      status: document.getElementById("status"),
      kind: document.getElementById("kind"),
      title: document.getElementById("title"),
      date: document.getElementById("date"),
      summary: document.getElementById("summary"),
      location: document.getElementById("location"),
      openLink: document.getElementById("open-link"),
      floatOpen: document.getElementById("float-open"),
      titleBar: document.getElementById("mobile-title-bar"),
      mtbRegion: document.getElementById("mtb-region"),
      mtbTitle: document.getElementById("mtb-title"),
      mtbAction: document.getElementById("mtb-action"),
      mtbDate: document.getElementById("mtb-date"),
      mtbSummary: document.getElementById("mtb-summary"),
      catchFlash: document.getElementById("catch-flash")
    };

    function setStatus(msg) {
      if (dom.status) dom.status.textContent = msg;
    }
    function setSummary(msg) {
      if (dom.summary) dom.summary.textContent = msg;
    }

    /* ------------------------------------------------------------------
       REGIONS — themed rectangles on the giant map
    ------------------------------------------------------------------ */

    const regions = config.regions;

    function regionAt(x, y) {
      for (const r of regions) {
        if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r;
      }
      return null;
    }

    /* ------------------------------------------------------------------
       ARTICLES — every walkable level on the map
    ------------------------------------------------------------------ */

    const articles = config.articles;

    const articleById = new Map(articles.map((a) => [a.id, a]));
    const articleByCoord = new Map(articles.map((a) => [`${a.x},${a.y}`, a]));

    // Pool a caught cat can be warped to. Portals (and anything flagged
    // excludeFromWarp) are left out so a gremlin never drags the cat between
    // worlds — gremlins only ever warp within their own world.
    const warpTargets = articles.filter((a) => !a.excludeFromWarp && (!a.secret));
    const warpPool = warpTargets.length ? warpTargets : articles;

    /* ------------------------------------------------------------------
       VISITED TRACKING
    ------------------------------------------------------------------ */

    const VISITED_KEY = config.visitedKey || "tylersworld-visited";
    const visitedSet = new Set();

    function loadVisited() {
      try {
        const raw = localStorage.getItem(VISITED_KEY);
        if (raw) JSON.parse(raw).forEach((id) => visitedSet.add(id));
      } catch (e) { /* ignore */ }
    }

    function saveVisited() {
      try { localStorage.setItem(VISITED_KEY, JSON.stringify([...visitedSet])); }
      catch (e) { /* ignore */ }
    }

    function markVisited(id) {
      if (!id || visitedSet.has(id)) return;
      visitedSet.add(id);
      saveVisited();
      updateVisitedUI();
    }

    /* ------------------------------------------------------------------
       ITEMS — small global inventory shared by worlds. The first item is the
       sword, but this is intentionally generic so future special rooms can use
       the same mechanism.
    ------------------------------------------------------------------ */

    const ITEM_KEY_PREFIX = config.itemKeyPrefix || "tylersworld-item-";
    const ITEM_LABELS = { sword: "Sword", crown: "Crown" };
    const itemMemory = new Set();

    function itemKey(item) {
      return `${ITEM_KEY_PREFIX}${item}`;
    }

    function itemLabel(item) {
      return ITEM_LABELS[item] || item;
    }

    function hasItem(item) {
      if (!item) return false;
      if (itemMemory.has(item)) return true;
      try {
        if (localStorage.getItem(itemKey(item)) === "true") {
          itemMemory.add(item);
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    function grantItem(item) {
      if (!item) return false;
      const alreadyHad = hasItem(item);
      itemMemory.add(item);
      try { localStorage.setItem(itemKey(item), "true"); } catch (e) { /* ignore */ }
      updateItemUI();
      return !alreadyHad;
    }

    function updateItemUI() {
      const avatar = document.getElementById("avatar");
      if (avatar) {
        avatar.classList.remove("armed");
        avatar.classList.toggle("crowned", hasItem("crown"));
      }

      const chip = document.getElementById("item-chip");
      if (chip) chip.textContent = hasItem("sword") ? "Sword: found" : "Sword: hidden";
    }

    function isCollectibleCollected(a) {
      return !!(a && a.collectible && hasItem(a.collectible));
    }

    function updateVisitedUI() {
      const total = articles.filter((a) => !a.secret || secretRevealed[a.secret]).length;
      const count = visitedSet.size;
      document.getElementById("visited-chip").textContent = `${count} / ${total} visited`;
      document.querySelectorAll(".tile.article").forEach((el) => {
        const x = Number(el.dataset.x), y = Number(el.dataset.y);
        const art = articleByCoord.get(`${x},${y}`);
        if (art) el.classList.toggle("visited", visitedSet.has(art.id));
      });
    }

    /* ------------------------------------------------------------------
       SECRETS — Zelda-style hidden tiles, revealed by walking into a
       specific tile in a specific direction. Each secret defines a
       trigger (cat position + move direction) and a list of tiles that
       should appear when triggered. Discovered secrets are persisted in
       localStorage so they stay open across sessions.
    ------------------------------------------------------------------ */

    const SECRETS = config.secrets || {};

    const secretRevealed = {};
    const hiddenTiles = new Set();

    function loadSecretsFromStorage() {
      for (const id in SECRETS) {
        let opened = false;
        try {
          // Clean up any leftover persistent flag from an earlier version
          // that used localStorage — we now use sessionStorage so the secret
          // resets per tab/session.
          localStorage.removeItem(SECRETS[id].storageKey);
          opened = sessionStorage.getItem(SECRETS[id].storageKey) === "true";
        } catch (e) { /* storage blocked — treat as not opened */ }
        secretRevealed[id] = opened;
        if (!opened) {
          SECRETS[id].pathTiles.forEach((c) => hiddenTiles.add(c));
          const art = articleById.get(SECRETS[id].articleId);
          if (art) hiddenTiles.add(`${art.x},${art.y}`);
        }
      }
    }

    /* ------------------------------------------------------------------
       CONNECTIONS — within-region paths between articles
       Each [aId, bId] paves a straight (axis-aligned) path between them.
    ------------------------------------------------------------------ */

    const connections = config.connections || [];

    /* ------------------------------------------------------------------
       BRIDGES — explicit walkable tiles spanning the water gaps
       Each bridge is a list of "x,y" strings.
    ------------------------------------------------------------------ */

    const bridges = config.bridges || [];

    const bridgeSet = new Set(bridges);

    /* ------------------------------------------------------------------
       CORRIDORS — explicit axis-aligned path segments that don't fit the
       article-to-article pave model. Mostly: paths from bridge extensions
       back into each region's article network.
       Each entry is [x0, y0, x1, y1] (inclusive).
    ------------------------------------------------------------------ */

    const corridors = config.corridors || [];

    /* ------------------------------------------------------------------
       PROCEDURAL TERRAIN — scatter forest/hill within each region
       (deterministic so the map looks the same on every load)
    ------------------------------------------------------------------ */

    function hashXY(x, y) {
      // small deterministic hash for procedural decoration
      let h = (x * 73856093) ^ (y * 19349663);
      h = (h ^ (h >>> 13)) * 1274126177;
      return (h ^ (h >>> 16)) >>> 0;
    }

    const decorationRules = config.decorationRules || {};

    /* Pixel-art decoration sprites, keyed by kind. Regions opt in through
       decorationRules[region].kinds = [{kind, p}, ...] — weighted, drawn
       with the same deterministic hash as the legacy forest/hill scatter,
       so the map still looks identical on every load. Worlds can add or
       override sprites via config.decorSvgs. */
    const DECOR_SVGS = Object.assign({
      pine: `
        <rect x="6" y="2" width="4" height="2" fill="#1d7040"></rect>
        <rect x="5" y="4" width="6" height="2" fill="#145d31"></rect>
        <rect x="4" y="6" width="8" height="2" fill="#1d7040"></rect>
        <rect x="3" y="8" width="10" height="2" fill="#145d31"></rect>
        <rect x="2" y="10" width="12" height="2" fill="#1d7040"></rect>
        <rect x="7" y="12" width="2" height="3" fill="#6b4a24"></rect>`,
      oak: `
        <rect x="4" y="3" width="8" height="2" fill="#2e7942"></rect>
        <rect x="3" y="5" width="10" height="4" fill="#2e7942"></rect>
        <rect x="4" y="4" width="5" height="3" fill="#5dbf7a"></rect>
        <rect x="4" y="9" width="8" height="1" fill="#1d5c2f"></rect>
        <rect x="7" y="10" width="2" height="4" fill="#6b4a24"></rect>
        <rect x="6" y="13" width="4" height="1" fill="#503618"></rect>`,
      palm: `
        <rect x="6" y="2" width="4" height="2" fill="#37b45e"></rect>
        <rect x="2" y="3" width="4" height="2" fill="#2e9e4f"></rect>
        <rect x="10" y="3" width="4" height="2" fill="#2e9e4f"></rect>
        <rect x="1" y="5" width="3" height="2" fill="#27874a"></rect>
        <rect x="12" y="5" width="3" height="2" fill="#27874a"></rect>
        <rect x="7" y="5" width="2" height="9" fill="#b58a52"></rect>
        <rect x="7" y="7" width="2" height="1" fill="#8a6234"></rect>
        <rect x="7" y="10" width="2" height="1" fill="#8a6234"></rect>
        <rect x="6" y="14" width="4" height="1" fill="#8a6234"></rect>`,
      rock: `
        <rect x="5" y="6" width="5" height="2" fill="#a5a096"></rect>
        <rect x="4" y="8" width="8" height="5" fill="#8f8a80"></rect>
        <rect x="5" y="7" width="3" height="2" fill="#c2bdb2"></rect>
        <rect x="4" y="12" width="8" height="1" fill="#5f5b52"></rect>`,
      flower: `
        <rect x="3" y="6" width="3" height="3" fill="#e34d4d"></rect>
        <rect x="4" y="7" width="1" height="1" fill="#ffd84d"></rect>
        <rect x="9" y="4" width="3" height="3" fill="#e77aa0"></rect>
        <rect x="10" y="5" width="1" height="1" fill="#fff6d8"></rect>
        <rect x="10" y="9" width="3" height="3" fill="#f5f0e0"></rect>
        <rect x="11" y="10" width="1" height="1" fill="#ffd84d"></rect>
        <rect x="4" y="9" width="1" height="4" fill="#2d7a1f"></rect>
        <rect x="10" y="7" width="1" height="2" fill="#2d7a1f"></rect>
        <rect x="11" y="12" width="1" height="2" fill="#2d7a1f"></rect>
        <rect x="3" y="12" width="3" height="1" fill="#2d7a1f"></rect>`,
      server: `
        <rect x="3" y="2" width="10" height="13" fill="#0d0a26"></rect>
        <rect x="4" y="3" width="8" height="3" fill="#2e2660"></rect>
        <rect x="4" y="7" width="8" height="3" fill="#2e2660"></rect>
        <rect x="4" y="11" width="8" height="3" fill="#2e2660"></rect>
        <rect x="5" y="4" width="4" height="1" fill="#4a3a8c"></rect>
        <rect x="5" y="8" width="4" height="1" fill="#4a3a8c"></rect>
        <rect x="5" y="12" width="4" height="1" fill="#4a3a8c"></rect>
        <rect x="10" y="4" width="1" height="1" fill="#5fdf85"></rect>
        <rect x="10" y="8" width="1" height="1" fill="#f072c6"></rect>
        <rect x="10" y="12" width="1" height="1" fill="#ffd848"></rect>`,
      antenna: `
        <rect x="7" y="4" width="2" height="10" fill="#8a8fb0"></rect>
        <rect x="5" y="6" width="6" height="1" fill="#8a8fb0"></rect>
        <rect x="6" y="9" width="4" height="1" fill="#8a8fb0"></rect>
        <rect x="7" y="2" width="2" height="2" fill="#f072c6"></rect>
        <rect x="11" y="2" width="1" height="1" fill="#f072c6"></rect>
        <rect x="13" y="1" width="1" height="1" fill="#b06acc"></rect>
        <rect x="5" y="14" width="6" height="1" fill="#4a3a8c"></rect>`,
      chip: `
        <rect x="3" y="3" width="10" height="10" fill="#5fdf85"></rect>
        <rect x="4" y="4" width="8" height="8" fill="#0c1e12"></rect>
        <rect x="6" y="6" width="4" height="4" fill="#28a050"></rect>
        <rect x="5" y="1" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="7" y="1" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="9" y="1" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="5" y="13" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="7" y="13" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="9" y="13" width="1" height="2" fill="#c4ffcd"></rect>
        <rect x="1" y="5" width="2" height="1" fill="#c4ffcd"></rect>
        <rect x="1" y="7" width="2" height="1" fill="#c4ffcd"></rect>
        <rect x="1" y="9" width="2" height="1" fill="#c4ffcd"></rect>
        <rect x="13" y="5" width="2" height="1" fill="#c4ffcd"></rect>
        <rect x="13" y="7" width="2" height="1" fill="#c4ffcd"></rect>
        <rect x="13" y="9" width="2" height="1" fill="#c4ffcd"></rect>`,
      microscope: `
        <rect x="8" y="2" width="3" height="3" fill="#6fa1b3"></rect>
        <rect x="9" y="4" width="2" height="9" fill="#2e7186"></rect>
        <rect x="7" y="8" width="3" height="2" fill="#2e7186"></rect>
        <rect x="5" y="10" width="6" height="1" fill="#6fa1b3"></rect>
        <rect x="4" y="13" width="8" height="1" fill="#2e7186"></rect>
        <rect x="6" y="11" width="1" height="1" fill="#c94b37"></rect>`,
      flask: `
        <rect x="6" y="1" width="4" height="1" fill="#6fa1b3"></rect>
        <rect x="7" y="2" width="2" height="4" fill="#d3e9ef"></rect>
        <rect x="6" y="6" width="4" height="1" fill="#d3e9ef"></rect>
        <rect x="5" y="7" width="6" height="1" fill="#d3e9ef"></rect>
        <rect x="4" y="8" width="8" height="2" fill="#d3e9ef"></rect>
        <rect x="4" y="10" width="8" height="3" fill="#37b45e"></rect>
        <rect x="6" y="11" width="1" height="1" fill="#c4ffcd"></rect>
        <rect x="9" y="10" width="1" height="1" fill="#c4ffcd"></rect>
        <rect x="4" y="13" width="8" height="1" fill="#2e7186"></rect>`,
      book: `
        <rect x="3" y="10" width="10" height="3" fill="#a84632"></rect>
        <rect x="12" y="10" width="1" height="3" fill="#f5e8c8"></rect>
        <rect x="4" y="7" width="9" height="3" fill="#2d5e9e"></rect>
        <rect x="4" y="7" width="1" height="3" fill="#f5e8c8"></rect>
        <rect x="5" y="4" width="8" height="3" fill="#d8a03c"></rect>
        <rect x="12" y="4" width="1" height="3" fill="#f5e8c8"></rect>
        <rect x="6" y="5" width="4" height="1" fill="#8a6220"></rect>`,
      crate: `
        <rect x="3" y="4" width="10" height="10" fill="#a07748"></rect>
        <rect x="3" y="4" width="10" height="1" fill="#5a3b1a"></rect>
        <rect x="3" y="13" width="10" height="1" fill="#5a3b1a"></rect>
        <rect x="3" y="4" width="1" height="10" fill="#5a3b1a"></rect>
        <rect x="12" y="4" width="1" height="10" fill="#5a3b1a"></rect>
        <rect x="4" y="8" width="8" height="1" fill="#5a3b1a"></rect>
        <rect x="5" y="5" width="2" height="1" fill="#c49a6a"></rect>`,
      signpost: `
        <rect x="7" y="6" width="2" height="8" fill="#8a6234"></rect>
        <rect x="3" y="3" width="10" height="4" fill="#c89c50"></rect>
        <rect x="13" y="4" width="1" height="2" fill="#c89c50"></rect>
        <rect x="3" y="3" width="10" height="1" fill="#5a3b1a"></rect>
        <rect x="3" y="6" width="10" height="1" fill="#5a3b1a"></rect>
        <rect x="4" y="4" width="4" height="1" fill="#5a3b1a"></rect>
        <rect x="6" y="5" width="5" height="1" fill="#5a3b1a"></rect>
        <rect x="6" y="14" width="4" height="1" fill="#5a3b1a"></rect>`,
      cactus: `
        <rect x="6" y="3" width="3" height="10" fill="#2d8a3e"></rect>
        <rect x="6" y="3" width="1" height="10" fill="#4db35b"></rect>
        <rect x="3" y="5" width="2" height="4" fill="#2d8a3e"></rect>
        <rect x="3" y="8" width="3" height="2" fill="#2d8a3e"></rect>
        <rect x="11" y="4" width="2" height="3" fill="#2d8a3e"></rect>
        <rect x="9" y="6" width="3" height="2" fill="#2d8a3e"></rect>
        <rect x="7" y="2" width="1" height="1" fill="#e77aa0"></rect>
        <rect x="5" y="13" width="5" height="1" fill="#8a6234"></rect>`,
      dice: `
        <rect x="4" y="4" width="9" height="9" fill="#f4f6ff"></rect>
        <rect x="4" y="4" width="9" height="1" fill="#26314a"></rect>
        <rect x="4" y="12" width="9" height="1" fill="#26314a"></rect>
        <rect x="4" y="4" width="1" height="9" fill="#26314a"></rect>
        <rect x="12" y="4" width="1" height="9" fill="#26314a"></rect>
        <rect x="6" y="6" width="1" height="1" fill="#26314a"></rect>
        <rect x="10" y="6" width="1" height="1" fill="#26314a"></rect>
        <rect x="8" y="8" width="1" height="1" fill="#26314a"></rect>
        <rect x="6" y="10" width="1" height="1" fill="#26314a"></rect>
        <rect x="10" y="10" width="1" height="1" fill="#26314a"></rect>`,
      chart: `
        <rect x="3" y="3" width="10" height="9" fill="#fff8e0"></rect>
        <rect x="3" y="3" width="10" height="1" fill="#2a4a72"></rect>
        <rect x="3" y="11" width="10" height="1" fill="#2a4a72"></rect>
        <rect x="3" y="3" width="1" height="9" fill="#2a4a72"></rect>
        <rect x="12" y="3" width="1" height="9" fill="#2a4a72"></rect>
        <rect x="4" y="8" width="2" height="3" fill="#5e85b0"></rect>
        <rect x="7" y="6" width="2" height="5" fill="#2a4a72"></rect>
        <rect x="10" y="4" width="2" height="7" fill="#c94b37"></rect>
        <rect x="4" y="12" width="1" height="2" fill="#2a4a72"></rect>
        <rect x="11" y="12" width="1" height="2" fill="#2a4a72"></rect>`,
      frame: `
        <rect x="3" y="3" width="10" height="10" fill="#8a5e34"></rect>
        <rect x="4" y="4" width="8" height="8" fill="#f5e4c0"></rect>
        <rect x="5" y="5" width="6" height="3" fill="#9fc4e8"></rect>
        <rect x="5" y="8" width="6" height="3" fill="#7aa85a"></rect>
        <rect x="9" y="5" width="1" height="1" fill="#ffd84d"></rect>
        <rect x="7" y="13" width="2" height="1" fill="#5a3a1a"></rect>`,
      camera: `
        <rect x="3" y="5" width="10" height="7" fill="#5a3a1a"></rect>
        <rect x="4" y="3" width="3" height="2" fill="#5a3a1a"></rect>
        <rect x="6" y="6" width="4" height="4" fill="#241812"></rect>
        <rect x="7" y="7" width="1" height="1" fill="#9fc4e8"></rect>
        <rect x="11" y="4" width="2" height="1" fill="#c94b37"></rect>
        <rect x="4" y="6" width="1" height="1" fill="#c49a6a"></rect>`,
      arcade: `
        <rect x="3" y="1" width="10" height="14" fill="#1a0628"></rect>
        <rect x="4" y="1" width="8" height="2" fill="#ffd848"></rect>
        <rect x="5" y="4" width="6" height="4" fill="#44ddee"></rect>
        <rect x="7" y="5" width="2" height="1" fill="#ff44aa"></rect>
        <rect x="6" y="6" width="1" height="1" fill="#ff44aa"></rect>
        <rect x="9" y="6" width="1" height="1" fill="#ff44aa"></rect>
        <rect x="5" y="9" width="6" height="2" fill="#3d1958"></rect>
        <rect x="6" y="9" width="1" height="1" fill="#ffd848"></rect>
        <rect x="9" y="9" width="1" height="1" fill="#ff44aa"></rect>
        <rect x="4" y="12" width="8" height="2" fill="#3d1958"></rect>`,
      star: `
        <rect x="7" y="2" width="2" height="2" fill="#ffd848"></rect>
        <rect x="6" y="4" width="4" height="2" fill="#ffd848"></rect>
        <rect x="3" y="6" width="10" height="2" fill="#ffd848"></rect>
        <rect x="5" y="8" width="6" height="2" fill="#ffd848"></rect>
        <rect x="4" y="10" width="3" height="2" fill="#ffd848"></rect>
        <rect x="9" y="10" width="3" height="2" fill="#ffd848"></rect>
        <rect x="4" y="12" width="2" height="1" fill="#ff44aa"></rect>
        <rect x="10" y="12" width="2" height="1" fill="#ff44aa"></rect>`,
      banner: `
        <rect x="4" y="2" width="8" height="1" fill="#b7a677"></rect>
        <rect x="5" y="3" width="6" height="9" fill="#c94b37"></rect>
        <rect x="5" y="12" width="2" height="2" fill="#c94b37"></rect>
        <rect x="9" y="12" width="2" height="2" fill="#c94b37"></rect>
        <rect x="7" y="6" width="2" height="2" fill="#f4c542"></rect>
        <rect x="5" y="3" width="1" height="9" fill="#a83a2a"></rect>`,
      trophy: `
        <rect x="4" y="2" width="8" height="1" fill="#f4c542"></rect>
        <rect x="5" y="3" width="6" height="4" fill="#f4c542"></rect>
        <rect x="3" y="3" width="2" height="3" fill="#d8a63c"></rect>
        <rect x="11" y="3" width="2" height="3" fill="#d8a63c"></rect>
        <rect x="6" y="4" width="1" height="2" fill="#fff2c0"></rect>
        <rect x="7" y="7" width="2" height="3" fill="#d8a63c"></rect>
        <rect x="5" y="10" width="6" height="2" fill="#8a7e5a"></rect>
        <rect x="4" y="12" width="8" height="2" fill="#e8e2d0"></rect>`
    }, config.decorSvgs || {});

    function decorSvg(kind) {
      const body = DECOR_SVGS[kind];
      if (!body) return "";
      return `<svg class="decor-sprite" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
    }

    // Weighted decoration pick for one tile. Mutates meta. New-style rules
    // ({kinds: [{kind, p}]}) get SVG sprites; legacy {forest, hill} rules
    // keep the original pseudo-element art.
    function pickDecoration(meta, region, x, y) {
      // Keep the ground under landmark sprites clear of scattered props.
      if (landmarkTiles.has(`${x},${y}`)) {
        meta.classes.push("grass");
        return;
      }
      const rules = decorationRules[region ? region.id : "philosophy"] || {};
      const r = (hashXY(x, y) % 1000) / 1000;
      if (Array.isArray(rules.kinds)) {
        let acc = 0;
        for (const k of rules.kinds) {
          acc += k.p;
          if (r < acc) {
            meta.classes.push("grass", "decor", `decor-${k.kind}`);
            meta.decorKind = k.kind;
            return;
          }
        }
        meta.classes.push("grass");
        return;
      }
      const forest = rules.forest || 0;
      const hill = rules.hill || 0;
      if (r < forest) meta.classes.push("forest");
      else if (r < forest + hill) meta.classes.push("hill");
      else meta.classes.push("grass");
    }

    /* ------------------------------------------------------------------
       WALKABILITY — paths + articles + bridges
    ------------------------------------------------------------------ */

    const walkable = new Set();
    const pathTiles = new Set();

    function addWalkable(coord) {
      walkable.add(coord);
      pathTiles.add(coord);
    }

    function pave(aId, bId) {
      const a = articleById.get(aId);
      const b = articleById.get(bId);
      if (!a || !b) return;
      if (a.x === b.x) {
        const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
        for (let y = lo; y <= hi; y += 1) addWalkable(`${a.x},${y}`);
      } else if (a.y === b.y) {
        const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
        for (let x = lo; x <= hi; x += 1) addWalkable(`${x},${a.y}`);
      }
    }

    function paveCorridor([x0, y0, x1, y1]) {
      if (x0 === x1) {
        const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
        for (let y = lo; y <= hi; y += 1) addWalkable(`${x0},${y}`);
      } else if (y0 === y1) {
        const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
        for (let x = lo; x <= hi; x += 1) addWalkable(`${x},${y0}`);
      }
    }

    function buildWalkable() {
      articles.forEach((a) => {
        if (a.secret && !secretRevealed[a.secret]) return;
        addWalkable(`${a.x},${a.y}`);
      });
      connections.forEach(([a, b]) => pave(a, b));
      corridors.forEach(paveCorridor);
      bridgeSet.forEach((c) => walkable.add(c));

      // Any secret whose tiles are already revealed (from localStorage) gets
      // its path tiles added now.
      for (const id in SECRETS) {
        if (!secretRevealed[id]) continue;
        SECRETS[id].pathTiles.forEach((c) => {
          walkable.add(c);
          pathTiles.add(c);
        });
      }

      // Connect each bridge endpoint to the nearest article in the adjacent
      // region by laying a short path. We do this lightly — any walkable
      // tile already paved (above) is left alone. We extend bridges by 1
      // tile into each adjacent region so the cat can leave them.
      const adjacencyExtensions = config.adjacencyExtensions || [];
      adjacencyExtensions.forEach(([_, ext]) => addWalkable(ext));
    }

    /* ------------------------------------------------------------------
       COASTLINE (opt-in via config.coast) — bite deterministic chunks out
       of the region rectangles so the island reads as landmass, not
       spreadsheet. Purely visual: a tile is only ever eroded if nothing
       gameplay-relevant lives on it (no path, article, bridge or hidden
       secret). Land that faces water gets per-side "coast-*" classes so
       CSS can draw a sandy edge; water that touches land gets "shallow".
    ------------------------------------------------------------------ */

    const COAST = !!config.coast;
    const erodedSet = new Set();
    const coastSides = new Map(); // coord -> ["n","e","s","w"] facing water
    const shallowSet = new Set();

    function hash01(x, y, salt) {
      return (hashXY(x * 3 + salt * 7919 + 1, y * 5 + salt * 104729 + 2) % 1000) / 1000;
    }

    function coastProtected(coord) {
      return walkable.has(coord) || articleByCoord.has(coord) ||
        bridgeSet.has(coord) || hiddenTiles.has(coord) ||
        landmarkTiles.has(coord);
    }

    function computeCoast() {
      if (!COAST) return;

      // Water so far: outside every region rect, or already eroded.
      // The grid edge counts as land so the map border doesn't grow foam.
      const isWater = (x, y) => {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
        return !regionAt(x, y) || erodedSet.has(`${x},${y}`);
      };

      // Two erosion passes: a strong first bite on the rectangle edges,
      // then a gentler second pass on the newly exposed shoreline so the
      // coast meanders instead of just dithering one row.
      [0.38, 0.18].forEach((p, pass) => {
        const toErode = [];
        for (let y = 0; y < ROWS; y += 1) {
          for (let x = 0; x < COLS; x += 1) {
            const coord = `${x},${y}`;
            if (isWater(x, y) || !regionAt(x, y)) continue;
            if (coastProtected(coord)) continue;
            const sides = isWater(x, y - 1) + isWater(x, y + 1) +
              isWater(x + 1, y) + isWater(x - 1, y);
            if (!sides) continue;
            // Tiles cornered by water on 2+ sides erode more eagerly, which
            // rounds off the rectangle corners.
            const prob = sides >= 2 ? Math.min(0.85, p * 1.9) : p;
            if (hash01(x, y, pass) < prob) toErode.push(coord);
          }
        }
        toErode.forEach((c) => erodedSet.add(c));
      });

      // Cellular smoothing: raw erosion leaves single-tile staircase spikes
      // and notches that read as jagged squares, not coastline. Fill any
      // water bite hugged by land on 3+ sides; drown any land tile with
      // water on 3+ sides (never a protected tile). Two rounds settle it.
      for (let round = 0; round < 2; round += 1) {
        const fill = [], drown = [];
        for (let y = 0; y < ROWS; y += 1) {
          for (let x = 0; x < COLS; x += 1) {
            const coord = `${x},${y}`;
            if (!regionAt(x, y)) continue;
            const waterSides = isWater(x, y - 1) + isWater(x, y + 1) +
              isWater(x + 1, y) + isWater(x - 1, y);
            if (erodedSet.has(coord)) {
              if (waterSides <= 1) fill.push(coord);
            } else if (waterSides >= 3 && !coastProtected(coord)) {
              drown.push(coord);
            }
          }
        }
        if (!fill.length && !drown.length) break;
        fill.forEach((c) => erodedSet.delete(c));
        drown.forEach((c) => erodedSet.add(c));
      }

      // Classify the final shoreline.
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const coord = `${x},${y}`;
          if (isWater(x, y)) {
            if (!isWater(x, y - 1) || !isWater(x, y + 1) ||
                !isWater(x + 1, y) || !isWater(x - 1, y)) {
              shallowSet.add(coord);
            }
            continue;
          }
          if (!regionAt(x, y)) continue; // grid-edge overflow guard
          const sides = [];
          if (isWater(x, y - 1)) sides.push("n");
          if (isWater(x + 1, y)) sides.push("e");
          if (isWater(x, y + 1)) sides.push("s");
          if (isWater(x - 1, y)) sides.push("w");
          if (sides.length) coastSides.set(coord, sides);
        }
      }
    }

    /* ------------------------------------------------------------------
       LANDMARKS — big multi-tile decorative sprites (a castle, a great
       tree...) that float above the tile grid but under the avatar.
       config.landmarks: [{x, y, w, h, svg}] in tile units. Their
       footprints are protected from coast erosion and kept clear of
       scattered decorations so they always stand on solid ground.
    ------------------------------------------------------------------ */

    const LANDMARKS = config.landmarks || [];
    const landmarkTiles = new Set();
    LANDMARKS.forEach((lm) => {
      for (let dy = 0; dy < lm.h; dy += 1) {
        for (let dx = 0; dx < lm.w; dx += 1) {
          landmarkTiles.add(`${lm.x + dx},${lm.y + dy}`);
        }
      }
    });

    function buildLandmarks() {
      LANDMARKS.forEach((lm) => {
        const div = document.createElement("div");
        div.className = "landmark";
        div.style.left = `calc(var(--tile) * ${lm.x})`;
        div.style.top = `calc(var(--tile) * ${lm.y})`;
        div.style.width = `calc(var(--tile) * ${lm.w})`;
        div.style.height = `calc(var(--tile) * ${lm.h})`;
        div.setAttribute("aria-hidden", "true");
        div.innerHTML = lm.svg;
        dom.world.appendChild(div);
      });
    }

    // True where the map visually shows water (used for move() messaging).
    function isWaterVisual(x, y) {
      return !regionAt(x, y) || erodedSet.has(`${x},${y}`);
    }

    function pushCoastClasses(meta) {
      const sides = coastSides.get(meta.coord);
      if (sides) sides.forEach((s) => meta.classes.push(`coast-${s}`));
    }

    /* ------------------------------------------------------------------
       RENDERING
    ------------------------------------------------------------------ */

    function tileMeta(x, y) {
      const coord = `${x},${y}`;
      const region = regionAt(x, y);
      const meta = { region, coord, classes: ["tile"] };

      // Hidden secret tile? Render as decorative terrain so it blends in.
      if (hiddenTiles.has(coord)) {
        if (region) meta.classes.push(`region-${region.id}`);
        pickDecoration(meta, region, x, y);
        pushCoastClasses(meta);
        return meta;
      }

      const article = articleByCoord.get(coord);
      if (article) {
        meta.classes.push("article", article.kind);
        if (isArticleLocked(article)) meta.classes.push("locked");
        if (isCollectibleCollected(article)) meta.classes.push("collected");
        meta.article = article;
        if (region) meta.classes.push(`region-${region.id}`);
        pushCoastClasses(meta);
        return meta;
      }

      if (bridgeSet.has(coord)) {
        meta.classes.push("bridge");
        // Orient the planks by which way the bridge actually runs, read off the
        // walkable neighbours: an east-west (horizontal) bridge gets the
        // "vertical"-stripe pattern; a north-south bridge keeps the default.
        const horiz = walkable.has(`${x - 1},${y}`) || walkable.has(`${x + 1},${y}`);
        const vert = walkable.has(`${x},${y - 1}`) || walkable.has(`${x},${y + 1}`);
        if (horiz && !vert) meta.classes.push("vertical");
        return meta;
      }

      if (!region || erodedSet.has(coord)) {
        meta.classes.push("water");
        if (COAST && shallowSet.has(coord)) meta.classes.push("shallow");
        return meta;
      }

      // Inside a region: decide if this is a decoration or plain ground.
      meta.classes.push(`region-${region.id}`);

      if (pathTiles.has(coord)) {
        meta.classes.push("path");
        pushCoastClasses(meta);
        return meta;
      }

      pickDecoration(meta, region, x, y);
      pushCoastClasses(meta);
      return meta;
    }

    // One tile element from its meta — shared by buildMap and rebuildTile.
    function makeTileEl(meta, x, y) {
      const el = document.createElement(meta.article ? "button" : "div");
      el.className = meta.classes.join(" ");
      el.dataset.x = x;
      el.dataset.y = y;
      if (meta.article) {
        el.type = "button";
        el.setAttribute("aria-label", meta.article.title);
        el.innerHTML = `<span class="level-box">${meta.article.token}</span>`;
        // No tile-level click handler: the world-level click handler
        // converts every tap into a one-tile step toward the tap so
        // mobile users don't need a visible d-pad. Tap on cat's own
        // tile opens the article. Legend buttons still warp directly.
      } else if (meta.decorKind) {
        el.innerHTML = decorSvg(meta.decorKind);
      }
      return el;
    }

    function buildMap() {
      const grid = document.getElementById("map-grid");
      const frag = document.createDocumentFragment();
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          frag.appendChild(makeTileEl(tileMeta(x, y), x, y));
        }
      }
      grid.appendChild(frag);
    }

    function buildLegend() {
      const legend = document.getElementById("legend");
      legend.innerHTML = "";
      const byRegion = new Map();
      articles.forEach((a) => {
        if (a.secret && !secretRevealed[a.secret]) return;
        if (!byRegion.has(a.region)) byRegion.set(a.region, []);
        byRegion.get(a.region).push(a);
      });
      regions.forEach((r) => {
        const items = byRegion.get(r.id);
        if (!items || items.length === 0) return;
        const details = document.createElement("details");
        details.className = "legend-section";
        details.open = (r.id === "start");
        const summary = document.createElement("summary");
        summary.textContent = `${r.name} (${items.length})`;
        details.appendChild(summary);
        const itemsDiv = document.createElement("div");
        itemsDiv.className = "items";
        items.forEach((a) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = `${a.token} ${a.title}`;
          btn.addEventListener("click", () => {
            cat = { x: a.x, y: a.y };
            update(true);
          });
          itemsDiv.appendChild(btn);
        });
        details.appendChild(itemsDiv);
        legend.appendChild(details);
      });
    }

    function rebuildTile(x, y) {
      const old = document.querySelector(`.tile[data-x="${x}"][data-y="${y}"]`);
      if (!old) return;
      const el = makeTileEl(tileMeta(x, y), x, y);
      old.replaceWith(el);
      return el;
    }

    function revealSecret(id) {
      if (secretRevealed[id]) return false;
      const s = SECRETS[id];
      if (!s) return false;
      secretRevealed[id] = true;
      try { sessionStorage.setItem(s.storageKey, "true"); } catch (e) { /* ignore */ }

      const affected = [];
      s.pathTiles.forEach((c) => {
        hiddenTiles.delete(c);
        walkable.add(c);
        pathTiles.add(c);
        const [x, y] = c.split(",").map(Number);
        affected.push({ x, y });
      });
      const art = articleById.get(s.articleId);
      if (art) {
        hiddenTiles.delete(`${art.x},${art.y}`);
        walkable.add(`${art.x},${art.y}`);
        affected.push({ x: art.x, y: art.y });
      }

      affected.forEach(({ x, y }) => {
        const el = rebuildTile(x, y);
        if (!el) return;
        el.classList.add("just-revealed");
        window.setTimeout(() => el.classList.remove("just-revealed"), 700);
      });

      buildLegend();

      document.getElementById("status").textContent =
        `★ Secret found: "${art ? art.title : id}"`;

      return true;
    }

    /* ------------------------------------------------------------------
       INTERACTION
    ------------------------------------------------------------------ */

    let cat = { x: config.spawn.x, y: config.spawn.y };
    let facing = "right";
    let facingVector = { dx: 1, dy: 0 };
    let catFrontSprite = "";
    let swordSwingTimer = null;
    let swordSwingUntil = 0;

    function spriteEl() {
      return document.querySelector("#avatar .cat-sprite");
    }

    function rememberFrontSprite() {
      const sprite = spriteEl();
      if (sprite && !catFrontSprite) catFrontSprite = sprite.innerHTML;
    }

    function updateCatSprite() {
      const sprite = spriteEl();
      if (!sprite) return;
      rememberFrontSprite();
      const mode = facing === "up" ? "back" : "front";
      if (sprite.dataset.mode === mode) return;
      sprite.innerHTML = mode === "back" ? CAT_BACK_SVG : catFrontSprite;
      sprite.dataset.mode = mode;
    }

    function readHashCat() {
      const m = (window.location.hash || "").match(/cat=(\d+),(\d+)/);
      if (!m) return null;
      const x = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const coord = `${x},${y}`;
      // Arriving on a hidden secret tile — e.g. warping back from the Social
      // World onto its portal tile, which is still a secret until discovered.
      // Reveal it so the cat lands on the portal instead of the center spawn.
      if (!walkable.has(coord)) {
        const art = articleByCoord.get(coord);
        if (art && art.secret) revealSecret(art.secret);
      }
      if (!walkable.has(coord)) return null;
      return { x, y };
    }

    function writeHashCat() {
      const next = `#cat=${cat.x},${cat.y}`;
      if (window.location.hash !== next) {
        history.replaceState(null, "", next);
      }
    }

    function articleAtCat() {
      return articleByCoord.get(`${cat.x},${cat.y}`) || null;
    }

    // requiresFlags: ["some-localStorage-key", ...] — every named flag must
    // read "true" before the article unlocks. Flags are written by other
    // worlds (dungeon clears, the Social World quest), which is what lets
    // one locked door span the whole multi-world adventure.
    function flagsSatisfied(a) {
      if (!a || !a.requiresFlags) return true;
      return a.requiresFlags.every((key) => {
        try { return localStorage.getItem(key) === "true"; }
        catch (e) { return false; }
      });
    }

    function isArticleLocked(a) {
      if (!a) return false;
      if (a.requiresGremlinClear && !gremlinsCleared) return true;
      return !flagsSatisfied(a);
    }

    function canMove(x, y) {
      return x >= 0 && x < COLS && y >= 0 && y < ROWS && walkable.has(`${x},${y}`);
    }

    function move(dx, dy) {
      // Check for a Zelda-style secret reveal at the cat's current position.
      // If a trigger matches, the secret unlocks before the canMove check —
      // so the just-revealed tile is now walkable and the move can proceed.
      for (const id in SECRETS) {
        if (secretRevealed[id]) continue;
        const t = SECRETS[id].trigger;
        if (t.x === cat.x && t.y === cat.y && t.dx === dx && t.dy === dy) {
          revealSecret(id);
        }
      }

      const next = { x: cat.x + dx, y: cat.y + dy };
      if (!canMove(next.x, next.y)) {
        setStatus(isWaterVisual(next.x, next.y)
          ? "That way is water. Find a bridge."
          : "No path that way. Try another direction.");
        // A short shake gives the bumped move tactile feedback.
        const avatar = dom.avatar;
        if (avatar) {
          avatar.classList.remove("bump");
          void avatar.offsetWidth;
          avatar.classList.add("bump");
          window.setTimeout(() => avatar.classList.remove("bump"), 220);
        }
        return;
      }
      if (dx < 0) facing = "left";
      else if (dx > 0) facing = "right";
      else if (dy < 0) facing = "up";
      else if (dy > 0) facing = "down";
      facingVector = { dx, dy };
      cat = next;
      update(true);
      checkCatch();
    }

    function isExternalUrl(url) {
      return /^https?:\/\//i.test(url) || /\.pdf$/i.test(url);
    }

    // Caves behave exactly like portals (step in, warp to another world) but
    // carry their own "cave" CSS class so they can look like a dark opening.
    function isPortalKind(a) {
      return !!a && (a.kind === "portal" || a.kind === "cave");
    }

    function resolveUrl(url) {
      return /^https?:\/\//i.test(url) ? url : pageBase + url;
    }

    function openCurrent() {
      const a = articleAtCat();
      if (!a) return;

      if (isArticleLocked(a)) {
        const message = a.lockedStatus ||
          "You have to clear the enemies here before this article opens.";
        document.getElementById("status").textContent = message;
        document.getElementById("summary").textContent = a.lockedSummary || message;
        return;
      }

      markVisited(a.id);

      if (a.collectible) {
        const newlyCollected = grantItem(a.collectible);
        const label = itemLabel(a.collectible);
        // update() first — its collectible branch writes the ambient status,
        // and the take/coronation message must land on top of it, not under.
        update(true);
        setStatus(newlyCollected
          ? (a.collectStatus || `${label} found.`)
          : `You already have the ${label.toLowerCase()}.`);
        if (newlyCollected && a.celebrate) {
          emitSparkles(document.getElementById("avatar"), 26);
        }
        return;
      }

      if (a.dialogue && !a.url) {
        document.getElementById("status").textContent = a.dialogue;
        document.getElementById("summary").textContent = a.dialogue;
        return;
      }

      if (!a.url) return;

      const href = resolveUrl(a.url);
      if (isPortalKind(a)) {
        warpOutTo(href);
      } else if (isExternalUrl(a.url)) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = href;
      }
    }

    /* ------------------------------------------------------------------
       WORLD-WARP ANIMATION — stepping into a portal launches the cat up
       and off the top of the screen with a sparkle burst, then navigates.
       The destination world reads a sessionStorage flag on boot and drops
       the cat back down from above with another sparkle burst.
    ------------------------------------------------------------------ */

    const WARP_FLAG = "worldWarp";
    let warpInFlight = false;

    function emitSparkles(host, count) {
      for (let i = 0; i < count; i += 1) {
        const s = document.createElement("span");
        s.className = "sparkle";
        const ang = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 46;
        s.style.setProperty("--sx", `${Math.cos(ang) * dist}px`);
        // bias the burst upward so it trails the cat's launch
        s.style.setProperty("--sy", `${Math.sin(ang) * dist - 26}px`);
        s.style.animationDelay = `${Math.random() * 0.18}s`;
        s.textContent = Math.random() < 0.5 ? "✦" : "✧";
        host.appendChild(s);
        window.setTimeout(() => s.remove(), 950);
      }
    }

    function warpOutTo(href) {
      if (warpInFlight) return;
      warpInFlight = true;
      const avatar = document.getElementById("avatar");
      const sprite = avatar.querySelector(".cat-sprite");
      avatar.classList.remove("face-left", "face-up", "face-down", "step");
      avatar.classList.add("warping");
      sprite.classList.remove("warp-drop");
      // force reflow so re-adding the launch class restarts the animation
      void sprite.offsetWidth;
      sprite.classList.add("warp-launch");
      emitSparkles(avatar, 16);
      document.getElementById("status").textContent = "Warping…";
      try { sessionStorage.setItem(WARP_FLAG, "1"); } catch (e) { /* ignore */ }
      window.setTimeout(() => { window.location.href = href; }, 560);
    }

    function playWarpIn() {
      let warping = false;
      try {
        warping = sessionStorage.getItem(WARP_FLAG) === "1";
        if (warping) sessionStorage.removeItem(WARP_FLAG);
      } catch (e) { /* ignore */ }
      if (!warping) return;
      const avatar = document.getElementById("avatar");
      const sprite = avatar.querySelector(".cat-sprite");
      avatar.classList.add("warping");
      sprite.classList.add("warp-drop");
      window.setTimeout(() => emitSparkles(avatar, 18), 360);
      window.setTimeout(() => {
        sprite.classList.remove("warp-drop");
        avatar.classList.remove("warping");
      }, 720);
    }

    function currentTileSize() {
      return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 48;
    }

    function swordTarget() {
      return {
        x: cat.x + facingVector.dx,
        y: cat.y + facingVector.dy
      };
    }

    function swordHitsGremlin(g) {
      if (!g || Date.now() > swordSwingUntil) return false;
      const target = swordTarget();
      return g.x === target.x && g.y === target.y;
    }

    function clearSwordSwingClasses(avatar) {
      avatar.classList.remove(
        "sword-swing",
        "sword-left",
        "sword-right",
        "sword-up",
        "sword-down"
      );
    }

    function hitSwordTargets() {
      let hits = 0;
      for (const g of [...gremlins]) {
        if (swordHitsGremlin(g) && defeatGremlin(g)) hits += 1;
      }
      return hits;
    }

    function swingSword() {
      if (!hasItem("sword")) {
        document.getElementById("status").textContent = "Find the sword first.";
        return;
      }
      if (warpInFlight) return;

      const avatar = document.getElementById("avatar");
      if (!avatar) return;
      if (swordSwingTimer) window.clearTimeout(swordSwingTimer);

      clearSwordSwingClasses(avatar);
      void avatar.offsetWidth;
      swordSwingUntil = Date.now() + 190;
      avatar.classList.add("sword-swing", `sword-${facing}`);

      const hits = hitSwordTargets();
      if (hits === 0) document.getElementById("status").textContent = "Sword slash.";

      swordSwingTimer = window.setTimeout(() => {
        swordSwingUntil = 0;
        clearSwordSwingClasses(avatar);
        swordSwingTimer = null;
      }, 210);
    }

    let cameraInitialized = false;
    let camAnim = null;
    const prefersReducedMotion = !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function centerCamera(instant = false) {
      const viewport = document.getElementById("viewport");
      const t = currentTileSize();
      const targetX = Math.max(0, cat.x * t + t / 2 - viewport.clientWidth / 2);
      const targetY = Math.max(0, cat.y * t + t / 2 - viewport.clientHeight / 2);

      // Cancel any camera tween already running. Without this, a second move
      // before the first scroll finished would start a competing animation;
      // the two fighting over scrollLeft/scrollTop is exactly the "skipping
      // around" Safari shows. We drive the scroll ourselves (rAF) rather than
      // scrollTo({behavior:"smooth"}) so it's deterministic on every browser,
      // and the .viewport opts out of the site-wide `scroll-behavior: smooth`.
      if (camAnim !== null) {
        window.cancelAnimationFrame(camAnim);
        camAnim = null;
      }

      if (instant || prefersReducedMotion) {
        viewport.scrollLeft = targetX;
        viewport.scrollTop = targetY;
        return;
      }

      const startX = viewport.scrollLeft;
      const startY = viewport.scrollTop;
      const dx = targetX - startX;
      const dy = targetY - startY;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        viewport.scrollLeft = targetX;
        viewport.scrollTop = targetY;
        return;
      }

      const duration = 160;
      const startTime = performance.now();
      function stepFrame(now) {
        const p = Math.min(1, (now - startTime) / duration);
        const ease = p * (2 - p); // easeOutQuad
        viewport.scrollLeft = startX + dx * ease;
        viewport.scrollTop = startY + dy * ease;
        if (p < 1) {
          camAnim = window.requestAnimationFrame(stepFrame);
        } else {
          camAnim = null;
        }
      }
      camAnim = window.requestAnimationFrame(stepFrame);
    }

    function update(stepped = false) {
      const avatar = dom.avatar;
      const t = currentTileSize();
      avatar.style.transform = `translate(${cat.x * t}px, ${cat.y * t}px)`;
      avatar.classList.toggle("face-left", facing === "left");
      avatar.classList.toggle("face-up", facing === "up");
      avatar.classList.toggle("face-down", facing === "down");
      updateCatSprite();
      updateItemUI();
      if (stepped) {
        avatar.classList.remove("step");
        window.requestAnimationFrame(() => {
          avatar.classList.add("step");
          window.setTimeout(() => avatar.classList.remove("step"), 160);
        });
      }

      document.querySelectorAll(".tile.article").forEach((el) => {
        const art = articleByCoord.get(`${el.dataset.x},${el.dataset.y}`);
        el.classList.toggle("current",
          Number(el.dataset.x) === cat.x && Number(el.dataset.y) === cat.y);
        el.classList.toggle("locked", isArticleLocked(art));
        el.classList.toggle("collected", isCollectibleCollected(art));
      });

      const a = articleAtCat();
      const reg = regionAt(cat.x, cat.y);
      const onBridge = bridgeSet.has(`${cat.x},${cat.y}`);
      const openLink = dom.openLink;
      const floatOpen = dom.floatOpen;

      if (reg) {
        dom.regionChip.textContent = reg.name;
      } else if (onBridge) {
        dom.regionChip.textContent = "Bridge";
      } else {
        dom.regionChip.textContent = "—";
      }
      dom.location.textContent = `Cat: ${reg ? reg.name : "Bridge"} (${cat.x}, ${cat.y})`;

      // Mobile title bar — always reflects current location; tappable when
      // standing on an article.
      if (a) {
        const locked = isArticleLocked(a);
        const collected = isCollectibleCollected(a);
        dom.titleBar.classList.add("on-article");
        dom.mtbRegion.textContent = reg ? reg.name : "";
        dom.mtbTitle.textContent = a.title;
        dom.mtbAction.textContent = locked ? "Locked"
          : a.collectible ? (collected ? "Taken" : "Take")
          : a.dialogue && !a.url ? "Talk"
          : isExternalUrl(a.url) ? "Open ↗" : "Open ›";
        dom.mtbDate.textContent = a.date;
        dom.mtbSummary.textContent = locked ? (a.lockedSummary || a.summary) : a.summary;
      } else {
        dom.titleBar.classList.remove("on-article");
        dom.mtbRegion.textContent = onBridge ? "Bridge" : reg ? reg.name : "";
        dom.mtbTitle.textContent = onBridge ? "Crossing between regions"
          : reg ? "Walking the path" : "Out of bounds";
        dom.mtbAction.textContent = "";
        dom.mtbDate.textContent = "";
        dom.mtbSummary.textContent = "";
      }

      if (a) {
        const locked = isArticleLocked(a);
        const collected = isCollectibleCollected(a);
        dom.kind.textContent =
          a.kindLabel ? a.kindLabel
          : a.kind === "castle" ? "Castle essay"
          : a.kind === "house" ? "House essay"
          : a.kind === "sword" ? "Item"
          : a.kind === "npc" ? "Cave elder"
          : "Article tile";
        dom.title.textContent = a.title;
        dom.date.textContent = a.date;
        setSummary(locked ? (a.lockedSummary || a.summary) : a.summary);
        const external = a.url ? isExternalUrl(a.url) : false;
        const resolved = a.url ? resolveUrl(a.url) : "#";
        openLink.href = resolved;
        floatOpen.href = resolved;

        if (locked) {
          openLink.removeAttribute("target");
          openLink.removeAttribute("rel");
          openLink.textContent = "Locked";
          openLink.classList.add("disabled");
          floatOpen.classList.remove("visible");
          setStatus(a.lockedStatus ||
            "You have to clear the enemies here before this article opens.");
        } else if (a.collectible) {
          const label = itemLabel(a.collectible);
          openLink.removeAttribute("target");
          openLink.removeAttribute("rel");
          openLink.textContent = collected ? `${label} taken` : `Take ${label.toLowerCase()}`;
          openLink.classList.toggle("disabled", collected);
          floatOpen.classList.toggle("visible", !collected);
          floatOpen.removeAttribute("target");
          floatOpen.removeAttribute("rel");
          floatOpen.textContent = "Take";
          setStatus(collected
            ? (a.haveStatus || `The ${label.toLowerCase()} is yours.`)
            : (a.takeStatus || `Press Enter to take the ${label.toLowerCase()}.`));
        } else if (a.dialogue && !a.url) {
          openLink.removeAttribute("target");
          openLink.removeAttribute("rel");
          openLink.textContent = "Talk";
          openLink.classList.remove("disabled");
          floatOpen.removeAttribute("target");
          floatOpen.removeAttribute("rel");
          floatOpen.textContent = "Talk";
          floatOpen.classList.add("visible");
          setStatus(a.dialogue);
        } else if (external) {
          floatOpen.classList.add("visible");
          openLink.target = "_blank";
          openLink.rel = "noopener noreferrer";
          openLink.textContent = "Open in new tab ↗";
          floatOpen.target = "_blank";
          floatOpen.rel = "noopener noreferrer";
          floatOpen.textContent = "Open ↗";
          setStatus("External link — opens in a new tab.");
        } else {
          floatOpen.classList.add("visible");
          openLink.removeAttribute("target");
          openLink.removeAttribute("rel");
          openLink.textContent = "Open article";
          floatOpen.removeAttribute("target");
          floatOpen.removeAttribute("rel");
          floatOpen.textContent = "Open";
          setStatus("Press Enter to open. Back button returns here.");
        }
        if (!locked && !(a.collectible && collected)) openLink.classList.remove("disabled");
      } else if (onBridge) {
        dom.kind.textContent = "Bridge";
        dom.title.textContent = "Crossing between regions";
        dom.date.textContent = "Keep walking";
        setSummary("Bridges connect themed regions. Keep going to enter the next section of the site.");
        setStatus("Halfway there.");
        openLink.href = "#";
        openLink.classList.add("disabled");
        floatOpen.classList.remove("visible");
      } else if (reg) {
        dom.kind.textContent = reg.name;
        dom.title.textContent = reg.name;
        dom.date.textContent = "Region path";
        setSummary("Connective tissue between tiles in this region. Step onto a numbered box to inspect an article.");
        setStatus("Find an article tile.");
        openLink.href = "#";
        openLink.classList.add("disabled");
        floatOpen.classList.remove("visible");
      } else {
        dom.kind.textContent = "Open water";
        dom.title.textContent = "Out of bounds";
        dom.date.textContent = "";
        setSummary("Backtrack to a bridge to keep exploring.");
        setStatus("No tile here.");
        openLink.href = "#";
        openLink.classList.add("disabled");
        floatOpen.classList.remove("visible");
      }

      centerCamera(!cameraInitialized);
      cameraInitialized = true;
      writeHashCat();
    }

    /* ------------------------------------------------------------------
       INPUT
    ------------------------------------------------------------------ */

    window.addEventListener("keydown", (event) => {
      // While the how-to-play overlay is open, swallow game keys and let
      // Enter/Space/Escape dismiss it rather than moving the hidden cat.
      if (introEl && !introEl.hidden) {
        if (event.key === "Escape" || event.key === "Enter" ||
            event.key === " " || event.code === "Space") {
          event.preventDefault();
          hideIntro();
        }
        return;
      }
      if (event.target && event.target.tagName === "BUTTON" && event.key === "Enter") {
        // let the button take Enter normally
        return;
      }
      if (event.key === "ArrowUp")    { event.preventDefault(); move(0, -1); }
      else if (event.key === "ArrowDown")  { event.preventDefault(); move(0, 1); }
      else if (event.key === "ArrowLeft")  { event.preventDefault(); move(-1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); move(1, 0); }
      else if (event.key === " " || event.code === "Space") { event.preventDefault(); swingSword(); }
      else if (event.key === "Enter") { event.preventDefault(); openCurrent(); }
    });

    document.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("click", () => {
        const [dx, dy] = button.dataset.move.split(",").map(Number);
        move(dx, dy);
        document.getElementById("world").focus();
      });
    });

    /* The "Open" link and the floating Open FAB are plain anchors. When the
       cat is standing on a portal, intercept the click so it plays the warp
       animation (via openCurrent) instead of navigating instantly. */
    ["open-link", "float-open"].forEach((id) => {
      document.getElementById(id).addEventListener("click", (e) => {
        const a = articleAtCat();
        if (a && (isPortalKind(a) || isArticleLocked(a) ||
            a.collectible || (a.dialogue && !a.url) || !a.url)) {
          e.preventDefault();
          openCurrent();
        }
      });
    });

    /* Universal click handler: any tap/click on the map steps the cat one
       tile toward the tap. Tap on the cat's own tile opens the article.
       This is what mobile users use in lieu of a visible d-pad. */
    document.getElementById("world").addEventListener("click", (e) => {
      const worldEl = e.currentTarget;
      worldEl.focus();
      const rect = worldEl.getBoundingClientRect();
      const t = currentTileSize();
      const tileX = Math.floor((e.clientX - rect.left) / t);
      const tileY = Math.floor((e.clientY - rect.top) / t);
      const dx = tileX - cat.x;
      const dy = tileY - cat.y;
      if (dx === 0 && dy === 0) {
        openCurrent();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) {
        move(dx > 0 ? 1 : -1, 0);
      } else {
        move(0, dy > 0 ? 1 : -1);
      }
    });

    /* Tapping the mobile title bar opens the article (when standing on one). */
    document.getElementById("mobile-title-bar").addEventListener("click", () => {
      if (articleAtCat()) openCurrent();
    });

    /* ---- touch: swipe-to-move ----
       Short swipe (>= 30px in <= 600ms) steps the cat one tile in that
       cardinal direction. Longer drags fall through to native pan-to-scroll
       on the viewport. Tap (small movement) still warps via the tile's
       click handler. */
    (() => {
      const SWIPE_MIN = 30;
      const SWIPE_MAX_TIME = 600;
      let touchStart = null;
      const worldEl = document.getElementById("world");
      worldEl.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) { touchStart = null; return; }
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
      }, { passive: true });
      worldEl.addEventListener("touchcancel", () => { touchStart = null; });
      worldEl.addEventListener("touchend", (e) => {
        if (!touchStart) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        const dt = Date.now() - touchStart.time;
        touchStart = null;
        if (Math.hypot(dx, dy) < SWIPE_MIN || dt > SWIPE_MAX_TIME) return;
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
        else move(0, dy > 0 ? 1 : -1);
        // Suppress the click that would otherwise warp the cat to wherever
        // the swipe ended.
        e.preventDefault();
      });
    })();

    /* ------------------------------------------------------------------
       GREMLINS — three random-walking antagonists
    ------------------------------------------------------------------ */

    const _g = config.gremlins || {};
    const NUM_GREMLINS = (_g.count != null) ? _g.count : 3;
    const GREMLIN_INTERVAL_MS = (_g.intervalMs != null) ? _g.intervalMs : 3000;
    const GREMLIN_STAGGER_MS = (_g.staggerMs != null) ? _g.staggerMs : 1000;
    const GREMLIN_SVG = _g.svg || DEFAULT_GREMLIN_SVG;
    // Optional: in dungeon-style worlds, a gremlin catch sends the cat to one
    // fixed url (e.g. booted back out to the overworld) instead of warping it
    // to a random article from this world. Left null in normal worlds.
    const CAUGHT_URL = _g.caughtUrl || null;
    // Optional: spawn gremlins on any open floor tile rather than on article
    // tiles. Useful for sparse "open room" worlds (a dungeon with few tiles)
    // where article-only spawns would cluster them. Off by default.
    const SPAWN_ANYWHERE = !!_g.spawnAnywhere;
    const GREMLIN_MIN_SPAWN_DIST =
      (_g.minSpawnDistance != null) ? _g.minSpawnDistance : 12;
    const GREMLIN_KILL_ITEM = _g.killItem === false ? null : (_g.killItem || "sword");
    const GREMLIN_CLEARED_KEY = _g.clearedKey || null;
    const GREMLIN_CLEARED_STATUS = _g.clearedStatus ||
      (GREMLIN_CLEARED_KEY ? "The purple gremlins are gone. The shrine is open."
        : "The gremlins are gone.");
    let gremlinsCleared = false;
    try {
      gremlinsCleared = !!(GREMLIN_CLEARED_KEY &&
        localStorage.getItem(GREMLIN_CLEARED_KEY) === "true");
    } catch (e) { /* ignore */ }

    // The speedster is opt-in per world: supply config.gremlins.speedster to
    // enable a rare, faster gremlin that warps to one fixed target.
    const _spd = _g.speedster || null;
    const HAS_SPEEDSTER = !!_spd;
    const FAST_GREMLIN_INTERVAL_MS = (_spd && _spd.intervalMs) || (GREMLIN_INTERVAL_MS / 2);
    const FAST_TARGET_URL = _spd ? _spd.targetUrl : null;
    const FAST_GREMLIN_SVG = _spd ? _spd.svg : null;
    const FAST_CAUGHT_KEY = (_spd && _spd.caughtKey) || "tylersworld-speedster-caught";
    let speedsterCaught = false;
    try { speedsterCaught = localStorage.getItem(FAST_CAUGHT_KEY) === "true"; }
    catch (e) { /* ignore */ }

    let gremlins = [];
    let gremlinTimers = [];
    let caughtInFlight = false;

    function clearGremlinTimers(g) {
      if (!g) return;
      if (g.startTimer) window.clearTimeout(g.startTimer);
      if (g.timer) window.clearInterval(g.timer);
      g.startTimer = null;
      g.timer = null;
    }

    function markGremlinsCleared() {
      if (gremlinsCleared) return;
      gremlinsCleared = true;
      try {
        if (GREMLIN_CLEARED_KEY) localStorage.setItem(GREMLIN_CLEARED_KEY, "true");
      } catch (e) { /* ignore */ }
      update(false);
      document.getElementById("status").textContent = GREMLIN_CLEARED_STATUS;
    }

    function defeatGremlin(g) {
      if (!g || !GREMLIN_KILL_ITEM || !hasItem(GREMLIN_KILL_ITEM)) return false;
      clearGremlinTimers(g);
      gremlins = gremlins.filter((x) => x !== g);
      if (g.fast) {
        speedsterCaught = true;
        try { localStorage.setItem(FAST_CAUGHT_KEY, "true"); } catch (e) { /* ignore */ }
      }
      g.el.classList.add("defeated");
      emitSparkles(g.el, 8);
      window.setTimeout(() => g.el.remove(), 220);

      if (gremlins.length === 0) {
        markGremlinsCleared();
      } else {
        document.getElementById("status").textContent =
          `Sword hit. ${gremlins.length} gremlins left.`;
      }
      return true;
    }

    // Reset transient state on every page show, including bfcache restores
    // after the user clicks back from a caught-and-warped article. Without
    // this, caughtInFlight stays true and silently blocks all later catches.
    window.addEventListener("pageshow", () => {
      caughtInFlight = false;
    });

    function randomFrom(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    function spawnCandidates() {
      if (SPAWN_ANYWHERE) {
        const floor = [...walkable]
          .filter((coord) => !hiddenTiles.has(coord))
          .filter((coord) => !articleByCoord.has(coord))
          .map((coord) => {
            const [x, y] = coord.split(",").map(Number);
            return { x, y };
          });
        if (floor.length > 0) return floor;

        return [...walkable].map((coord) => {
          const [x, y] = coord.split(",").map(Number);
          return { x, y };
        });
      }

      // Only pick from articles that are actually reachable right now -
      // hidden secret tiles aren't walkable until revealed, and a gremlin
      // spawned on one would have no walkable neighbors and freeze.
      return articles
        .filter((a) => !a.secret || secretRevealed[a.secret])
        .map((a) => ({ x: a.x, y: a.y }));
    }

    function pickSpawnFarFromCat(occupied = new Set()) {
      // Uniform random over all eligible spawn points far enough from the cat.
      // Earlier "farthest of N samples" logic biased toward corners with the
      // most articles, which made gremlins cluster in AI Cyberzone. Dungeons
      // can opt into floor spawns so they don't stack on the exit/shrine tiles.
      const candidates = spawnCandidates()
        .filter((p) => !occupied.has(`${p.x},${p.y}`))
        .filter((p) => !(p.x === cat.x && p.y === cat.y));

      const far = candidates.filter((p) =>
        Math.abs(p.x - cat.x) + Math.abs(p.y - cat.y) >= GREMLIN_MIN_SPAWN_DIST);

      const pool = far.length ? far : candidates;
      if (pool.length > 0) return randomFrom(pool);

      return { x: config.spawn.x, y: config.spawn.y };
    }

    function makeGremlinEl(svg, extraClass) {
      const div = document.createElement("div");
      div.className = extraClass ? `gremlin ${extraClass}` : "gremlin";
      div.setAttribute("aria-hidden", "true");
      div.innerHTML = svg || GREMLIN_SVG;
      return div;
    }

    function renderGremlin(g, stepped) {
      const t = currentTileSize();
      g.el.style.transform = `translate(${g.x * t}px, ${g.y * t}px)`;
      if (stepped) {
        g.el.classList.remove("step");
        window.requestAnimationFrame(() => {
          g.el.classList.add("step");
          window.setTimeout(() => g.el.classList.remove("step"), 340);
        });
      }
    }

    function clearGremlins() {
      gremlinTimers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      gremlinTimers = [];
      gremlins.forEach(clearGremlinTimers);
      gremlins.forEach((g) => g.el.remove());
      gremlins = [];
    }

    function spawnGremlins() {
      clearGremlins();
      if (gremlinsCleared) return;
      const worldEl = document.getElementById("world");
      const occupied = new Set();
      for (let i = 0; i < NUM_GREMLINS; i += 1) {
        const el = makeGremlinEl();
        worldEl.appendChild(el);
        const pos = pickSpawnFarFromCat(occupied);
        occupied.add(`${pos.x},${pos.y}`);
        const g = { x: pos.x, y: pos.y, prev: null, el, interval: GREMLIN_INTERVAL_MS };
        gremlins.push(g);
        renderGremlin(g, false);
      }
      // The speedster: ticks twice as fast and warps to one specific article.
      // Once it has caught the cat, it's retired for good and an ordinary green
      // gremlin takes its place, so the total count is unchanged.
      if (HAS_SPEEDSTER) {
        const fast = !speedsterCaught;
        const el = fast ? makeGremlinEl(FAST_GREMLIN_SVG, "fast") : makeGremlinEl();
        worldEl.appendChild(el);
        const pos = pickSpawnFarFromCat(occupied);
        occupied.add(`${pos.x},${pos.y}`);
        const g = {
          x: pos.x, y: pos.y, prev: null, el,
          interval: fast ? FAST_GREMLIN_INTERVAL_MS : GREMLIN_INTERVAL_MS,
          fast
        };
        gremlins.push(g);
        renderGremlin(g, false);
      }
      // Stagger initial ticks so they don't move in lockstep, then run each on
      // its own interval (the speedster's is shorter than the rest).
      gremlins.forEach((g, i) => {
        const initial = window.setTimeout(() => {
          if (!gremlins.includes(g)) return;
          gremlinTick(g);
          const interval = window.setInterval(() => {
            if (!gremlins.includes(g)) return;
            gremlinTick(g);
          }, g.interval);
          g.timer = interval;
          gremlinTimers.push(interval);
        }, g.interval + i * GREMLIN_STAGGER_MS);
        g.startTimer = initial;
        gremlinTimers.push(initial);
      });
    }

    function gremlinTick(g) {
      if (!gremlins.includes(g) || gremlinsCleared) return;
      // Hold gremlins still while the how-to-play overlay is up, so a first
      // time visitor reading it never gets caught and warped away.
      if (introEl && !introEl.hidden) return;
      const candidates = [];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = g.x + dx, ny = g.y + dy;
        if (!walkable.has(`${nx},${ny}`)) continue;
        if (g.prev && nx === g.prev.x && ny === g.prev.y) continue;
        candidates.push({ x: nx, y: ny });
      }
      let pick;
      if (candidates.length > 0) {
        pick = candidates[Math.floor(Math.random() * candidates.length)];
      } else if (g.prev && walkable.has(`${g.prev.x},${g.prev.y}`)) {
        pick = g.prev;
      } else {
        // Stuck on an unreachable tile (e.g. spawned on a hidden secret
        // before the secret data was filtered out). Teleport this gremlin
        // to a known-good spawn point instead of freezing forever.
        const pos = pickSpawnFarFromCat();
        g.x = pos.x;
        g.y = pos.y;
        g.prev = null;
        renderGremlin(g, false);
        return;
      }
      g.prev = { x: g.x, y: g.y };
      g.x = pick.x;
      g.y = pick.y;
      renderGremlin(g, true);
      if (swordHitsGremlin(g) && defeatGremlin(g)) return;
      if (g.x === cat.x && g.y === cat.y) caught(g);
    }

    function checkCatch() {
      for (const g of gremlins) {
        if (g.x === cat.x && g.y === cat.y) { caught(g); return; }
      }
    }

    function caught(by) {
      // Guard against double-firing if the cat lands on a gremlin during
      // a frame where another gremlin is also ticking onto it.
      if (caughtInFlight) return;
      caughtInFlight = true;

      const flash = document.getElementById("catch-flash");
      flash.classList.add("active");
      window.setTimeout(() => flash.classList.remove("active"), 280);

      // Persist the catch position to the URL so back-button returns the
      // cat exactly here. (update() already wrote this on the cat's last
      // move; doing it again is harmless and explicit.)
      writeHashCat();

      // Dungeon-style worlds: a normal gremlin catch boots the cat to one fixed
      // url instead of warping to a random article. (The speedster, if any,
      // still uses its own target below.)
      if (CAUGHT_URL && !(by && by.fast)) {
        document.getElementById("status").textContent =
          "A gremlin got you! Back out you go…";
        spawnGremlins();
        window.setTimeout(() => { window.location.href = resolveUrl(CAUGHT_URL); }, 320);
        return;
      }

      // The speedster warps to one fixed article; a normal gremlin warps to a
      // random one. The cat stays put either way.
      const a = (by && by.fast)
        ? (articles.find((x) => x.url === FAST_TARGET_URL)
           || warpPool[Math.floor(Math.random() * warpPool.length)])
        : warpPool[Math.floor(Math.random() * warpPool.length)];
      const href = resolveUrl(a.url);

      markVisited(a.id);
      document.getElementById("status").textContent = (by && by.fast)
        ? `The fast one got you! "${a.title}"...`
        : `Caught! Opening "${a.title}"...`;

      // The speedster is a one-time encounter: retire it before respawning so
      // it never appears again (a green gremlin takes its slot).
      if (by && by.fast) {
        speedsterCaught = true;
        try { localStorage.setItem(FAST_CAUGHT_KEY, "true"); } catch (e) { /* ignore */ }
      }

      // Respawn all gremlins far from the cat for when the user returns.
      spawnGremlins();

      if (isExternalUrl(a.url)) {
        // New tab — cat is still here, the game keeps running.
        window.open(href, "_blank", "noopener,noreferrer");
        // Clear the in-flight guard after the flash so subsequent catches
        // can still fire.
        window.setTimeout(() => { caughtInFlight = false; }, 400);
      } else {
        // Same tab — give the flash time to register, then navigate.
        window.setTimeout(() => { window.location.href = href; }, 320);
      }
    }

    /* ------------------------------------------------------------------
       ONBOARDING OVERLAY — a first-visit "how to play" dialog, driven by
       config.intro. A "? Help" chip in the HUD reopens it any time; the
       dismissal is remembered in localStorage so returning visitors aren't
       interrupted. Worlds that don't pass config.intro get neither.
    ------------------------------------------------------------------ */

    const INTRO = config.intro || null;
    let introEl = null;

    function introSeen() {
      if (!INTRO || !INTRO.storageKey) return false;
      try { return localStorage.getItem(INTRO.storageKey) === "true"; }
      catch (e) { return false; }
    }

    function buildHelpButton() {
      if (!INTRO || !dom.hud) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hud-chip help-chip";
      btn.id = "help-chip";
      btn.setAttribute("aria-label", "How to play");
      btn.textContent = "? Help";
      btn.addEventListener("click", () => showIntro(true));
      dom.hud.appendChild(btn);
    }

    function buildIntro() {
      if (!INTRO) return;
      const controlsHtml = (INTRO.controls || []).map((c) =>
        `<li><span class="intro-keys">${c.keys}</span><span class="intro-act">${c.action}</span></li>`
      ).join("");
      const tipsHtml = (INTRO.tips || []).map((tip) => `<li>${tip}</li>`).join("");

      const overlay = document.createElement("div");
      overlay.className = "intro-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", INTRO.title || "How to play");
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="intro-card">
          <h2 class="intro-title">${INTRO.title || "How to play"}</h2>
          ${INTRO.tagline ? `<p class="intro-tagline">${INTRO.tagline}</p>` : ""}
          ${controlsHtml ? `<ul class="intro-controls">${controlsHtml}</ul>` : ""}
          ${tipsHtml ? `<p class="intro-subhead">Good to know</p><ul class="intro-tips">${tipsHtml}</ul>` : ""}
          <button type="button" class="intro-start">${INTRO.button || "Start exploring"}</button>
        </div>`;
      document.body.appendChild(overlay);
      introEl = overlay;

      overlay.querySelector(".intro-start").addEventListener("click", hideIntro);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) hideIntro(); });
    }

    function showIntro(force) {
      if (!introEl) return;
      if (!force && introSeen()) return;
      introEl.hidden = false;
      const start = introEl.querySelector(".intro-start");
      if (start) start.focus();
    }

    function hideIntro() {
      if (!introEl || introEl.hidden) return;
      introEl.hidden = true;
      if (INTRO && INTRO.storageKey) {
        try { localStorage.setItem(INTRO.storageKey, "true"); } catch (e) { /* ignore */ }
      }
      if (dom.world) dom.world.focus();
    }

    /* ------------------------------------------------------------------
       BOOT
    ------------------------------------------------------------------ */

    loadVisited();
    loadSecretsFromStorage();
    buildWalkable();
    computeCoast();
    if (COAST && dom.world) dom.world.classList.add("has-coast");
    buildMap();
    buildLandmarks();
    buildLegend();
    buildHelpButton();
    buildIntro();
    updateVisitedUI();

    const restored = readHashCat();
    if (restored) cat = restored;

    const avatarEl = document.getElementById("avatar");
    avatarEl.insertAdjacentHTML("beforeend", CROWN_SVG);
    avatarEl.classList.add("no-transition");
    update();
    spawnGremlins();
    window.requestAnimationFrame(() => {
      // Re-center now that layout has settled — viewport dimensions are
      // unreliable during the synchronous boot.
      cameraInitialized = false;
      centerCamera(true);
      cameraInitialized = true;
      avatarEl.getBoundingClientRect();
      avatarEl.classList.remove("no-transition");
      gremlins.forEach((g) => renderGremlin(g, false));
      // If we arrived here through a portal, drop the cat in from above.
      playWarpIn();
    });
    document.getElementById("world").focus();

    // First-time visitors see the how-to-play overlay; returning visitors
    // (and anyone who has dismissed it once) go straight to the map.
    showIntro(false);
}
