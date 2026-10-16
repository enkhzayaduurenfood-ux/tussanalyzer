/* tuss.io — scroll story (story.html / story-mn.html)
   One pinned stage, one scrubbed GSAP timeline:
   question → documents scatter → clause links/chaos → laptop ingests → results fly out.
   All copy lives in the page (#story-data JSON + HTML), so this file is language-agnostic. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  if (!window.gsap || !window.ScrollTrigger) { document.documentElement.classList.remove('js'); return; }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  // the story should always start from the question, not a restored mid-animation frame
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const data = JSON.parse($('#story-data').textContent);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = n => Math.round(n).toLocaleString('en-US');

  const story = $('.story');
  const stage = $('.stage');
  const docsEl = $('.docs');
  const svg = $('.links');
  const tagsEl = $('.tags');
  const laptop = $('.laptop');
  const lid = $('.laptop__lid');
  const screen = $('.screen');
  const resCards = $$('.res');
  const SVGNS = 'http://www.w3.org/2000/svg';

  // deterministic "random" so the layout is the same on every visit
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------------- Build documents ---------------- */
  const N = innerWidth < 640 ? 14 : data.docs.length;
  const docs = data.docs.slice(0, N).map(([kind, title], i) => {
    const el = document.createElement('div');
    el.className = 'doc';
    const lines = 6 + (i % 3);
    let html = `<div class="doc__inner"><span class="doc__chip" data-k="${kind}">${data.kinds[kind]}</span><span class="doc__title">${title}</span><div class="doc__lines">`;
    for (let j = 0; j < lines; j++) {
      const w = 52 + Math.round(rnd() * 48);
      const hl = j === 1 + (i % 4) || (j === lines - 2 && i % 2 === 0);
      html += `<span class="ln${hl && i % 4 === 0 ? ' is-red' : ''}" style="width:${w}%">${hl ? '<span class="mk"></span>' : ''}</span>`;
    }
    html += `</div><div class="doc__foot"><span>p. ${1 + Math.floor(rnd() * 40)}</span><i class="doc__seal"></i></div></div>`;
    el.innerHTML = html;
    docsEl.appendChild(el);
    return el;
  });
  const inners = docs.map(d => d.firstElementChild);
  const marks = $$('.mk', docsEl);

  // per-doc constants (stack jitter, scatter jitter) — fixed, independent of viewport
  const J = docs.map(() => ({ sx: rnd() - .5, sr: rnd() - .5, jx: rnd() - .5, jy: rnd() - .5, r: rnd() - .5, s: rnd() }));

  /* ---------------- Links + tags ---------------- */
  const LINK_CLASSES = ['l-navy', 'l-navy', 'l-blue', 'l-navy', 'l-amber', 'l-red', 'l-blue', 'l-navy', 'l-red', 'l-amber'];
  const links = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('pathLength', '1');
      p.setAttribute('class', LINK_CLASSES[(i * 3 + k) % LINK_CLASSES.length]);
      svg.appendChild(p);
      links.push({ el: p, a: i, b: -1, bend: rnd() - .5, pick: rnd() });
    }
  }
  const tags = data.tags.map(([kind, text]) => {
    const t = document.createElement('span');
    t.className = 'tag' + (kind ? ' tag--' + kind : '');
    t.textContent = text;
    tagsEl.appendChild(t);
    return t;
  });

  /* ---------------- Captions: split words ---------------- */
  function splitWords(el) {
    [...el.childNodes].forEach(node => {
      if (node.nodeType === 3) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span'); w.className = 'w';
          const wi = document.createElement('span'); wi.className = 'wi'; wi.textContent = part;
          w.appendChild(wi); frag.appendChild(w);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === 1) {
        node.classList.add('is-split');
        splitWords(node);
      }
    });
  }
  const caps = {};
  $$('.cap').forEach(c => { splitWords($('.cap__h', c)); caps[c.dataset.cap] = c; });

  /* ---------------- Layout (recomputed on every refresh) ---------------- */
  const L = { W: 0, H: 0, stack: [], scatter: [], sc: { x: 0, y: 0 }, sc2: { x: 0, y: 0 }, res: [], lapS: 1, lapDy: 0 };

  function offsetIn(el, ancestor) {
    let x = 0, y = 0;
    while (el && el !== ancestor) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { x, y };
  }

  function computeLayout() {
    const W = L.W = stage.clientWidth;
    const H = L.H = stage.clientHeight || innerHeight;
    const dw = docs[0].offsetWidth;
    const dh = docs[0].offsetHeight;
    const narrow = W < 640;
    const navH = narrow ? 64 : 76;

    // 1. stack (hero): an isometric pile below the question
    const stackY = H * (narrow ? .24 : .25);
    L.stack = docs.map((_, i) => ({
      x: J[i].sx * dw * .1,
      y: stackY - (i - N / 2) * dw * (narrow ? .04 : .024),
      rz: -34 + J[i].sr * 9
    }));

    // 2. scatter: jittered grid cells, keeping the caption area in the middle clear
    const mx = dw * .55, top = -H / 2 + navH + dh * .5, bottom = H / 2 - dh * .55;
    const left = -W / 2 + mx, right = W / 2 - mx;
    const clearX = narrow ? W : W * .3, clearY = narrow ? H * .2 : H * .19;
    let cells = [];
    for (let rows = 3; rows < 12 && cells.length < N; rows++) {
      const cols = Math.max(3, Math.round(rows * (W / H) * 1.1));
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = left + (right - left) * (cols === 1 ? .5 : c / (cols - 1));
          const y = top + (bottom - top) * (rows === 1 ? .5 : r / (rows - 1));
          if (Math.abs(x) < clearX && Math.abs(y) < clearY) continue;
          cells.push({ x, y, cw: (right - left) / cols, ch: (bottom - top) / rows });
        }
      }
    }
    // spread picks evenly across the available cells
    const step = cells.length / N;
    L.scatter = docs.map((_, i) => {
      const c = cells[Math.floor(i * step + step * .5 * J[i].s) % cells.length];
      return {
        x: c.x + J[i].jx * c.cw * .45,
        y: c.y + J[i].jy * c.ch * .4,
        rz: J[i].r * 30,
        s: .86 + J[i].s * .2
      };
    });

    // 3. links: each doc → nearest neighbour + a random far one
    links.forEach((l, idx) => {
      const a = L.scatter[l.a];
      if (idx % 3 === 0) {
        let best = -1, bd = Infinity;
        L.scatter.forEach((p, j) => { if (j === l.a) return; const d = (p.x - a.x) ** 2 + (p.y - a.y) ** 2; if (d < bd) { bd = d; best = j; } });
        l.b = best;
      } else {
        l.b = (l.a + 1 + Math.floor(l.pick * (N - 1))) % N;
      }
      const b = L.scatter[l.b];
      const x1 = a.x + W / 2, y1 = a.y + H / 2, x2 = b.x + W / 2, y2 = b.y + H / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const cx = (x1 + x2) / 2 - dy * l.bend * .5, cy = (y1 + y2) / 2 + dx * l.bend * .5;
      l.el.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      l.mid = { x: (x1 + 2 * cx + x2) / 4, y: (y1 + 2 * cy + y2) / 4 };
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // 4. tags sit on link midpoints outside the caption area
    const spots = links.map(l => l.mid).filter(m => !(Math.abs(m.x - W / 2) < clearX * 1.05 && Math.abs(m.y - H / 2) < clearY * 1.2));
    const pool = spots.length >= tags.length ? spots : links.map(l => l.mid);
    const tStep = pool.length / tags.length;
    tags.forEach((t, i) => {
      const m = pool[Math.floor(i * tStep) % pool.length];
      const x = Math.min(Math.max(m.x, t.offsetWidth / 2 + 8), W - t.offsetWidth / 2 - 8);
      const y = Math.min(Math.max(m.y, navH + 16), H - 24);
      t.style.left = (x - t.offsetWidth / 2) + 'px';
      t.style.top = (y - t.offsetHeight / 2) + 'px';
    });

    // 5. laptop screen centre (at rest, transforms ignored)
    const lo = offsetIn(laptop, stage);
    const so = offsetIn(screen, stage);
    L.sc = { x: so.x + screen.offsetWidth / 2 - W / 2, y: so.y + screen.offsetHeight / 2 - H / 2 };

    // 6. final laptop pose + result positions
    L.lapS = narrow ? .7 : .62;
    L.lapDy = H * (narrow ? .08 : .07);
    const baseY = lo.y + laptop.offsetHeight;                    // transform origin: bottom centre
    const scY = so.y + screen.offsetHeight / 2;
    L.sc2 = { x: L.sc.x, y: baseY + (scY - baseY) * L.lapS + L.lapDy - H / 2 };

    const rw = resCards[0].offsetWidth;
    const lapTop = baseY + L.lapDy - laptop.offsetHeight * L.lapS - H / 2;
    const sub = $('.cap__sub', caps[5]);
    const capBottom = offsetIn(sub, stage).y + sub.offsetHeight - H / 2;
    if (W >= 1000) {
      const gap = Math.min(36, W * .02);
      const cy = Math.max(capBottom + resCards[1].offsetHeight / 2 + 20, (capBottom + lapTop) / 2 + 10);
      L.res = [
        { x: -(rw + gap), y: cy + H * .06, r: -4 },
        { x: 0, y: cy - H * .02, r: 0 },
        { x: rw + gap, y: cy + H * .06, r: 4 }
      ];
    } else {
      const top = capBottom + resCards[2].offsetHeight / 2 + 28;
      const cy = narrow ? top : Math.max(top, lapTop - H * .03);
      const spread = narrow ? rw * .1 : rw * .55;
      L.res = [
        { x: -spread, y: cy + 16, r: -6 },
        { x: spread, y: cy + 16, r: 6 },
        { x: 0, y: cy - 6, r: 0 }
      ];
    }
  }

  /* ---------------- Timeline ---------------- */
  gsap.set(resCards, { yPercent: -50, opacity: 0 });
  gsap.set(laptop, { transformOrigin: '50% 100%' });
  const capIn = (c, at) => {
    tl.set(c, { opacity: 1 }, at);
    tl.fromTo($$('.wi', c), { yPercent: 110 }, { yPercent: 0, duration: .5, stagger: .04, ease: 'power3.out', immediateRender: false }, at);
    tl.fromTo($$('.cap__label, .cap__sub', c), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .4, ease: 'power2.out', immediateRender: false }, at + .15);
  };
  const capOut = (c, at) => tl.to(c, { opacity: 0, y: -36, duration: .35, ease: 'power2.in' }, at);

  const files = $('[data-files]'), pct = $('[data-pct]'), barI = $('.bar i'), stepsLi = $$('.steps li');
  const counterB = $('[data-counter]');
  const prog = { p: 0 }, cnt = { v: 0 };

  const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
  computeLayout();

  tl.addLabel('question', 0)
    .to('.hint', { opacity: 0, duration: .2 }, .1);

  // beat 2 — the pile scatters
  capOut(caps[1], .5);
  tl.addLabel('chaos', 1.05)
    .fromTo(docs,
      { x: i => L.stack[i].x, y: i => L.stack[i].y, rotationX: 56, rotationZ: i => L.stack[i].rz, scale: 1 },
      { x: i => L.scatter[i].x, y: i => L.scatter[i].y, rotationX: 0, rotationZ: i => L.scatter[i].rz, scale: i => L.scatter[i].s,
        duration: 1.1, stagger: { each: .025, from: 'end' } }, .55)
    .to('.glow--red', { opacity: 1, duration: 1.2 }, 1.2)
    .to('.glow--blue', { opacity: .35, duration: 1 }, 1.2);
  capIn(caps[2], 1.55);

  // clause highlights + links drawing + tags
  tl.to(marks, { scaleX: 1, duration: .35, stagger: { each: .03, from: 'random' }, ease: 'power1.out' }, 2.0)
    .to(links.map(l => l.el), { strokeDashoffset: 0, duration: .6, stagger: { each: .045, from: 'random' }, ease: 'power1.inOut' }, 2.1)
    .to('.counter', { opacity: 1, duration: .3 }, 2.2)
    .to(cnt, { v: 12480, duration: 2.2, ease: 'power1.in', onUpdate: () => { counterB.textContent = fmt(cnt.v); } }, 2.2)
    .to(tags, { opacity: 1, scale: 1, duration: .25, stagger: .16, ease: 'back.out(2)', startAt: { scale: .6 } }, 2.6);

  capOut(caps[2], 3.3);
  capIn(caps[3], 3.55);

  // beat 4 — calm: links retract, laptop rises
  capOut(caps[3], 4.55);
  tl.to(links.map(l => l.el), { strokeDashoffset: -1, opacity: 0, duration: .5, stagger: { each: .006 }, ease: 'power1.in' }, 4.55)
    .to(tags, { opacity: 0, scale: .7, duration: .3, stagger: .03 }, 4.55)
    .to('.counter', { opacity: 0, duration: .3 }, 4.6)
    .to(marks, { scaleX: 0, duration: .3 }, 4.7)
    .to('.glow--red', { opacity: 0, duration: .8 }, 4.6)
    .to('.glow--calm', { opacity: 1, duration: .8 }, 4.8)
    .to('.glow--blue', { opacity: .9, duration: .8 }, 4.8)
    .addLabel('tuss', 4.85)
    .fromTo(laptop, { opacity: 0, y: () => L.H * .6 }, { opacity: 1, y: 0, duration: .8, ease: 'power3.out', immediateRender: false }, 4.85)
    .to('.screen__off', { opacity: 0, duration: .3 }, 5.4)
    .to('.laptop__glow', { opacity: 1, duration: .5 }, 5.4);
  capIn(caps[4], 5.0);

  // docs fly into the screen
  tl.fromTo(docs,
    { x: i => L.scatter[i].x, y: i => L.scatter[i].y, rotationX: 0, rotationZ: i => L.scatter[i].rz, scale: i => L.scatter[i].s, opacity: 1 },
    { x: () => L.sc.x, y: () => L.sc.y, rotationZ: 0, scale: .1, opacity: 0, duration: .7, ease: 'power2.in',
      stagger: { each: .05, from: 'random' }, immediateRender: false }, 5.6)
    .to(prog, {
      p: 100, duration: 1.9, ease: 'none',
      onUpdate: () => {
        const p = prog.p;
        barI.style.transform = `scaleX(${p / 100})`;
        pct.textContent = Math.round(p) + '%';
        files.textContent = fmt(1284 * Math.min(1, p / 90));
        stepsLi.forEach((li, k) => li.classList.toggle('is-on', p >= [22, 48, 74, 97][k]));
      }
    }, 5.75);

  // beat 5 — done, results fly out
  capOut(caps[4], 7.65);
  tl.to('.screen__state--run', { opacity: 0, duration: .25 }, 7.7)
    .to('.screen__state--done', { opacity: 1, duration: .3 }, 7.8)
    .addLabel('clarity', 7.85)
    .to(laptop, { y: () => L.lapDy, scale: () => L.lapS, duration: .7 }, 7.9)
    .to('.glow--amber', { opacity: 1, duration: .8 }, 7.9)
    .fromTo(resCards,
      { x: () => L.sc2.x, y: () => L.sc2.y, scale: .15, rotation: 0, opacity: 0 },
      { x: i => L.res[i].x, y: i => L.res[i].y, rotation: i => L.res[i].r, scale: 1, opacity: 1,
        duration: .85, stagger: .2, ease: 'back.out(1.3)', immediateRender: false }, 8.2);
  capIn(caps[5], 8.45);
  tl.to({}, { duration: .9 }, 9.6); // hold the final frame

  // chapters + HUD
  const order = ['question', 'chaos', 'tuss', 'clarity', 'contact'];
  const navLinks = $$('.chapters a');
  const hudN = $('[data-hud-n]'), hudT = $('[data-hud-t]');
  let current = '';
  function setChapter(ch) {
    if (ch === current) return;
    current = ch;
    navLinks.forEach(a => a.classList.toggle('is-active', a.dataset.ch === ch));
    hudN.textContent = String(order.indexOf(ch) + 1).padStart(2, '0');
    hudT.textContent = data.chapters[ch];
  }
  const labelAt = t => (t >= tl.labels.clarity ? 'clarity' : t >= tl.labels.tuss ? 'tuss' : t >= tl.labels.chaos ? 'chaos' : 'question');

  const st = ScrollTrigger.create({
    trigger: story,
    start: 'top top',
    end: () => '+=' + Math.round(innerHeight * 7),
    pin: true,
    anticipatePin: 1,
    scrub: reduce ? true : .8,
    animation: tl,
    invalidateOnRefresh: true,
    onUpdate: self => { if (!contactOn) setChapter(labelAt(self.progress * tl.duration())); }
  });
  ScrollTrigger.addEventListener('refreshInit', computeLayout);

  let contactOn = false;
  ScrollTrigger.create({
    trigger: '#contact', start: 'top 70%', end: 'bottom top',
    onToggle: self => { contactOn = self.isActive; setChapter(contactOn ? 'contact' : labelAt(st.progress * tl.duration())); }
  });
  setChapter('question');

  navLinks.forEach(a => a.addEventListener('click', e => {
    const ch = a.dataset.ch;
    if (ch === 'contact') return; // native anchor
    e.preventDefault();
    const t = tl.labels[ch] + (ch === 'question' ? 0 : .35);
    const y = st.start + (st.end - st.start) * (t / tl.duration());
    window.scrollTo({ top: Math.ceil(y), behavior: reduce ? 'auto' : 'smooth' });
  }));

  // top progress bar
  const bar = $('.progress i');
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: s => { bar.style.transform = `scaleX(${s.progress})`; } });

  /* ---------------- Intro + idle motion ---------------- */
  if (!reduce) {
    gsap.from($$('.wi', caps[1]), { yPercent: 110, duration: .9, stagger: .05, ease: 'power3.out', delay: .15 });
    gsap.from($$('.cap__label, .cap__sub', caps[1]), { opacity: 0, y: 14, duration: .7, delay: .5, ease: 'power2.out' });
    gsap.from(inners, { yPercent: -160, opacity: 0, duration: .7, stagger: .035, ease: 'power3.out', delay: .3 });
    inners.forEach((el, i) => {
      gsap.to(el, { y: (i % 2 ? 3 : -3), rotation: (i % 3 - 1) * 1.2, duration: 1.6 + (i % 5) * .3, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: (i % 7) * .2 });
    });
  }

  /* ---------------- After-story sections ---------------- */
  // manifesto: words light up as you scroll
  const mp = $('[data-words]');
  if (mp) {
    const mk = (text, isK) => text.split(/(\s+)/).map(part => {
      if (!part) return '';
      if (/^\s+$/.test(part)) return ' ';
      return `<span class="mw${isK ? ' k' : ''}">${part}</span>`;
    }).join('');
    mp.innerHTML = [...mp.childNodes].map(n => n.nodeType === 3 ? mk(n.textContent, false) : mk(n.textContent, true)).join('');
    const words = $$('.mw', mp);
    gsap.to(words, {
      color: (i, el) => el.classList.contains('k') ? '#2563EB' : '#042153',
      ease: 'none', stagger: .1,
      scrollTrigger: { trigger: mp, start: 'top 82%', end: 'bottom 50%', scrub: true }
    });
  }

  // marquee rows drift in opposite directions with scroll
  $$('.mq').forEach(row => {
    const dir = +row.dataset.mq;
    if (reduce) return;
    gsap.fromTo(row, { xPercent: dir < 0 ? 0 : -30 }, {
      xPercent: dir < 0 ? -30 : 0, ease: 'none',
      scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'bottom top', scrub: true }
    });
  });

  // simple reveals
  if (reduce) gsap.set('.reveal-up', { opacity: 1, y: 0 });
  else ScrollTrigger.batch('.reveal-up', {
    start: 'top 86%', once: true,
    onEnter: b => gsap.to(b, { opacity: 1, y: 0, duration: .8, stagger: .12, ease: 'power3.out' })
  });

  // fonts change caption/tag sizes → recompute once they are in
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
})();
