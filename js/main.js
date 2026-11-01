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
    pricesInUsd: false,
    shiftGold: null,
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
      this.setSub(on ? "locked · can't trade" : `buys ${fmt(swordsFor(state.swordPrice))} swords`);
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

  // ---------- reveal on scroll ----------
  // A screen with data-on-reveal runs that action the first time it comes into view.

  const onReveal = {
    pouch: () => pouch.hint(),
    rate: () => runRate(),
    usd: () => showUsd(),
    comments: () => playThread(),
    slp: () => pouch.hint(),
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
    pouch.setSub(`buys ${fmt(swordsFor(SWORD_START_PRICE))} swords`);
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

    pouch.setSub(`buys ${fmt(swordsFor(price))} swords`);
    pouch.bump();

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

  // ---------- chapter 2: the crisis room ----------
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
    crisisButtons.forEach((b) => { b.disabled = true; b.classList.toggle("picked", b === btn); });
    lines.forEach((line, i) => setTimeout(() => say(line, $("crisis-chat"), 4), pause(700 * (i + 1))));
    setTimeout(() => {
      fadeTo($("crisis-result"), () => {
        $("crisis-picked").textContent = `You picked “${label}.”`;
        openGate("after-crisis");
      });
    }, pause(700 * lines.length + 1600));
  }));

  // ---------- chapter 2: trade blocked ----------

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
    pouch.lock(true);
    pouch.hint();
    setTimeout(() => {
      $("trade-after").hidden = false;
      openGate("after-send");
    }, pause(900));
  });

  // ---------- chapter 2: the vote ----------
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
      pouch.lock(false);
      openGate("after-vote");
    }, pause(2000));
  }));

  // ---------- chapter 3: the Bond ----------
  // The pouch gets a grey "$ ???" line. It isn't explained; the finale fills it in.

  function showUsd() {
    const line = $("pouch-usd");
    if (!line.hidden) return;
    line.hidden = false;
    pouch.hint();
  }

  // ---------- chapter 3: the price tag ----------
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
    setTimeout(() => {
      $("usd-after").hidden = false;
      openGate("after-usd");
    }, pause(1400));
  });

  // ---------- chapter 4: four cards ----------
  // Work and Bet are this chapter. Property and Gambling open their notes in the drawer below.

  const cardButtons = document.querySelectorAll(".card-btn");
  cardButtons.forEach((btn) => btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    cardButtons.forEach((b) => b.setAttribute("aria-expanded", String(b === btn && open)));
    document.querySelectorAll("#card-detail [data-detail]").forEach((d) => {
      d.hidden = !(open && d.dataset.detail === btn.dataset.card);
    });
  }));

  // ---------- chapter 4: work a shift ----------
  // A cow takes four hits, drops a cowhide worth 150 gold and comes back 1.5 seconds later.
  // Clicking flat out gets about eight cows in 20 seconds: roughly $20 a week at 12 hours a day,
  // the same range Kotaku reported for Venezuelan farmers. Deliberately dull: no combos, no upgrades.

  const SHIFT_SECONDS = 20;
  const COW_HP = 4;
  const COW_GOLD = 150;
  const COW_RESPAWN_MS = 1500;
  const SHIFTS_PER_DAY = (12 * 3600) / SHIFT_SECONDS;

  const shift = { hp: COW_HP, gold: 0, timer: null, running: false };
  const cow = $("cow");
  const hpPips = [...document.querySelectorAll("#cow-hp i")];

  function drawHp() {
    hpPips.forEach((pip, i) => pip.classList.toggle("gone", i >= shift.hp));
  }

  function dropPop(text) {
    const pop = $("drop-pop");
    pop.textContent = text;
    if (reducedMotion) return;
    pop.animate([
      { opacity: 0, transform: "translate(-50%, 0)" },
      { opacity: 1, transform: "translate(-50%, -14px)", offset: 0.2 },
      { opacity: 0, transform: "translate(-50%, -40px)" },
    ], { duration: 1300, easing: "ease-out", fill: "forwards" });
  }

  cow.addEventListener("click", () => {
    if (!shift.running || shift.hp <= 0) return;
    shift.hp -= 1;
    drawHp();
    if (!reducedMotion) cow.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 120 });
    if (shift.hp > 0) return;
    shift.gold += COW_GOLD;
    $("shift-tally").textContent = `${fmt(shift.gold)} gold`;
    pouch.setGold(state.gold + COW_GOLD);
    flyCoins(cow, pouch.el, 1);
    dropPop(`+${COW_GOLD} gold (${usd(COW_GOLD)})`);
    cow.classList.add("down");
    setTimeout(() => {
      shift.hp = COW_HP;
      drawHp();
      cow.classList.remove("down");
    }, COW_RESPAWN_MS);
  });

  function shiftEnd(gold) {
    clearInterval(shift.timer);
    shift.running = false;
    state.shiftGold = gold;
    cow.disabled = true;
    $("shift-skip").hidden = true;
    $("shift-start").textContent = "[ SHIFT OVER ]";
    $("shift-gold").textContent = fmt(gold);
    $("shift-usd").textContent = usd(gold);
    $("shift-day").textContent = usd(gold * SHIFTS_PER_DAY);
    $("your-week").textContent = usd(gold * SHIFTS_PER_DAY * 7);
    $("shift-end").hidden = false;
    pouch.bump();
    updatePager();
  }

  $("shift-start").addEventListener("click", () => {
    if (shift.running || state.shiftGold !== null) return;
    shift.running = true;
    $("shift-start").disabled = true;
    cow.disabled = false;
    cow.focus();
    const t0 = performance.now();
    shift.timer = setInterval(() => {
      const left = Math.max(0, SHIFT_SECONDS - (performance.now() - t0) / 1000);
      $("shift-clock").textContent = `00:${String(Math.ceil(left)).padStart(2, "0")}`;
      $("shift-bar").style.width = `${(left / SHIFT_SECONDS) * 100}%`;
      if (left <= 0) shiftEnd(shift.gold);
    }, 100);
  });

  // Skipping counts as an average shift: six cows.
  $("shift-skip").addEventListener("click", () => {
    if (shift.running || state.shiftGold !== null) return;
    $("shift-start").disabled = true;
    $("shift-clock").textContent = "00:00";
    $("shift-bar").style.width = "0";
    const gold = 6 * COW_GOLD;
    $("shift-tally").textContent = `${fmt(gold)} gold`;
    pouch.setGold(state.gold + gold);
    shiftEnd(gold);
  });

  $("clock-off").addEventListener("click", () => {
    $("clock-off").disabled = true;
    openGate("after-shift");
    go(1);
  });

  // ---------- chapter 4: the thread ----------
  // Three comments, one at a time, with no commentary.

  const threadLines = [
    ["▲ 202", "It would be wild to experience seeing Venezuela's economy fixed…"],
    ["▲ 115", "…ruining my 20 yr old video game"],
    ["▲ 56", "Venezuelans don't bot though… play legit 12+ hours a day"],
  ];

  function playThread() {
    threadLines.forEach((line, i) => setTimeout(() => say(line, $("thread"), 4), pause(900 + 1400 * i)));
  }

  // ---------- finale: the receipt ----------
  // Printed line by line from `state`, so every reader's receipt is a little different.

  const pouchTotal = () => START_GOLD + (state.shiftGold || 0);

  function receiptLines() {
    return [
      ["Collected on login", `${fmt(START_GOLD)} gold`],
      ["The Mint", `still ${fmt(START_GOLD)} gold, but it buys ${fmt(swordsFor(state.swordPrice))} swords, not ${fmt(swordsFor(SWORD_START_PRICE))}`],
      ["The Central Bank", `trading locked once, unlocked by ${fmt(VOTE_TOTAL)} votes. You voted: ${state.vote ?? "–"}`],
      ["The Exchange", "prices shown in $, can't be undone"],
      ["The Fallout", `one 20-second shift, + ${fmt(state.shiftGold || 0)} gold`],
    ];
  }

  let printed = false;
  function printReceipt() {
    if (printed) return;
    printed = true;
    const list = $("receipt-lines");
    const lines = receiptLines();
    lines.forEach(([k, v], i) => setTimeout(() => {
      const li = document.createElement("li");
      const key = document.createElement("span");
      key.className = "k";
      key.textContent = k;
      const val = document.createElement("span");
      val.className = "v";
      val.textContent = v;
      li.append(key, val);
      list.appendChild(li);
    }, pause(600 + 450 * i)));
    setTimeout(() => {
      $("receipt-total").textContent = `${fmt(pouchTotal())} gold`;
      $("receipt").classList.add("totalled");
      $("reveal").disabled = false;
    }, pause(600 + 450 * lines.length + 300));
  }

  $("reveal").addEventListener("click", () => {
    if (state.revealed) return;
    state.revealed = true;
    $("reveal").disabled = true;
    const worth = `≈ ${usd(pouchTotal())}`;
    $("receipt-usd").textContent = worth;
    $("receipt").classList.add("revealed");
    $("pouch-usd").textContent = worth;
    $("pouch-worth").textContent = worth;
    pouch.hint();
    setTimeout(() => openGate("after-reveal"), pause(900));
  });

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

  window.WPYG = { state, pouch };
})();
