/* ------------------------------------------------------------------
   Tyler's World — shared overworld engine.

   createWorld(config) builds one playable overworld inside the page's
   existing DOM skeleton (#world, #map-grid, #avatar, #legend, the HUD
   chips, the mobile title bar, etc.). Both game_mode.html (the main
   site map) and social_world.html (the LinkedIn-posts portal world)
   call this with their own config so a single engine drives both.

   config fields:
     cols, rows            grid size
     pageBase              prefix for internal urls ("" for same dir)
     spawn                 {x, y} starting tile for the cat
     regions               [{id, name, x0, y0, x1, y1}]
     articles              [{id, region, x, y, kind, token, title, date,
                             url, summary, secret?, kindLabel?}]
     connections           [[aId, bId], ...] straight paths to pave
     bridges               ["x,y", ...] walkable tiles spanning gaps
     corridors             [[x0,y0,x1,y1], ...] extra axis-aligned paths
     adjacencyExtensions   [[bridgeTile, extTile], ...]
     decorationRules       {regionId: {forest, hill}}
     secrets               {id: {trigger, pathTiles, articleId, storageKey}}
     visitedKey            localStorage key for visited tracking
     gremlins              {count, intervalMs, staggerMs, svg,
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
    "use strict";

    const COLS = config.cols;
    const ROWS = config.rows;
    const pageBase = config.pageBase || "";

    document.documentElement.style.setProperty("--cols", COLS);
    document.documentElement.style.setProperty("--rows", ROWS);

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
       RENDERING
    ------------------------------------------------------------------ */

    function tileMeta(x, y) {
      const coord = `${x},${y}`;
      const region = regionAt(x, y);
      const meta = { region, coord, classes: ["tile"] };

      // Hidden secret tile? Render as decorative terrain so it blends in.
      if (hiddenTiles.has(coord)) {
        if (region) meta.classes.push(`region-${region.id}`);
        const h = hashXY(x, y);
        const rules = decorationRules[region ? region.id : "philosophy"] || { forest: 0, hill: 0 };
        const r = (h % 1000) / 1000;
        if (r < rules.forest) meta.classes.push("forest");
        else if (r < rules.forest + rules.hill) meta.classes.push("hill");
        else meta.classes.push("grass");
        return meta;
      }

      const article = articleByCoord.get(coord);
      if (article) {
        meta.classes.push("article", article.kind);
        meta.article = article;
        if (region) meta.classes.push(`region-${region.id}`);
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

      if (!region) {
        meta.classes.push("water");
        return meta;
      }

      // Inside a region: decide if this is a decoration or plain ground.
      meta.classes.push(`region-${region.id}`);

      if (pathTiles.has(coord)) {
        meta.classes.push("path");
        return meta;
      }

      const h = hashXY(x, y);
      const rules = decorationRules[region.id] || { forest: 0, hill: 0 };
      const r = (h % 1000) / 1000;
      if (r < rules.forest) {
        meta.classes.push("forest");
      } else if (r < rules.forest + rules.hill) {
        meta.classes.push("hill");
      } else {
        meta.classes.push("grass");
      }
      return meta;
    }

    function buildMap() {
      const grid = document.getElementById("map-grid");
      const frag = document.createDocumentFragment();
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          const meta = tileMeta(x, y);
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
          }
          frag.appendChild(el);
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
      const meta = tileMeta(x, y);
      const el = document.createElement(meta.article ? "button" : "div");
      el.className = meta.classes.join(" ");
      el.dataset.x = x;
      el.dataset.y = y;
      if (meta.article) {
        el.type = "button";
        el.setAttribute("aria-label", meta.article.title);
        el.innerHTML = `<span class="level-box">${meta.article.token}</span>`;
      }
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

    function readHashCat() {
      const m = (window.location.hash || "").match(/cat=(\d+),(\d+)/);
      if (!m) return null;
      const x = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (!walkable.has(`${x},${y}`)) return null;
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
        const s = document.getElementById("status");
        const reg = regionAt(next.x, next.y);
        if (reg) {
          s.textContent = "No path that way. Try another direction.";
        } else {
          s.textContent = "That way is water. Find a bridge.";
        }
        return;
      }
      if (dx < 0) facing = "left";
      if (dx > 0) facing = "right";
      cat = next;
      update(true);
      checkCatch();
    }

    function isExternalUrl(url) {
      return /^https?:\/\//i.test(url) || /\.pdf$/i.test(url);
    }

    function resolveUrl(url) {
      return /^https?:\/\//i.test(url) ? url : pageBase + url;
    }

    function openCurrent() {
      const a = articleAtCat();
      if (!a) return;
      markVisited(a.id);
      const href = resolveUrl(a.url);
      if (a.kind === "portal") {
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
      avatar.classList.remove("face-left", "step");
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
      sprite.classList.add("warp-drop");
      window.setTimeout(() => emitSparkles(avatar, 18), 360);
      window.setTimeout(() => sprite.classList.remove("warp-drop"), 720);
    }

    function currentTileSize() {
      return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 48;
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
      const avatar = document.getElementById("avatar");
      const t = currentTileSize();
      avatar.style.transform = `translate(${cat.x * t}px, ${cat.y * t}px)`;
      avatar.classList.toggle("face-left", facing === "left");
      if (stepped) {
        avatar.classList.remove("step");
        window.requestAnimationFrame(() => {
          avatar.classList.add("step");
          window.setTimeout(() => avatar.classList.remove("step"), 160);
        });
      }

      document.querySelectorAll(".tile.article").forEach((el) => {
        el.classList.toggle("current",
          Number(el.dataset.x) === cat.x && Number(el.dataset.y) === cat.y);
      });

      const a = articleAtCat();
      const reg = regionAt(cat.x, cat.y);
      const openLink = document.getElementById("open-link");
      const floatOpen = document.getElementById("float-open");
      const regionChip = document.getElementById("region-chip");
      const loc = document.getElementById("location");
      const titleBar = document.getElementById("mobile-title-bar");
      const mtbRegion = document.getElementById("mtb-region");
      const mtbTitle = document.getElementById("mtb-title");
      const mtbAction = document.getElementById("mtb-action");

      if (reg) {
        regionChip.textContent = reg.name;
      } else if (bridgeSet.has(`${cat.x},${cat.y}`)) {
        regionChip.textContent = "Bridge";
      } else {
        regionChip.textContent = "—";
      }
      loc.textContent = `Cat: ${reg ? reg.name : "Bridge"} (${cat.x}, ${cat.y})`;

      // Mobile title bar — always reflects current location; tappable when
      // standing on an article.
      const mtbDate = document.getElementById("mtb-date");
      const mtbSummary = document.getElementById("mtb-summary");
      if (a) {
        titleBar.classList.add("on-article");
        mtbRegion.textContent = reg ? reg.name : "";
        mtbTitle.textContent = a.title;
        mtbAction.textContent = isExternalUrl(a.url) ? "Open ↗" : "Open ›";
        mtbDate.textContent = a.date;
        mtbSummary.textContent = a.summary;
      } else if (bridgeSet.has(`${cat.x},${cat.y}`)) {
        titleBar.classList.remove("on-article");
        mtbRegion.textContent = "Bridge";
        mtbTitle.textContent = "Crossing between regions";
        mtbAction.textContent = "";
        mtbDate.textContent = "";
        mtbSummary.textContent = "";
      } else if (reg) {
        titleBar.classList.remove("on-article");
        mtbRegion.textContent = reg.name;
        mtbTitle.textContent = "Walking the path";
        mtbAction.textContent = "";
        mtbDate.textContent = "";
        mtbSummary.textContent = "";
      } else {
        titleBar.classList.remove("on-article");
        mtbRegion.textContent = "";
        mtbTitle.textContent = "Out of bounds";
        mtbAction.textContent = "";
        mtbDate.textContent = "";
        mtbSummary.textContent = "";
      }

      if (a) {
        document.getElementById("kind").textContent =
          a.kindLabel ? a.kindLabel
          : a.kind === "castle" ? "Castle essay"
          : a.kind === "house" ? "House essay"
          : "Article tile";
        document.getElementById("title").textContent = a.title;
        document.getElementById("date").textContent = a.date;
        document.getElementById("summary").textContent = a.summary;
        const external = isExternalUrl(a.url);
        const resolved = resolveUrl(a.url);
        openLink.href = resolved;
        floatOpen.href = resolved;
        floatOpen.classList.add("visible");
        if (external) {
          openLink.target = "_blank";
          openLink.rel = "noopener noreferrer";
          openLink.textContent = "Open in new tab ↗";
          floatOpen.target = "_blank";
          floatOpen.rel = "noopener noreferrer";
          floatOpen.textContent = "Open ↗";
          document.getElementById("status").textContent = "External link — opens in a new tab.";
        } else {
          openLink.removeAttribute("target");
          openLink.removeAttribute("rel");
          openLink.textContent = "Open article";
          floatOpen.removeAttribute("target");
          floatOpen.removeAttribute("rel");
          floatOpen.textContent = "Open";
          document.getElementById("status").textContent = "Press Enter to open. Back button returns here.";
        }
        openLink.classList.remove("disabled");
      } else if (bridgeSet.has(`${cat.x},${cat.y}`)) {
        document.getElementById("kind").textContent = "Bridge";
        document.getElementById("title").textContent = "Crossing between regions";
        document.getElementById("date").textContent = "Keep walking";
        document.getElementById("summary").textContent =
          "Bridges connect themed regions. Keep going to enter the next section of the site.";
        document.getElementById("status").textContent = "Halfway there.";
        openLink.href = "#";
        openLink.classList.add("disabled");
        floatOpen.classList.remove("visible");
      } else if (reg) {
        document.getElementById("kind").textContent = reg.name;
        document.getElementById("title").textContent = reg.name;
        document.getElementById("date").textContent = "Region path";
        document.getElementById("summary").textContent =
          "Connective tissue between tiles in this region. Step onto a numbered box to inspect an article.";
        document.getElementById("status").textContent = "Find an article tile.";
        openLink.href = "#";
        openLink.classList.add("disabled");
        floatOpen.classList.remove("visible");
      } else {
        document.getElementById("kind").textContent = "Open water";
        document.getElementById("title").textContent = "Out of bounds";
        document.getElementById("date").textContent = "";
        document.getElementById("summary").textContent =
          "Backtrack to a bridge to keep exploring.";
        document.getElementById("status").textContent = "No tile here.";
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
      if (event.target && event.target.tagName === "BUTTON" && event.key === "Enter") {
        // let the button take Enter normally
        return;
      }
      if (event.key === "ArrowUp")    { event.preventDefault(); move(0, -1); }
      else if (event.key === "ArrowDown")  { event.preventDefault(); move(0, 1); }
      else if (event.key === "ArrowLeft")  { event.preventDefault(); move(-1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); move(1, 0); }
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
        if (a && a.kind === "portal") {
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

    // Reset transient state on every page show, including bfcache restores
    // after the user clicks back from a caught-and-warped article. Without
    // this, caughtInFlight stays true and silently blocks all later catches.
    window.addEventListener("pageshow", () => {
      caughtInFlight = false;
    });

    function pickSpawnFarFromCat() {
      // Only pick from articles that are actually reachable right now —
      // hidden secret tiles aren't walkable until revealed, and a gremlin
      // spawned on one would have no walkable neighbors and freeze.
      const candidates = articles.filter((a) => !a.secret || secretRevealed[a.secret]);
      // Uniform random over all articles at least MIN_DIST tiles from cat.
      // (Earlier "farthest of N samples" approach biased toward corners with
      // the most articles, which made all gremlins cluster in AI Cyberzone.)
      const MIN_DIST = 12;
      for (let i = 0; i < 40; i += 1) {
        const a = candidates[Math.floor(Math.random() * candidates.length)];
        const d = Math.abs(a.x - cat.x) + Math.abs(a.y - cat.y);
        if (d >= MIN_DIST) return { x: a.x, y: a.y };
      }
      // Fallback if the map is unusually small: any random article.
      const a = candidates[Math.floor(Math.random() * candidates.length)];
      return { x: a.x, y: a.y };
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
      gremlins.forEach((g) => g.el.remove());
      gremlins = [];
    }

    function spawnGremlins() {
      clearGremlins();
      const worldEl = document.getElementById("world");
      for (let i = 0; i < NUM_GREMLINS; i += 1) {
        const el = makeGremlinEl();
        worldEl.appendChild(el);
        const pos = pickSpawnFarFromCat();
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
        const pos = pickSpawnFarFromCat();
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
          gremlinTick(g);
          const interval = window.setInterval(() => gremlinTick(g), g.interval);
          gremlinTimers.push(interval);
        }, g.interval + i * GREMLIN_STAGGER_MS);
        gremlinTimers.push(initial);
      });
    }

    function gremlinTick(g) {
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
       BOOT
    ------------------------------------------------------------------ */

    loadVisited();
    loadSecretsFromStorage();
    buildWalkable();
    buildMap();
    buildLegend();
    updateVisitedUI();

    const restored = readHashCat();
    if (restored) cat = restored;

    const avatarEl = document.getElementById("avatar");
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
}
