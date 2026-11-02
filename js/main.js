// Who Prints Your Gold? — page logic.
// The reader plays one player all the way through. In each chapter the studio makes a move on the
// player's gold, and from chapter 2 the reader answers it. Every move goes into the ledger; the pouch,
// the receipt and the ending are all read from the ledger, so they can't disagree.

(() => {
  document.documentElement.classList.add("js");
  // A reload starts a new login (every gate closed again), so it should start at the top too.
  history.scrollRestoration = "manual";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const START_GOLD = 1000000;
  const SWORD_START_PRICE = 100;
  const BOND_GOLD = 9559197;
  const BOND_USD = 9.99;

  const state = {
    gold: 0,
    collected: false,
    // The reader's three answers: chapter 2 (the leash), 3 (the lock), 4 (the counters).
    path: { leash: null, bank: null, exchange: null },
    priced: false,
    endingsFound: new Set(),
    phase: "game",
  };

  // ---------- the ledger ----------
  // One entry per move. gold: change in the pouch; value: what each coin buys (×); hours and paid: what
  // the studio got from you; grey: dollars that went to the grey market; cash: dollars you took home.
  // locked freezes the pouch until a later entry unlocks it; banned empties it for good.

  const WHO = { studio: "STUDIO", you: "YOU", players: "PLAYERS" };
  const ledger = new Map();
  const entries = () => [...ledger.values()];
  const sum = (key, list = entries()) => list.reduce((n, e) => n + (e[key] || 0), 0);
  const valueOf = (list = entries()) => list.reduce((n, e) => n * (e.value ?? 1), 1);
  const bannedIn = (list = entries()) => list.some((e) => e.banned);
  const lockedIn = (list = entries()) => list.some((e) => e.locked) && !list.some((e) => e.unlocks);
  // Worth in day-0 gold (a sword at 100). Locked or banned gold is worth nothing to anyone.
  const worthOf = (list = entries()) => (bannedIn(list) || lockedIn(list) ? 0 : sum("gold", list) * valueOf(list));
  const toUsd = (dayZeroGold) => (dayZeroGold * BOND_USD) / BOND_GOLD;
  const usdOf = (list = entries()) => toUsd(worthOf(list));
  const usd = (v) => {
    if (v === 0) return "$0";
    return v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toPrecision(2)}`;
  };
  const pct = (value) => `value ${value >= 1 ? "+" : "−"}${Math.abs(Math.round((value - 1) * 100))}%`;

  function record(key, entry, note) {
    ledger.set(key, entry);
    pouch.draw();
    if (note) { pouch.say(entry.who, note); pouch.bump(); }
  }

  // ---------- pouch ----------
  // Top line: your gold. Then what it buys (and, once the Bond exists, what it's worth in dollars).
  // Underneath, the other side's score: the hours and dollars the studio has had from you.

  const pouch = {
    el: $("pouch"),
    amount: $("pouch-amount"),
    sub: $("pouch-sub"),
    counting: false,
    show() { this.el.hidden = false; },
    setGold(n) {
      state.gold = n;
      this.amount.textContent = fmt(n);
    },
    draw() {
      const list = entries();
      const banned = bannedIn(list);
      const locked = !banned && lockedIn(list);
      this.el.classList.toggle("locked", locked);
      this.el.classList.toggle("banned", banned);
      if (!this.counting) this.setGold(sum("gold", list));
      this.sub.textContent = banned ? "banned · account closed"
        : locked ? "locked · can't trade"
        : `buys ${fmt(Math.floor(worthOf(list) / SWORD_START_PRICE))} swords`;
      const line = $("pouch-usd");
      line.hidden = !state.priced;
      line.textContent = `≈ ${usd(usdOf(list))}`;
      $("pouch-take").textContent = `STUDIO GOT ${fmt(sum("hours", list))} h · $${sum("paid", list).toFixed(2)}`;
      const grey = sum("grey", list);
      $("pouch-grey").hidden = grey === 0;
      $("pouch-grey").textContent = `GREY MARKET GOT $${grey.toFixed(2)}`;
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

  // ---------- reveal on scroll ----------
  // A screen with data-on-reveal runs that action the first time it comes into view.

  const onReveal = {
    pouch: () => pouch.hint(),
    mint: () => mintMove(),
    rate: () => runRate(),
    lock: () => lockMove(),
    vote: () => voteMove(),
    usd: () => bondMove(),
    prices: () => flipShop(),
    receipt: () => setPhase("receipt"),
    print: () => printReceipt(),
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        // An action that returns false wasn't ready yet; it stays watched and runs next time.
        const action = onReveal[e.target.dataset.onReveal];
        if (!action || action() !== false) revealObserver.unobserve(e.target);
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
  // Hidden screens are skipped, so NEXT stops at each decision until the reader answers it.

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
    // (the sources, an opened note, a decision on a phone) and comes back on the next normal one.
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
    pouch.counting = true;
    pouch.setGold(0);
    record("login", { who: "studio", k: "Log in", gold: START_GOLD, text: "printed for you, out of nothing" }, `printed +${fmt(START_GOLD)}`);
    document.body.classList.add("collected");
    if (animated) {
      flyCoins($("collect"), pouch.el, 16);
      await pouch.countTo(START_GOLD, 1300);
    }
    pouch.counting = false;
    pouch.draw();
    pouch.bump();
    $("collect").textContent = "COLLECTED";
    $("after-collect").hidden = false;
    updatePager();
  }

  $("collect").addEventListener("click", () => collect(true));
  $("collect-skip").addEventListener("click", () => collect(false));

  function countUp(el, from, to, ms, unit = "") {
    if (reducedMotion) { el.textContent = fmt(to) + unit; return; }
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3))) + unit;
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  const dollars = (v) => `$${v.toFixed(2)}`;

  // ---------- chapter 1: the studio's move ----------
  // Double drops for a month. The price line draws itself and every coin buys 30% less. No answer allowed.

  const MINT_VALUE = 0.7;
  const MINT_PRICE = Math.round(SWORD_START_PRICE / MINT_VALUE);

  function mintMove() {
    if (ledger.has("mint")) return;
    record("mint", { who: "studio", k: "The Mint", value: MINT_VALUE, text: `double drops for a month: a sword went ${SWORD_START_PRICE} → ${MINT_PRICE} gold` }, "double drops · value −30%");
    $("mint-chart").classList.add("draw");
    countUp($("mint-price"), SWORD_START_PRICE, MINT_PRICE, 1800, " gold");
  }

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

  // ---------- gates and decisions ----------
  // A gate is a hidden wrapper around everything after a decision; answering opens it.
  // A decision is a column of buttons: picking one locks the rest, writes the answer to the ledger,
  // and prints what happened under it.

  function openGate(id) {
    $(id).hidden = false;
    updatePager();
  }

  const pause = (ms) => (reducedMotion ? 0 : ms);

  function decide(id, answer) {
    const box = $(id);
    const buttons = box.querySelectorAll("[data-pick]");
    buttons.forEach((btn) => btn.addEventListener("click", () => {
      if (box.dataset.done) return;
      box.dataset.done = "1";
      buttons.forEach((b) => { b.disabled = true; b.classList.toggle("picked", b === btn); });
      answer(btn.dataset.pick);
    }));
  }

  function resetDecision(id) {
    const box = $(id);
    delete box.dataset.done;
    box.hidden = false;
    box.querySelectorAll("[data-pick]").forEach((b) => { b.disabled = false; b.classList.remove("picked"); });
  }

  function showResult(id, text) {
    $(id).textContent = text;
    $(id).hidden = false;
    updatePager();
  }

  // A banned player loses the next decision: the buttons give way to a note and a way to carry on.
  function benchAt(decision, note) {
    $(decision).hidden = true;
    $(note).hidden = false;
  }

  // ---------- chapter 2: the leash ----------
  // Four ways to get a sword the studio has made slow on purpose. The grey market is the cheapest.

  const SWORD_GOLD = 4000000;
  const LEASH = {
    grind: { gold: SWORD_GOLD, hours: 60, text: "ground out the sword: three weeks of evenings", note: "+4,000,000 gold · 60 h to the studio",
      result: "Three weeks later, the sword is yours. The studio got what it wanted too: 60 more hours on its dashboard." },
    pay: { gold: SWORD_GOLD, hours: 20, paid: 19.9, text: "paid for ten energy refills", note: "+4,000,000 gold · $19.90 to the studio",
      result: "Ten refills later, the sword is yours, in a third of the time. The studio got $19.90 and 20 hours. That's what the energy bar was for." },
    grey: { gold: SWORD_GOLD, grey: 2, text: "bought 4,000,000 gold from a seller for $2", note: "+4,000,000 gold · $2 to a gold seller",
      result: "The gold arrives in ten minutes, ten times cheaper than the refills. How does a seller have 4 million gold to spare? Bots, farming all night. Remember this." },
    leave: { text: "logged off for a while", note: "+0 · the studio lost a player",
      result: "You log off. The studio's dashboard shows one player fewer. Your gold waits in the bank." },
  };

  decide("d-leash", (pick) => {
    mintMove();
    state.path.leash = pick;
    const a = LEASH[pick];
    record("leash", { who: "you", k: "The Leash", ...a }, a.note);
    if (a.gold) flyCoins($("d-leash"), pouch.el, 8);
    showResult("r-leash", a.result);
    $("lock-you").textContent = pick === "grey"
      ? "And the 4,000,000 gold you bought for $2? It came from a bot farm, and the studio followed it to you. Your account is banned. Your pouch is empty."
      : pick === "leave"
        ? `You weren't even playing. Your ${fmt(sum("gold"))} gold is locked anyway.`
        : `Your ${fmt(sum("gold"))} gold can't move. You can't give it, lend it, or sell it fairly.`;
    if (pick === "grey") benchAt("d-bank", "b-bank");
    setTimeout(() => openGate("after-d1"), pause(700));
  });

  // ---------- chapter 3: the lock, your answer, the vote ----------

  function lockMove() {
    if (ledger.has("lock")) return;
    if (state.path.leash === "grey") {
      record("lock", { who: "studio", k: "Trade blocked", banned: true, gold: -sum("gold"), text: "trade limits, and your bot gold traced: banned" }, "bot gold traced · account banned");
    } else {
      record("lock", { who: "studio", k: "Trade blocked", locked: true, text: "trades over 3,000 gold blocked, for everyone" }, "trading locked");
    }
    pouch.hint();
  }

  const BANK = {
    voice: { gold: 300000, hours: 15, text: "signed the petition, kept playing", note: "+300,000 gold · 15 h to the studio",
      result: "Your name goes on the list with thousands of others. For a long time, nothing happens." },
    quiet: { gold: 1000000, hours: 40, text: "kept your head down and kept grinding", note: "+1,000,000 gold · 40 h to the studio",
      result: "You grind on. The gold piles up in a pouch you can't trade from. The studio's dashboard has no idea you're angry." },
    grey: { banned: true, grey: 3, text: "paid a seller $3 to dodge the limit: banned", note: "account banned · $3 to a gold seller",
      result: "The seller moves your gold through a chain of bot accounts. Two weeks later the studio bans the whole chain, yours included." },
    leave: { text: "left the game", note: "+0 · the studio lost a player",
      result: "You quit. Your gold stays behind, locked, in a game you no longer play." },
  };

  decide("d-bank", (pick) => {
    lockMove();
    state.path.bank = pick;
    const a = { ...BANK[pick] };
    if (pick === "grey") a.gold = -sum("gold");
    const back = state.path.leash === "leave" && (pick === "voice" || pick === "quiet");
    record("bank", { who: "you", k: "The Tug of War", ...a, text: back ? `came back, ${a.text}` : a.text }, a.note);
    showResult("r-bank", back ? `You come back for this. ${a.result}` : a.result);
    afterBank();
  });

  $("w-bank").addEventListener("click", () => {
    if (state.path.bank) return;
    lockMove();
    state.path.bank = "banned";
    $("w-bank").disabled = true;
    afterBank();
  });

  function afterBank() {
    const p = state.path;
    const banned = bannedIn();
    $("vote-you").textContent = banned ? "Your pouch stays empty. Banned accounts don't get a vote."
      : p.bank === "voice" ? "One of those votes was yours. Your pouch is unlocked."
      : p.bank === "leave" ? "You'd already left. Your pouch is unlocked, in a game you don't play."
      : "You didn't vote. Other players did it for you. Your pouch is unlocked.";
    $("keep-label").textContent = p.bank === "leave" ? "Neither. Stay away." : "Neither. Keep playing for free.";
    if (banned) benchAt("d-exchange", "b-exchange");
    setTimeout(() => openGate("after-d2"), pause(700));
  }

  // The reader's vote isn't asked for here: it was given (or not) in their answer above.
  const VOTE_TOTAL = 1234658;

  function voteMove() {
    if (ledger.has("vote")) return;
    const bars = $("vote-bars");
    bars.querySelector('[data-opt="Yes"]').classList.toggle("you", state.path.bank === "voice");
    void bars.offsetWidth;
    bars.classList.add("grow");
    countUp($("vote-count"), 0, VOTE_TOTAL, 1800);
    const banned = bannedIn();
    record("vote", {
      who: "players", k: "The vote", unlocks: true,
      text: banned ? `${fmt(VOTE_TOTAL)} votes brought trade back, but not for you` : `${fmt(VOTE_TOTAL)} votes brought trade back${state.path.bank === "voice" ? ", yours among them" : ""}`,
    }, banned ? null : "voted trading back");
  }

  // ---------- chapter 4: the Bond, the shop, your answer ----------
  // From the Bond on, the pouch shows dollars. The shop flips to dollars by itself: there's no going back.

  function setPhase(phase) {
    state.phase = phase;
    document.body.dataset.phase = phase;
  }

  // On the reader's server a Bond sells for more gold than the real one: prices are up since the double drops.
  const GREY_SHARE = 0.6;
  const bondGold = () => Math.round(BOND_GOLD / valueOf());
  const freeUsd = () => toUsd(sum("gold") * valueOf());

  function bondMove() {
    if (ledger.has("bond")) return;
    voteMove();
    state.priced = true;
    record("bond", { who: "studio", k: "The Bond", text: "opened its own counter: gold now has a dollar price" }, `your pouch: ≈ ${usd(usdOf())}`);
    $("offer-bond").textContent = `${fmt(bondGold())} gold`;
    $("offer-grey").textContent = `${dollars(freeUsd() * GREY_SHARE)} cash`;
  }

  function flipPrice(item) {
    const price = item.querySelector(".price");
    const swap = () => {
      item.querySelector(".was").textContent = price.textContent;
      price.textContent = usd(toUsd(Number(item.dataset.gp)));
      item.classList.add("in-usd");
    };
    if (reducedMotion) { swap(); return; }
    price.animate([{ transform: "rotateX(0)" }, { transform: "rotateX(90deg)" }], { duration: 180, easing: "ease-in" }).onfinish = () => {
      swap();
      price.animate([{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0)" }], { duration: 180, easing: "ease-out" });
    };
  }

  let flipped = false;
  function flipShop() {
    bondMove();
    setPhase("paper");
    if (flipped) return;
    flipped = true;
    $("shop-unit").textContent = "IN US DOLLARS";
    document.querySelectorAll("#shop .item").forEach((item, i) => setTimeout(() => flipPrice(item), pause(700 + 250 * i)));
    setTimeout(() => { $("usd-after").hidden = false; updatePager(); }, pause(1900));
  }

  const EXCHANGE = {
    bond: () => ({
      gold: bondGold(), paid: BOND_USD, hours: 10, text: "bought a Bond and sold it for gold", note: `+${fmt(bondGold())} gold · $9.99 to the studio`,
      result: `Ten minutes and $9.99 later, you have ${fmt(bondGold())} more gold. It came from another player, who paid it for your Bond. The studio kept the $9.99.`,
    }),
    sell: () => {
      const gold = sum("gold");
      const full = freeUsd();
      const cash = full * GREY_SHARE;
      return {
        gold: -gold, cash, grey: full - cash, banned: true, text: `sold ${fmt(gold)} gold to the grey market: banned`, note: `${dollars(cash)} cash · account banned`,
        result: `The cash arrives. A week later, so does the ban: the buyer was a bot ring, and the studio followed the gold. The ring sells it on for ${dollars(full)}.`,
      };
    },
    keep: () => (state.path.bank === "leave"
      ? { text: "stayed away", note: "+0 · still gone", result: "You stay away. The studio's counters stay open without you." }
      : { gold: 700000, hours: 20, text: "kept playing, wallet shut", note: "+700,000 gold · 20 h to the studio", result: "You keep playing and keep your wallet shut. The studio still gets your hours." }),
  };

  decide("d-exchange", (pick) => {
    bondMove();
    state.path.exchange = pick;
    const a = EXCHANGE[pick]();
    record("exchange", { who: "you", k: "The Exchange", ...a }, a.note);
    showResult("r-exchange", a.result);
    finish();
  });

  $("w-exchange").addEventListener("click", () => {
    if (state.path.exchange) return;
    bondMove();
    state.path.exchange = "banned";
    $("w-exchange").disabled = true;
    finish();
  });

  // ---------- the ending ----------
  // Fixed by the three answers, checked in this order. Each one says plainly why it happened.

  const ENDINGS = {
    good: {
      tone: "good", label: "GOOD ENDING", title: "Worth staying for",
      text: "You played the game, not the shop, and when the studio locked you in, you answered with your name on a petition. Players like you won the vote. Your gold isn't worth much in dollars. It was never meant to be.",
      real: "This one really happened: in 2013, a petition and a vote brought back Old School RuneScape.",
    },
    favourite: {
      tone: "mixed", label: "MIXED ENDING", title: "The studio's favourite",
      text: "You have the sword and a fat pouch. The studio has your money, and it noticed. Next year the energy bar will be a little shorter, and the refills a little dearer.",
      real: "“The price will keep going up, because we keep paying it.” In 2026, it did.",
    },
    treadmill: {
      tone: "bad", label: "BAD ENDING", title: "On the treadmill",
      text: "You did everything the studio asked. You logged in, put in the hours, and never complained. Other players won the vote that freed your gold. The studio's dashboard loves you. Did you have fun?",
      real: "Remember that comment: “they know we won't stop playing.”",
    },
    away: {
      tone: "mixed", label: "MIXED ENDING", title: "Walked away",
      text: "You cut the leash. The studio lost a player, and a player leaving is the one signal every studio reads. But your gold stayed behind, and the game went on without you.",
      real: "Leaving is the one vote the studio always counts.",
    },
    banned: {
      tone: "bad", label: "BAD ENDING", title: "Banned",
      text: "",
      real: "In 2013 alone, Jagex banned 1.1 million gold-farming accounts.",
    },
  };

  function endingId() {
    const p = state.path;
    if (bannedIn()) return "banned";
    if (p.bank === "leave" && p.exchange === "keep") return "away";
    if (p.leash === "pay" || p.exchange === "bond") return "favourite";
    if (p.bank === "voice") return "good";
    return "treadmill";
  }

  function bannedText() {
    const p = state.path;
    const how = p.leash === "grey"
      ? "The cheapest gold in the game came from bots, and the studio followed it to you. The seller kept your $2."
      : p.bank === "grey"
        ? "The seller dodged the trade limit with bot accounts, and when the studio banned them, it banned you too. The seller kept your $3."
        : `You walked off with ${dollars(sum("cash"))} in cash. The bot ring that bought your gold sold it on at a profit.`;
    return `${how} The studio lost a player, you lost the game, and the grey market got paid. That's why it's both sides' enemy.`;
  }

  function finish() {
    const id = endingId();
    const e = ENDINGS[id];
    state.ending = id;
    state.endingsFound.add(id);
    $("ending").className = `ending ${e.tone}`;
    $("ending-label").textContent = e.label;
    $("ending-title").textContent = e.title;
    $("ending-text").textContent = id === "banned" ? bannedText() : e.text;
    $("ending-real").textContent = e.real;
    $("ending-found").textContent = `Endings found: ${state.endingsFound.size} of ${Object.keys(ENDINGS).length}`;
    fillHour();
    fillWorth();
    fillCounts();
    fillTurn();
    setTimeout(() => openGate("after-d3"), pause(700));
  }

  // ---------- the last chapter, filled in from the ledger ----------

  function fillHour() {
    const h = sum("hours");
    const v = usdOf();
    $("hour-you").hidden = !(h > 0 && v > 0);
    $("hour-you").textContent = `In this story you put in ${h} hours and ended up with ${usd(v)}: about ${((v / h) * 100).toFixed(1)}¢ an hour.`;
  }

  // A Venezuelan farmer's day in 2017: about $2.50 for 12 hours or more.
  const FARM_DAY_USD = 2.5;
  const FARM_DAY_HOURS = 12;

  function fillWorth() {
    const v = usdOf();
    const banned = bannedIn();
    const cash = sum("cash");
    $("worth-head").textContent = v === 0 ? "Nothing." : v >= 0.9 && v <= 1.2 ? "About one dollar." : `About ${usd(v)}.`;
    $("pouch-worth").textContent = `≈ ${usd(v)}`;
    $("pouch-worth-d").textContent = banned ? "the account is banned" : "at the Bond's rate";
    $("worth-text").textContent = banned
      ? `A banned account's gold is worth nothing, at any rate.${cash ? ` You did take ${dollars(cash)} home.` : ""}`
      : `At the Bond's rate, $9.99 buys about 9.6 million gold, so a million gold is worth roughly a bottle of water. Your ${fmt(sum("gold"))} gold, after the double drops, comes to ${usd(v)}.`;
    const hours = (v / FARM_DAY_USD) * FARM_DAY_HOURS;
    const mins = Math.round(hours * 60);
    const work = hours >= 1.5 ? `about ${Math.round(hours)} hours of work`
      : mins >= 60 ? "about an hour of work"
      : `about ${Math.max(1, mins)} minutes of work`;
    $("worth-turn").textContent = v === 0
      ? "To a gold farmer in Venezuela in 2017, $2–3 was a whole day's pay. Your gold went to the bots instead."
      : `To you, maybe not much. To a gold farmer in Venezuela in 2017, it was ${work}.`;
  }

  function fillCounts() {
    const n = { studio: 0, you: 0, players: 0 };
    ledger.forEach((e) => { n[e.who] += 1; });
    $("count-line").textContent = `Look at your receipt again. The studio moved ${times(n.studio)}, the players ${times(n.players)}, and you ${times(n.you)}. Every one of your moves was an answer to one of the studio's.`;
  }

  function fillTurn() {
    const p = state.path;
    const took = [p.leash === "grey", p.bank === "grey", p.exchange === "sell"].some(Boolean);
    const offers = 1 + (p.bank !== "banned") + (p.exchange !== "banned");
    $("turn-you").textContent = took ? "You already did, in this story. It cost you the account." : `In this story you were offered it ${times(offers)}, and said no every time.`;
    $("turn-cost").textContent = took ? "And your money paid for the bots and the cheats, in the game you came to enjoy."
      : p.leash === "pay" || p.exchange === "bond" ? "So you paid the studio instead, and the farmers sold to someone else."
      : "So you paid in hours instead, and the farmers sold to someone else.";
  }

  // ---------- finale: the receipt ----------
  // Printed line by line from the ledger, with what the pouch was worth after each move.

  function changeOf(e) {
    return [
      e.gold ? `${e.gold > 0 ? "+" : "−"}${fmt(Math.abs(e.gold))} gold` : "",
      e.value && e.value !== 1 ? pct(e.value) : "",
      e.hours ? `${e.hours} h to studio` : "",
      e.paid ? `${dollars(e.paid)} to studio` : "",
      e.grey ? `${dollars(e.grey)} to grey market` : "",
      e.cash ? `${dollars(e.cash)} cash` : "",
    ].filter(Boolean).join(" · ");
  }

  let printed = false;
  function printReceipt() {
    if (!state.ending) return false;
    if (printed) return;
    printed = true;
    const list = $("receipt-lines");
    list.replaceChildren();
    const all = entries();
    const span = (cls, text) => { const el = document.createElement("span"); el.className = cls; el.textContent = text; return el; };
    all.forEach((e, i) => setTimeout(() => {
      const li = document.createElement("li");
      const change = changeOf(e);
      li.append(span("k", e.k), span(`who-tag ${e.who}`, WHO[e.who]), span("v", change ? `${e.text} (${change})` : e.text), span("run", usd(usdOf(all.slice(0, i + 1)))));
      list.appendChild(li);
    }, pause(500 + 350 * i)));
    setTimeout(() => {
      const cash = sum("cash");
      const grey = sum("grey");
      $("score-you").textContent = `${fmt(sum("gold"))} gold ≈ ${usd(usdOf())}${cash ? ` + ${dollars(cash)} cash` : ""}`;
      $("score-studio").textContent = `${fmt(sum("hours"))} hours · ${dollars(sum("paid"))}`;
      $("score-grey-row").hidden = grey === 0;
      $("score-grey").textContent = dollars(grey);
      $("receipt-ending").textContent = ENDINGS[state.ending].title;
      $("receipt").classList.add("totalled");
    }, pause(500 + 350 * all.length + 300));
  }

  // ---------- finale: play again ----------
  // Back to chapter 2 with the same login and the same double drops; everything after is undone.

  $("replay").addEventListener("click", () => {
    ["leash", "lock", "bank", "vote", "bond", "exchange"].forEach((k) => ledger.delete(k));
    state.path = { leash: null, bank: null, exchange: null };
    state.priced = false;
    state.ending = null;
    ["d-leash", "d-bank", "d-exchange"].forEach(resetDecision);
    ["r-leash", "r-bank", "r-exchange", "b-bank", "b-exchange"].forEach((id) => { $(id).hidden = true; });
    ["w-bank", "w-exchange"].forEach((id) => { $(id).disabled = false; });
    $("vote-bars").classList.remove("grow");
    $("vote-count").textContent = "0";
    printed = false;
    $("receipt-lines").replaceChildren();
    $("receipt").classList.remove("totalled");
    document.body.classList.remove("logged-out");
    $("logout-btn").disabled = false;
    $("logout-after").hidden = true;
    ["after-d1", "after-d2", "after-d3"].forEach((id) => { $(id).hidden = true; });
    setPhase("game");
    pouch.draw();
    pouch.say("you", "back to chapter 2");
    document.querySelectorAll("#after-d1 .screen[data-on-reveal]").forEach((s) => revealObserver.observe(s));
    $("move-leash").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    updatePager();
  });

  // ---------- finale: log out ----------
  // The pouch fades away and the page goes dark. The sources wait below.

  $("logout-btn").addEventListener("click", () => {
    $("logout-btn").disabled = true;
    document.body.classList.add("logged-out");
    $("logout-after").hidden = false;
  });

  window.WPYG = { state, pouch, ledger };
})();
