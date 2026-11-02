// Who Prints Your Gold? — page logic.
// Everything the reader does is kept in `state`, so the receipt at the end can print it.

(() => {
  document.documentElement.classList.add("js");
  // A reload starts a new login (every gate closed again), so it should start at the top too.
  history.scrollRestoration = "manual";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const START_GOLD = 1000000;
  const SWORD_START_PRICE = 100;

  const state = {
    gold: 0,
    collected: false,
    swordPrice: SWORD_START_PRICE,
    crisisChoice: null,
    tradeLocked: false,
    vote: null,
    dailies: null,
    dailiesGold: 0,
    ending: null,
    pricesInUsd: false,
    revealed: false,
    yourTurn: null,
    phase: "game",
  };

  // ---------- pouch ----------

  const pouch = {
    el: $("pouch"),
    amount: $("pouch-amount"),
    sub: $("pouch-sub"),
    show() { this.el.hidden = false; },
    setGold(n) {
      state.gold = n;
      this.amount.textContent = fmt(n);
    },
    setSub(text) { this.sub.textContent = text; },
    // Redraw the sub line and the $ line from the ledger.
    draw() {
      this.setSub(isLocked() ? "locked · can't trade" : `buys ${fmt(swordsNow())} swords`);
      const line = $("pouch-usd");
      if (!line.hidden) line.textContent = state.pricesInUsd ? `≈ ${usd(pouchWorth())}` : "$ ???";
    },
    // A short note under the pouch: who just changed it, and how.
    say(who, text) {
      const log = $("pouch-log");
      const tag = document.createElement("b");
      tag.className = `who-tag ${who}`;
      tag.textContent = WHO[who];
      log.replaceChildren(tag, ` ${text}`);
      log.classList.remove("show");
      void log.offsetWidth;
      log.classList.add("show");
    },
    bump() {
      if (reducedMotion) return;
      this.el.classList.remove("bump");
      void this.el.offsetWidth;
      this.el.classList.add("bump");
    },
    hint() {
      if (reducedMotion) return;
      this.el.classList.remove("hint");
      void this.el.offsetWidth;
      this.el.classList.add("hint");
    },
    lock(on) {
      this.el.classList.toggle("locked", on);
      this.draw();
      this.bump();
    },
    countTo(target, ms) {
      if (reducedMotion) { this.setGold(target); return Promise.resolve(); }
      const from = state.gold;
      const t0 = performance.now();
      return new Promise((resolve) => {
        const frame = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const eased = 1 - Math.pow(1 - p, 3);
          this.setGold(from + (target - from) * eased);
          if (p < 1) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
    },
  };

  const swordsFor = (price) => Math.floor(START_GOLD / price);

  // ---------- the ledger ----------
  // Every change to the pouch is written down with who made it. The pouch, the receipt and the last
  // chapter all read from here. `value` multiplies what each coin is worth; `locked` freezes it at zero.

  const WHO = { studio: "STUDIO", director: "YOU, AS THE STUDIO", players: "PLAYERS" };
  const ledger = new Map();
  const ledgerGold = (entries = [...ledger.values()]) => entries.reduce((n, e) => n + e.gold, 0);
  const ledgerValue = (entries = [...ledger.values()]) => entries.reduce((n, e) => n * e.value, 1);
  // What the pouch is worth in day-0 gold: a sword at 100 gold, a Bond at 9.6 million.
  const worthOf = (entries) => (entries.some((e) => e.locked) && !entries.some((e) => e.unlocks) ? 0 : ledgerGold(entries) * ledgerValue(entries));
  const pouchWorth = () => worthOf([...ledger.values()]);
  const isLocked = () => pouchWorth() === 0 && ledgerGold() > 0;
  const swordsNow = () => Math.floor(pouchWorth() / SWORD_START_PRICE);
  const pct = (value) => `value ${value >= 1 ? "+" : "−"}${Math.abs(Math.round((value - 1) * 100))}%`;

  function record(key, entry, note) {
    ledger.set(key, { gold: 0, value: 1, ...entry });
    pouch.draw();
    if (note) { pouch.say(entry.who, note); pouch.bump(); }
  }

  // ---------- reveal on scroll ----------
  // A screen with data-on-reveal runs that action the first time it comes into view.

  const onReveal = {
    pouch: () => pouch.hint(),
    rate: () => runRate(),
    usd: () => showUsd(),
    receipt: () => setPhase("receipt"),
    print: () => printReceipt(),
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealObserver.unobserve(e.target);
        const action = onReveal[e.target.dataset.onReveal];
        if (action) action();
      }
    });
  }, { threshold: 0.2 });
  document.querySelectorAll(".screen").forEach((s) => revealObserver.observe(s));

  // ---------- map (table of contents) ----------
  // One entry per chapter head (data-toc-chapter), with the chapter's marked screens (data-toc) under it.

  const tocEl = $("toc");
  const tocList = $("toc-list");
  const tocLinks = [];

  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function tocLink(section, label, num) {
    if (!section.id) section.id = `s-${slug(label)}`;
    const a = document.createElement("a");
    a.href = `#${section.id}`;
    if (num !== undefined) {
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = num;
      a.appendChild(n);
    }
    a.append(label);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.classList.contains("locked")) return;
      section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      closeToc();
    });
    tocLinks.push({ section, a });
    return a;
  }

  document.querySelectorAll("main section[data-toc-chapter]").forEach((head, i) => {
    const station = head.dataset.station;
    const li = document.createElement("li");
    li.dataset.station = station;
    li.appendChild(tocLink(head, head.dataset.tocChapter, i === 0 ? "·" : String(i)));
    const screens = document.querySelectorAll(`main section[data-toc][data-station="${station}"]`);
    if (screens.length) {
      const ol = document.createElement("ol");
      screens.forEach((s) => {
        const sub = document.createElement("li");
        sub.appendChild(tocLink(s, s.dataset.toc));
        ol.appendChild(sub);
      });
      li.appendChild(ol);
    }
    tocList.appendChild(li);
  });

  const chapterItems = [...tocList.children];

  // Called with the screen the reader is on: lights its chapter and its own entry, locks what's still hidden.
  function updateToc(current) {
    tocLinks.forEach(({ section, a }) => {
      const locked = section.offsetParent === null;
      a.classList.toggle("locked", locked);
      a.setAttribute("aria-disabled", String(locked));
      a.tabIndex = locked ? -1 : 0;
      a.classList.toggle("current", section === current);
    });
    const here = chapterItems.findIndex((li) => li.dataset.station === current?.dataset.station);
    chapterItems.forEach((li, i) => {
      li.classList.toggle("here", i === here);
      li.classList.toggle("done", here > -1 && i < here);
    });
    if (here > -1) $("toc-current").textContent = chapterItems[here].firstChild.lastChild.textContent;
  }

  function closeToc() {
    tocEl.classList.remove("open");
    $("toc-toggle").setAttribute("aria-expanded", "false");
  }

  $("toc-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = tocEl.classList.toggle("open");
    $("toc-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (tocEl.classList.contains("open") && !tocEl.contains(e.target)) closeToc();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeToc(); });

  // ---------- pager: back / next ----------
  // Scrolling still works; the buttons (and ← →) jump one screen at a time.
  // Hidden screens are skipped, so NEXT stops at COLLECT until the reader collects.

  const pager = { prev: $("prev"), next: $("next"), count: $("page-count") };

  const visibleScreens = () => [...document.querySelectorAll("main .screen")].filter((s) => s.offsetParent !== null);

  function currentScreen(screens) {
    const mid = window.innerHeight / 2;
    return Math.max(0, screens.findLastIndex((s) => s.getBoundingClientRect().top <= mid));
  }

  function updatePager() {
    const screens = visibleScreens();
    const i = currentScreen(screens);
    pager.count.textContent = `${i + 1} / ${screens.length}`;
    pager.prev.disabled = i === 0;
    pager.next.disabled = i === screens.length - 1;
    updateToc(screens[i]);
    // Safari won't scroll inside a snap area taller than the window, so snapping pauses on tall screens
    // (the sources, an opened note, the sim on a phone) and comes back on the next normal one.
    document.documentElement.classList.toggle("free-scroll", screens[i].offsetHeight > window.innerHeight + 2);
  }

  function go(step) {
    const screens = visibleScreens();
    const target = screens[currentScreen(screens) + step];
    if (target) target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  pager.prev.addEventListener("click", () => go(-1));
  pager.next.addEventListener("click", () => go(1));
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  });

  let pagerQueued = false;
  window.addEventListener("scroll", () => {
    if (pagerQueued) return;
    pagerQueued = true;
    requestAnimationFrame(() => { pagerQueued = false; updatePager(); });
  }, { passive: true });
  window.addEventListener("resize", updatePager);
  document.addEventListener("toggle", updatePager, true);
  updatePager();

  // ---------- prologue: collect ----------

  function flyCoins(fromEl, toEl, count) {
    if (reducedMotion) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x0 = a.left + a.width / 2;
    const y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2;
    const y1 = b.top + b.height / 2;
    for (let i = 0; i < count; i++) {
      const coin = document.createElement("span");
      coin.className = "coin";
      coin.style.left = `${x0 - 7}px`;
      coin.style.top = `${y0 - 7}px`;
      document.body.appendChild(coin);
      const spread = (Math.random() - 0.5) * 160;
      const anim = coin.animate([
        { transform: "translate(0, 0) scale(1)" },
        { transform: `translate(${spread}px, ${-60 - Math.random() * 80}px) scale(1.2)`, offset: 0.35 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(.6)`, opacity: 0.6 },
      ], { duration: 800 + Math.random() * 300, delay: i * 45, easing: "cubic-bezier(.5,0,.6,1)", fill: "forwards" });
      anim.onfinish = () => coin.remove();
    }
  }

  async function collect(animated) {
    if (state.collected) return;
    state.collected = true;
    $("collect").disabled = true;
    $("collect-skip").hidden = true;
    pouch.show();
    record("login", { who: "studio", k: "Collected on login", gold: START_GOLD, text: "printed out of nothing" }, `printed +${fmt(START_GOLD)}`);
    state.gold = 0;
    pouch.setGold(0);
    document.body.classList.add("collected");
    if (animated) {
      flyCoins($("collect"), pouch.el, 16);
      await pouch.countTo(START_GOLD, 1300);
    } else {
      pouch.setGold(START_GOLD);
    }
    pouch.bump();
    $("collect").textContent = "COLLECTED";
    $("after-collect").hidden = false;
    updatePager();
  }

  $("collect").addEventListener("click", () => collect(true));
  $("collect-skip").addEventListener("click", () => collect(false));

  // ---------- chapter 1: run the server ----------
  // Price follows the gold in circulation. Taps pour gold in (more players join every day, so taps
  // get stronger over time); drains remove a share of what's in circulation. Day 10 adds a gold-copy
  // bug, day 20 makes drains weaker because players hoard. Holding 80–120 is possible, but only by
  // cutting drops or raising costs, and players leave when you do.

  const sim = {
    days: 30,
    tickMs: 900,
    money: SWORD_START_PRICE,
    day: 0,
    players: 1000,
    hoarding: false,
    history: [SWORD_START_PRICE],
    timer: null,
    done: false,
  };

  const simEls = {
    day: $("sim-day"),
    price: $("sim-price"),
    band: $("sim-band"),
    line: $("sim-line"),
    events: $("sim-events"),
    tap: $("sim-tap"),
    drain: $("sim-drain"),
    chat: $("sim-chat"),
    start: $("sim-start"),
    skip: $("sim-skip"),
  };

  const complaints = {
    stingy: [["Player42", "drops are so stingy"], ["afk_fisher", "killed 50 wolves, got nothing"], ["Player42", "this grind isn't worth it"]],
    repairs: [["ironman_btw", "repairs cost a fortune now"], ["tank_main", "half my loot goes on repairs"]],
    expensive: [["xX_sword_Xx", "why is everything so expensive?"], ["Lumby_Larry", "prices doubled since I logged off"], ["mage4life", "can't afford anything any more"]],
    cheap: [["gp_hoarder", "my loot sells for nothing"], ["merchant_mo", "can't make a profit on anything"]],
    quit: [["SYSTEM", "a player has logged out for good"]],
  };

  let lastLine = "";
  function complain(kind) {
    const options = complaints[kind].filter(([, text]) => text !== lastLine);
    const pick = options[Math.floor(Math.random() * options.length)] || complaints[kind][0];
    lastLine = pick[1];
    say(pick);
  }

  function say([who, text], box = simEls.chat, keep = 3) {
    const line = document.createElement("div");
    const name = document.createElement("span");
    name.className = "who";
    name.textContent = `${who}: `;
    line.append(name, text);
    const quiet = box.querySelector(".muted");
    if (quiet) quiet.remove();
    box.appendChild(line);
    while (box.children.length > keep) box.firstElementChild.remove();
  }

  function simEvent(text) {
    const tag = document.createElement("span");
    tag.className = "event";
    tag.textContent = text;
    simEls.events.appendChild(tag);
  }

  function drawChart(band = simEls.band, line = simEls.line) {
    const yMax = Math.max(500, Math.max(...sim.history) * 1.1);
    const y = (p) => 150 - (p / yMax) * 150;
    band.setAttribute("y", y(120));
    band.setAttribute("height", y(80) - y(120));
    const points = sim.history.map((p, i) => `${(i / sim.days) * 300},${y(p)}`).join(" ");
    line.setAttribute("points", points);
  }

  function simLabels() {
    const price = Math.round(sim.money);
    simEls.day.textContent = `DAY ${sim.day} / ${sim.days}`;
    simEls.price.textContent = `SWORD: ${fmt(price)} gold`;
    simEls.price.classList.toggle("bad", price < 80 || price > 120);
  }

  function simStep() {
    sim.day += 1;
    const tap = Number(simEls.tap.value);
    const drain = Number(simEls.drain.value);
    const growth = 1 + 0.05 * sim.day;
    const inflow = 0.2 * tap * growth;
    const outflow = 0.002 * drain * sim.money * (sim.hoarding ? 0.6 : 1);
    sim.money = Math.max(5, sim.money + inflow - outflow);

    if (sim.day === 10) {
      sim.money += 200;
      simEvent("Day 10 · A bug lets players copy gold.");
    }
    if (sim.day === 20) {
      sim.hoarding = true;
      simEvent("Day 20 · Players are hoarding. Drains bite less.");
    }

    const price = Math.round(sim.money);
    const unhappy = [];
    if (tap < 35) unhappy.push("stingy");
    if (drain > 70) unhappy.push("repairs");
    if (price > 120) unhappy.push("expensive");
    if (price < 80) unhappy.push("cheap");

    if (tap < 35 || drain > 70) {
      sim.players = Math.round(sim.players * 0.97);
      if (sim.day % 4 === 0) complain("quit");
    }
    if (unhappy.length && sim.day % 2 === 1) {
      complain(unhappy[Math.floor(Math.random() * unhappy.length)]);
    }

    sim.history.push(price);
    drawChart();
    simLabels();
    if (sim.day >= sim.days) simFinish();
  }

  function simStart() {
    if (sim.timer || sim.done) return;
    simEls.start.disabled = true;
    simEls.start.textContent = "[ RUNNING… ]";
    sim.timer = setInterval(simStep, sim.tickMs);
  }

  function simResultText(price) {
    const lost = 1000 - sim.players;
    if (price > 120) {
      return `Day 30. A sword now costs ${fmt(price)} gold. Your pouch still says 1,000,000. It just buys a lot less than it did.`;
    }
    if (price < 80) {
      return `Day 30. A sword costs only ${fmt(price)} gold. Your pouch buys more than ever, but nobody's loot is worth farming any more.${lost ? ` ${fmt(lost)} players have quit.` : ""}`;
    }
    if (lost > 0) {
      return `Day 30. A sword costs ${fmt(price)} gold. You held the line. It cost you ${fmt(lost)} players, who decided the drops were too stingy or the repairs too expensive.`;
    }
    return `Day 30. A sword costs ${fmt(price)} gold, and nobody quit. Real studios hire economists to do what you just did.`;
  }

  function simFinish(presetPrice) {
    clearInterval(sim.timer);
    sim.timer = null;
    sim.done = true;
    const price = presetPrice ?? Math.round(sim.money);
    state.swordPrice = price;

    simEls.tap.disabled = true;
    simEls.drain.disabled = true;
    simEls.start.disabled = true;
    simEls.start.textContent = "[ DAY 30 ]";
    simEls.skip.hidden = true;

    const value = SWORD_START_PRICE / price;
    record("mint", { who: "director", k: "The Mint", value, text: `you ran the server: sword ${SWORD_START_PRICE} → ${fmt(price)} gold` },
      Math.abs(value - 1) < 0.005 ? "prices held · value unchanged" : `a sword costs ${fmt(price)} · ${pct(value)}`);

    $("sim-result-text").textContent = simResultText(price);
    $("after-sim").hidden = false;
    updatePager();
    $("sim-result").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    fillReport(price);
  }

  // The report card: a verdict, three numbers that count up, and the price line again.

  function countUp(el, from, to, ms) {
    if (reducedMotion) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function fillReport(price) {
    const lost = 1000 - sim.players;
    const inBand = price >= 80 && price <= 120;
    const swords = swordsFor(price);
    const change = Math.round((price / SWORD_START_PRICE - 1) * 100);

    const verdict = $("rep-verdict");
    verdict.textContent = price > 120 ? "Inflation."
      : price < 80 ? "Deflation."
      : lost > 0 ? "Prices held. Players didn't."
      : "Stable.";
    verdict.classList.toggle("bad", !inBand || lost > 0);

    $("rep-price-d").textContent = change === 0 ? "gold · same as day 0" : `gold · ${change > 0 ? "+" : ""}${change}% since day 0`;
    $("rep-price-box").classList.toggle("bad", !inBand);
    $("rep-players-d").textContent = lost > 0 ? `${fmt(lost)} quit` : "nobody quit";
    $("rep-players-box").classList.toggle("bad", lost > 0);
    $("rep-swords-box").classList.toggle("bad", swords < 10000 * 0.8);

    drawChart($("rep-band"), $("rep-line"));
    setTimeout(() => {
      countUp($("rep-price"), SWORD_START_PRICE, price, 1400);
      countUp($("rep-players"), 1000, sim.players, 1400);
      countUp($("rep-swords"), 10000, swords, 1400);
      pouch.hint();
    }, reducedMotion ? 0 : 600);
  }

  simEls.start.addEventListener("click", simStart);
  simEls.skip.addEventListener("click", () => {
    if (sim.done) return;
    sim.history = [100, 100, 104, 110, 118, 126, 135, 146, 158, 170, 184, 390, 360, 335, 318, 305, 298, 296, 297, 300, 305, 330, 352, 372, 390, 405, 418, 430, 440, 450, 460];
    sim.day = 30;
    drawChart();
    sim.money = 460;
    simLabels();
    simFinish(460);
  });
  drawChart();

  // ---------- chapter 1: Ultima Online exchange rate ----------
  // 200 gold per dollar, then a coin worth ~100 times less: the board climbs to 20,000.

  function runRate() {
    const box = $("uo-rate");
    const num = $("uo-rate-num");
    const finish = () => {
      num.textContent = "20,000";
      $("uo-rate-note").textContent = "later: each coin worth ~100× less";
      box.classList.add("fell");
    };
    if (reducedMotion) { finish(); return; }
    setTimeout(() => {
      const t0 = performance.now();
      const ms = 2200;
      const frame = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        num.textContent = fmt(200 * Math.pow(100, p));
        if (p < 1) requestAnimationFrame(frame); else finish();
      };
      requestAnimationFrame(frame);
    }, 1200);
  }

  // ---------- gates and the fade ----------
  // A gate is a hidden wrapper around everything after an interaction; opening it lets the reader on.

  function openGate(id) {
    $(id).hidden = false;
    updatePager();
  }

  // Fade to black, run `swap` while the screen is dark, land on `target`, fade back in.
  function fadeTo(target, swap) {
    const land = () => window.scrollTo({ top: target.offsetTop, behavior: "instant" });
    if (reducedMotion) { swap(); land(); return; }
    const cover = $("fade-cover");
    cover.classList.add("on");
    setTimeout(() => {
      swap();
      land();
      cover.classList.remove("on");
    }, 750);
  }

  const pause = (ms) => (reducedMotion ? 0 : ms);

  // ---------- chapter 2: the dailies ----------
  // Sixteen clicks of work and twelve of energy: the list can't be finished today without the refill.
  // The refill is pretend; the note after it says so.

  const ENERGY = 12;
  const DAILY_GOLD = 600;
  const daily = { energy: ENERGY, running: false, refilled: false, done: false };
  const taskEls = [...document.querySelectorAll("#dailies .task[data-task]")];
  const progress = Object.fromEntries(taskEls.map((li) => [li.dataset.task, 0]));
  const taskButton = (li) => li.querySelector("button");
  const taskDone = (li) => progress[li.dataset.task] >= Number(li.dataset.need);

  function drawEnergy() {
    $("energy-fill").style.width = `${(daily.energy / ENERGY) * 100}%`;
    $("energy-num").textContent = `${daily.energy} / ${ENERGY}`;
  }

  // The reset clock counts down to the reader's own midnight.
  function tickReset() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const left = Math.floor((midnight - now) / 1000);
    const two = (n) => String(n).padStart(2, "0");
    $("dailies-reset").textContent = `resets in ${two(Math.floor(left / 3600))}:${two(Math.floor(left / 60) % 60)}:${two(left % 60)}`;
  }
  tickReset();
  setInterval(tickReset, 1000);

  function setTaskButtons(on) {
    taskEls.forEach((li) => { taskButton(li).disabled = !on || taskDone(li); });
  }

  const dailiesNotes = {
    paid: "Nothing was charged: this is a page about games. In a real one, that button is what the whole list was built for.",
    waited: "Tomorrow the list resets, and so does your energy. See you then. And the day after.",
  };

  function dailiesEnd(how) {
    if (daily.done) return;
    daily.done = true;
    daily.running = false;
    state.dailies = how;
    if (how === "paid") {
      record("dailies", { who: "studio", k: "The Leash", gold: DAILY_GOLD, text: "energy ran out; you paid $1.99 (pretend)" }, `+${fmt(DAILY_GOLD)} gold for $1.99`);
    } else {
      record("dailies", { who: "studio", k: "The Leash", text: "energy ran out; back tomorrow" }, "+0 · come back tomorrow");
    }
    setTaskButtons(false);
    $("dailies-out").hidden = true;
    $("dailies-actions").hidden = true;
    $("dailies-note").textContent = dailiesNotes[how];
    $("dailies-after").hidden = false;
    openGate("after-dailies");
  }

  taskEls.forEach((li) => taskButton(li).addEventListener("click", () => {
    if (!daily.running || daily.energy <= 0 || taskDone(li)) return;
    daily.energy -= 1;
    progress[li.dataset.task] += 1;
    li.querySelector(".p").textContent = `${progress[li.dataset.task]} / ${li.dataset.need}`;
    if (taskDone(li)) { li.classList.add("done"); taskButton(li).disabled = true; }
    drawEnergy();
    if (taskEls.every(taskDone)) {
      state.dailiesGold = DAILY_GOLD;
      pouch.setGold(state.gold + DAILY_GOLD);
      flyCoins($("dailies"), pouch.el, 6);
      $("dailies-reward").textContent = `All done: +${DAILY_GOLD} gold`;
      dailiesEnd("paid");
    } else if (daily.energy <= 0) {
      setTaskButtons(false);
      $("dailies-out").hidden = false;
      updatePager();
    }
  }));

  $("dailies-start").addEventListener("click", () => {
    if (daily.running || daily.done) return;
    daily.running = true;
    $("dailies-start").disabled = true;
    setTaskButtons(true);
    taskButton(taskEls[0]).focus();
  });

  $("refill").addEventListener("click", () => {
    if (daily.refilled || daily.done) return;
    daily.refilled = true;
    daily.energy = ENERGY;
    drawEnergy();
    $("dailies-out").hidden = true;
    setTaskButtons(true);
  });

  $("wait").addEventListener("click", () => dailiesEnd("waited"));
  $("dailies-skip").addEventListener("click", () => dailiesEnd("waited"));
  drawEnergy();

  // ---------- chapter 2: the studio story ----------
  // A short branching story from the director's chair. A choice nudges the meters and names the next scene.
  // Endings are fixed by the path, not by the meters, so each one can say plainly why it happened.

  const STORY = {
    start: {
      lines: [
        ["VERA · FINANCE", "Daily players are down 20% this year. The board wants them back up by next quarter."],
        ["SAM · COMMUNITY", "Players say there's nothing new to do. They've seen it all."],
      ],
      choices: [
        { label: "Add daily tasks and a login streak.", next: "chores", d: { players: 10, trust: -10, cash: 5 } },
        { label: "Make the best gear drop less often.", next: "drops", d: { players: 5, trust: -15, cash: 5 } },
        { label: "Start building a big new expansion.", next: "build", d: { trust: 5, cash: -15 } },
      ],
    },
    chores: {
      lines: [
        ["mira_k", "another daily list? cool. love my second job", "player"],
        ["VERA · FINANCE", "Hours played are up 30%. Whatever you did, keep doing it."],
        ["SAM · COMMUNITY", "They're logging in. They're just not enjoying it."],
      ],
      choices: [
        { label: "Keep it, and add a paid battle pass.", end: "treadmill", d: { trust: -15, cash: 20 } },
        { label: "Roll it back and start the expansion.", next: "build", late: true, d: { players: -5, trust: 10, cash: -15 } },
      ],
    },
    drops: {
      lines: [
        ["dax_99", "3 weeks for one drop?? gold sellers have it for $5", "player"],
        ["SAM · COMMUNITY", "The rare gear is already for sale on outside websites. Bots farm it day and night."],
        ["VERA · FINANCE", "Time played is up, though. Can't we just ban the bots?"],
      ],
      choices: [
        { label: "Keep the drop rate. Ban the bots.", end: "lights", d: { players: -15, trust: -15 } },
        { label: "Put the drop rate back and start the expansion.", next: "build", late: true, d: { trust: 5, cash: -15 } },
      ],
    },
    build: {
      lines: [
        ["VERA · FINANCE", "An expansion takes at least a year. Who's building it?"],
        ["SAM · COMMUNITY", "Our team has kept the game running for years. They've never made anything this big."],
      ],
      choices: [
        { label: "Our own team. Keep costs down.", end: "empty", d: { cash: -5 } },
        { label: "Hire experienced designers, whatever it costs.", next: "wait", d: { cash: -20 } },
      ],
    },
    wait: {
      lines: [
        ["VERA · FINANCE", "Cash is running low, and players are drifting while we build. Give them something to grind until launch?"],
        ["mira_k", "is this game even getting updates anymore", "player"],
      ],
      choices: [
        { label: "Add a grind event to hold them.", end: "scars", d: { players: 5, trust: -10 } },
        { label: "Tell players the plan, and let them vote on it.", end: "good", d: { trust: 20 } },
      ],
    },
  };

  const ENDINGS = {
    good: {
      tone: "good", label: "GOOD ENDING", title: "Worth staying for", gold: 50000, value: 1.3, why: "players came back, and more players want more gold",
      text: "The expansion launches late and over budget, but it's good, and players voted for it, so it feels like theirs. Old players come back and new ones arrive. The board gets its numbers, and nobody had to be chained to a chore list.",
      real: "Real studios have pulled this off. Read on.",
      meters: { players: 85, trust: 90, cash: 60 },
    },
    scars: {
      tone: "mixed", label: "MIXED ENDING", title: "Good game, sore players", gold: 20000, value: 1.1, why: "most players came back, if carefully",
      text: "The expansion is great. But the grind event made players wonder whether the chores were coming back. They return carefully, with one eye on the exit.",
      real: "Trust is slow to build and quick to spend.",
      meters: { players: 70, trust: 50, cash: 55 },
    },
    treadmill: {
      tone: "mixed", label: "MIXED ENDING", title: "The treadmill", gold: 120000, value: 0.6, why: "the chores poured gold in, so each coin buys less",
      text: "The numbers look great. Players log in every day, clear their lists, buy the pass and complain. Few of them are having fun, but few leave, yet. Emberfall keeps running as a chore machine.",
      real: "Remember that comment: “they know we won't stop playing.”",
      meters: { players: 70, trust: 20, cash: 90 },
    },
    lights: {
      tone: "bad", label: "BAD ENDING", title: "Lights out", gold: 0, value: 0.1, why: "players left, and nobody wants a dying game's gold",
      text: "The bots come back on new accounts every day. Honest players give up on the drop: some buy it from gold sellers, most just quit. Two years later, Emberfall's servers go dark.",
      real: "In chapter 3, RuneScape tries banning bots too.",
      meters: { players: 10, trust: 10, cash: 15 },
    },
    empty: {
      tone: "bad", label: "BAD ENDING", title: "Big promise, empty launch", gold: 0, value: 0.5, why: "half the players left, and half the buyers with them",
      text: "The expansion ships late, buggy and thin. Players who waited a year feel cheated, and the money is gone. Good content needs people who know how to make it, and Emberfall didn't have them.",
      real: "That's the risk most studios won't take. Read on.",
      meters: { players: 20, trust: 15, cash: 5 },
    },
  };

  const METERS_START = { players: 55, trust: 60, cash: 60 };
  const story = { meters: { ...METERS_START }, quarter: 0, late: false, busy: false };
  const storyLines = $("story-lines");
  const storyChoices = $("story-choices");
  state.endingsFound = new Set();

  function drawMeters() {
    document.querySelectorAll("#story .meter").forEach((m) => {
      const v = story.meters[m.dataset.m];
      m.querySelector(".fill").style.width = `${v}%`;
      m.classList.toggle("low", v < 30);
    });
  }

  function nudge(d = {}) {
    Object.entries(d).forEach(([k, v]) => { story.meters[k] = Math.min(100, Math.max(5, story.meters[k] + v)); });
    drawMeters();
  }

  function storyLine([who, text, kind]) {
    const line = document.createElement("p");
    line.className = kind === "player" ? "line player" : "line";
    const name = document.createElement("span");
    name.className = "who";
    name.textContent = who;
    line.append(name, text);
    storyLines.appendChild(line);
  }

  function choiceButton(label, onPick) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = label;
    btn.addEventListener("click", onPick);
    storyChoices.appendChild(btn);
    return btn;
  }

  function playScene(id) {
    const scene = STORY[id];
    story.quarter += 1;
    story.busy = true;
    $("story-scene").textContent = `QUARTER ${story.quarter}`;
    storyLines.replaceChildren();
    storyChoices.replaceChildren();
    scene.lines.forEach((line, i) => setTimeout(() => storyLine(line), pause(700 * i)));
    setTimeout(() => {
      story.busy = false;
      scene.choices.forEach((c) => choiceButton(c.label, () => {
        if (story.busy) return;
        nudge(c.d);
        if (c.late) story.late = true;
        if (c.end) endStory(c.end); else playScene(c.next);
      }));
      updatePager();
    }, pause(700 * scene.lines.length));
  }

  function endStory(id) {
    const e = ENDINGS[id];
    state.ending = id;
    state.endingsFound.add(id);
    story.meters = { ...e.meters };
    drawMeters();
    $("story-scene").textContent = "TWO YEARS LATER";
    storyLines.replaceChildren();
    storyChoices.replaceChildren();
    const box = document.createElement("div");
    box.className = `ending ${e.tone}`;
    const label = document.createElement("p");
    label.className = "ending-label";
    label.textContent = e.label;
    const title = document.createElement("p");
    title.className = "ending-title";
    title.textContent = e.title;
    const text = document.createElement("p");
    text.textContent = id === "good" && story.late ? `It cost you a U-turn and a lost quarter. ${e.text}` : e.text;
    const effect = `${e.gold ? `+${fmt(e.gold)} gold · ` : ""}${pct(e.value)}`;
    const hit = document.createElement("p");
    hit.className = "ending-pouch";
    hit.textContent = `YOUR POUCH · ${effect} · ${e.why}`;
    const real = document.createElement("p");
    real.className = "ending-real";
    real.textContent = e.real;
    box.append(label, title, text, hit, real);
    record("story", { who: "director", k: "Your studio", gold: e.gold, value: e.value, text: e.title }, effect);
    pouch.setGold(ledgerGold());
    storyLines.appendChild(box);
    const found = document.createElement("p");
    found.className = "found";
    found.textContent = `Endings found: ${state.endingsFound.size} of ${Object.keys(ENDINGS).length}`;
    choiceButton("[ TRY AGAIN ]", startStory);
    storyChoices.appendChild(found);
    $("story-skip").hidden = true;
    openGate("after-story");
  }

  function startStory() {
    story.meters = { ...METERS_START };
    story.quarter = 0;
    story.late = false;
    drawMeters();
    $("story-actions").hidden = true;
    playScene("start");
  }

  $("story-start").addEventListener("click", startStory);
  $("story-skip").addEventListener("click", () => {
    $("story-skip").hidden = true;
    record("story", { who: "director", k: "Your studio", text: "skipped, so nothing changed" });
    openGate("after-story");
  });
  drawMeters();

  // ---------- chapter 3: the crisis room ----------
  // Each choice gets its own chat reaction, then every choice lands on the same screen.

  const crisisLines = {
    ban: ["Ban the bots", [["MOD", "A wave of bot accounts has been banned."], ["lumbridge_lad", "they're back already lol"], ["fletch_master", "new accounts are free. they'll just make more"]]],
    limit: ["Limit trading", [["MOD", "Trade limits are now in place."], ["lumbridge_lad", "wait, I can't pay my brother back??"], ["fletch_master", "the gold sellers will find a way round it"]]],
    sell: ["Sell gold ourselves", [["MOD", "The official gold shop is now open."], ["lumbridge_lad", "so the gold seller is you now?"], ["fletch_master", "pay to win. uninstalling"]]],
    nothing: ["Do nothing", [["MOD", "..."], ["lumbridge_lad", "bots on every rock again"], ["fletch_master", "prices doubled overnight"]]],
  };

  const crisisButtons = document.querySelectorAll("#crisis [data-choice]");
  crisisButtons.forEach((btn) => btn.addEventListener("click", () => {
    if (state.crisisChoice) return;
    const [label, lines] = crisisLines[btn.dataset.choice];
    state.crisisChoice = label;
    record("crisis", { who: "studio", k: "The crisis room", text: `you picked “${label}”; overruled` });
    crisisButtons.forEach((b) => { b.disabled = true; b.classList.toggle("picked", b === btn); });
    lines.forEach((line, i) => setTimeout(() => say(line, $("crisis-chat"), 4), pause(700 * (i + 1))));
    setTimeout(() => {
      fadeTo($("crisis-result"), () => {
        $("crisis-picked").textContent = `You picked “${label}.”`;
        openGate("after-crisis");
      });
    }, pause(700 * lines.length + 1600));
  }));

  // ---------- chapter 3: trade blocked ----------

  $("trade-send").addEventListener("click", () => {
    if (state.tradeLocked) return;
    state.tradeLocked = true;
    $("trade-send").disabled = true;
    const panel = $("trade");
    if (!reducedMotion) {
      panel.classList.remove("shake");
      void panel.offsetWidth;
      panel.classList.add("shake");
    }
    $("trade-alert").hidden = false;
    record("lock", { who: "studio", k: "Trade blocked", locked: true, text: "gold that can't move is worth nothing" }, "trading locked");
    pouch.lock(true);
    pouch.hint();
    setTimeout(() => {
      $("trade-after").hidden = false;
      openGate("after-send");
    }, pause(900));
  });

  // ---------- chapter 3: the vote ----------
  // The one choice in the piece that counts: the reader's vote joins the real result.

  const VOTE_TOTAL = 1234658;
  const voteButtons = document.querySelectorAll("#vote [data-vote]");
  voteButtons.forEach((btn) => btn.addEventListener("click", () => {
    if (state.vote) return;
    state.vote = btn.dataset.vote;
    voteButtons.forEach((b) => { b.disabled = true; b.classList.toggle("picked", b === btn); });
    const bars = $("vote-bars");
    bars.hidden = false;
    bars.querySelector(`[data-opt="${state.vote}"]`).classList.add("you");
    void bars.offsetWidth;
    bars.classList.add("grow");
    countUp($("vote-count"), 0, VOTE_TOTAL, 1800);
    setTimeout(() => {
      record("vote", { who: "players", k: "The vote", unlocks: true, text: `${fmt(VOTE_TOTAL)} votes brought trade back (you: ${state.vote})` }, "voted trading back");
      pouch.lock(false);
      openGate("after-vote");
    }, pause(2000));
  }));

  // ---------- chapter 4: the Bond ----------
  // The pouch gets a grey "$ ???" line. It isn't explained; the finale fills it in.

  function showUsd() {
    const line = $("pouch-usd");
    if (!line.hidden) return;
    line.hidden = false;
    pouch.hint();
  }

  // ---------- chapter 4: the price tag ----------
  // One click turns every price into dollars at the Bond's rate and moves the page into the paper phase.
  // The button stays, greyed out: clicking it again only says you can't go back.

  const BOND_GOLD = 9559197;
  const BOND_USD = 9.99;
  const usd = (gold) => {
    const v = (gold * BOND_USD) / BOND_GOLD;
    if (v === 0) return "$0";
    return v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toPrecision(2)}`;
  };

  function setPhase(phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;
  }

  function flipPrice(item) {
    const price = item.querySelector(".price");
    const swap = () => {
      item.querySelector(".was").textContent = price.textContent;
      price.textContent = usd(Number(item.dataset.gp));
      item.classList.add("in-usd");
    };
    if (reducedMotion) { swap(); return; }
    price.animate([{ transform: "rotateX(0)" }, { transform: "rotateX(90deg)" }], { duration: 180, easing: "ease-in" }).onfinish = () => {
      swap();
      price.animate([{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0)" }], { duration: 180, easing: "ease-out" });
    };
  }

  const usdButton = $("show-usd");
  usdButton.addEventListener("click", () => {
    if (state.pricesInUsd) {
      $("usd-tip").classList.add("show");
      if (!reducedMotion) usdButton.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 250 });
      return;
    }
    state.pricesInUsd = true;
    usdButton.textContent = "[ SHOW PRICES IN GOLD ]";
    usdButton.setAttribute("aria-disabled", "true");
    $("usd-tip").textContent = "You can't unsee it.";
    $("shop-unit").textContent = "IN US DOLLARS";
    document.querySelectorAll("#shop .item").forEach((item, i) => setTimeout(() => flipPrice(item), pause(250 * i)));
    setPhase("paper");
    showUsd();
    record("bond", { who: "studio", k: "The Exchange", text: "its own counter put a $ price on your gold" }, `your pouch: ≈ ${usd(pouchWorth())}`);
    setTimeout(() => {
      $("usd-after").hidden = false;
      openGate("after-usd");
    }, pause(1400));
  });

  // ---------- finale: the receipt ----------
  // Printed line by line from `state`, so every reader's receipt is a little different.

  // Each line carries the pouch's running value in dollars, hidden until REVEAL.
  function receiptLines() {
    const entries = [...ledger.values()];
    return entries.map((e, i) => {
      const so = entries.slice(0, i + 1);
      const change = [e.gold ? `+${fmt(e.gold)} gold` : "", e.value !== 1 ? pct(e.value) : ""].filter(Boolean).join(" · ");
      return { ...e, change, run: usd(worthOf(so)) };
    });
  }

  // Who moved the pouch, counted from the ledger (lines that changed nothing still count as decisions).
  function decidedBy() {
    const n = { studio: 0, director: 0, players: 0 };
    ledger.forEach((e) => { n[e.who] += 1; });
    return n;
  }

  let printed = false;
  function printReceipt() {
    if (printed) return;
    printed = true;
    const list = $("receipt-lines");
    const lines = receiptLines();
    lines.forEach((line, i) => setTimeout(() => {
      const li = document.createElement("li");
      const span = (cls, text) => { const el = document.createElement("span"); el.className = cls; el.textContent = text; return el; };
      li.append(span("k", line.k), span(`who-tag ${line.who}`, WHO[line.who]), span("v", line.change ? `${line.text} (${line.change})` : line.text), span("run", "$ ???"));
      li.querySelector(".run").dataset.usd = line.run;
      list.appendChild(li);
    }, pause(600 + 450 * i)));
    setTimeout(() => {
      const n = decidedBy();
      $("receipt-who").textContent = `STUDIO ${n.studio} · YOU, AS THE STUDIO ${n.director} · PLAYERS ${n.players}`;
      $("receipt-total").textContent = `${fmt(ledgerGold())} gold`;
      $("receipt").classList.add("totalled");
      $("reveal").disabled = false;
    }, pause(600 + 450 * lines.length + 300));
  }

  $("reveal").addEventListener("click", () => {
    if (state.revealed) return;
    state.revealed = true;
    $("reveal").disabled = true;
    const worth = `≈ ${usd(pouchWorth())}`;
    $("receipt-usd").textContent = worth;
    $("receipt").classList.add("revealed");
    document.querySelectorAll("#receipt-lines .run").forEach((el, i) => setTimeout(() => { el.textContent = el.dataset.usd; }, pause(150 * i)));
    $("pouch-usd").textContent = worth;
    fillWorth();
    pouch.hint();
    setTimeout(() => openGate("after-reveal"), pause(900));
  });

  // What it's worth: the heading, the numbers and the farmer's hours all follow the reader's own pouch.
  const FARM_DAY_USD = 2.5;
  const FARM_DAY_HOURS = 12;

  function fillWorth() {
    const dollars = (pouchWorth() * BOND_USD) / BOND_GOLD;
    const worth = `≈ ${usd(pouchWorth())}`;
    $("worth-head").textContent = dollars >= 0.9 && dollars <= 1.2 ? "About one dollar." : `About ${usd(pouchWorth())}.`;
    $("worth-again").textContent = worth;
    $("pouch-worth").textContent = worth;
    const hours = (dollars / FARM_DAY_USD) * FARM_DAY_HOURS;
    const mins = Math.round(hours * 60);
    $("worth-work").textContent = hours >= 1.5 ? `about ${Math.round(hours)} hours of work`
      : mins >= 60 ? "about an hour of work"
      : mins >= 2 ? `about ${mins} minutes of work`
      : "less than a couple of minutes of work";
    const n = decidedBy();
    $("count-studio").textContent = n.studio === 1 ? "once" : `${n.studio} times`;
    $("count-players").textContent = n.players === 1 ? "once" : `${n.players} times`;
  }

  // ---------- finale: your turn ----------
  // No right answer: picking one only shows what that choice costs.

  const turnButtons = document.querySelectorAll("#your-turn [data-turn]");
  turnButtons.forEach((btn) => btn.addEventListener("click", () => {
    state.yourTurn = btn.dataset.turn;
    turnButtons.forEach((b) => b.classList.toggle("picked", b === btn));
    document.querySelectorAll("[data-cost]").forEach((p) => { p.hidden = p.dataset.cost !== state.yourTurn; });
  }));

  // ---------- finale: log out ----------
  // The pouch fades away and the page goes dark. The sources wait below.

  $("logout-btn").addEventListener("click", () => {
    $("logout-btn").disabled = true;
    document.body.classList.add("logged-out");
    $("logout-after").hidden = false;
  });

  window.WPYG = { state, pouch, ledger };
})();
