/* وشائج — نموذج عامل لبنية ثقافية ذكية. كل عنصر قابل للعودة إلى مصدره. */
'use strict';

/* ختم الإصدار مأخوذ من وسم السكربت، فبَمْب رقم واحد في index.html يحدّث كل الملفات */
const VER = (() => {
  const el = document.querySelector('script[src*="app.js"]');
  const m = el && el.src.match(/[?&]v=([^&]+)/);
  return m ? '?v=' + m[1] : '';
})();

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const AR = (n) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const localOrFetch = (value, path) => value
  ? Promise.resolve(value)
  : fetch(path + VER).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

const KIND_LABEL = { place:'مكان', person:'شخصية', event:'حدث', material:'مادة أرشيفية',
                     site:'موقع ثقافي مسجّل' };
const VISIBLE_KINDS = new Set(['place', 'person', 'event']);

const state = { data:null, region:'all', kind:'place', view:'map', sel:null, map:null, markers:[],
                era:{ from:0, to:0, active:false }, q:'', sites:null, limit:80, voices:null, chat:null };

/* ---------------- data helpers ---------------- */
const all = () => {
  const d = state.data;
  return [...d.places, ...d.people, ...d.events, ...d.materials];
};
const byId = (id) => all().find(x => x.id === id) ||
  (state.sites ? state.sites.rows.find(x => x.id === id) : null);
const region = () => state.data.regions.find(r => r.id === state.region)
  || state.data.regions[0];   // لا منطقة مطابقة ← «الجزيرة كاملة» بدل انهيار
const inRegion = (x) => state.region === 'all' || x.region === state.region;

/** تطبيع عربي للبحث: تشكيل وهمزات وتاء مربوطة وألف مقصورة */
const norm = (v) => String(v == null ? '' : v)
  .replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ؤئ]/g, 'ء')
  .toLowerCase();

const born = (p) => p.birth && p.birth.y;
const died = (p) => p.death && p.death.y;

/** من كان موجودًا في حياة هذه الشخصية — تقاطع فترتي العمر */
const contemporaries = (p) => state.data.people
  .filter(o => o.id !== p.id && born(o) && died(o) && born(p) && died(p)
            && born(o) <= died(p) && born(p) <= died(o))
  .sort((a,b) => born(a) - born(b));

/** أحداث وقعت في حياة الشخصية */
const eventsInLife = (p) => state.data.events
  .filter(e => born(p) && died(p) && e.year >= born(p) && e.year <= died(p))
  .sort((a,b) => a.year - b.year);

/** من كان حيًّا وقت الحدث */
const aliveAt = (year) => state.data.people
  .filter(p => born(p) && died(p) && born(p) <= year && year <= died(p))
  .sort((a,b) => born(a) - born(b));

/** أحداث قريبة زمنيًا */
const nearbyEvents = (ev, span = 40) => state.data.events
  .filter(e => e.id !== ev.id && Math.abs(e.year - ev.year) <= span)
  .sort((a,b) => a.year - b.year);

/** هل يقع العنصر داخل الفترة المختارة؟ */
function inEra(x){
  const e = state.era;
  if (!e.active) return true;
  if (x.type === 'event')    return x.year >= e.from && x.year <= e.to;
  if (x.type === 'person')   return (born(x) && died(x)) ? (born(x) <= e.to && died(x) >= e.from) : true;
  if (x.type === 'material') return x.year ? (x.year >= e.from && x.year <= e.to) : true;
  if (x.type === 'place')    return !(x.inception && x.inception.y > e.to);   // مبنى لم يُنشأ بعد
  return true;
}
/** ما يُعرض فعلًا: داخل المنطقة وداخل الفترة */
const shown = (x) => inRegion(x) && inEra(x);

/** نتائج البحث عبر كل المناطق والأنواع، أو null حين لا بحث */
function searchHits(){
  const q = norm(state.q).trim();
  if (!q) return null;
  const pool = state.sites ? all().concat(state.sites.rows) : all();
  return pool.filter(x => inEra(x) &&
    (norm(x.name).includes(q) || norm(x.blurb).includes(q) ||
     norm(x.role).includes(q) || norm(x.kind).includes(q) ||
     norm(x.gov).includes(q) || norm(x.type).includes(q)));
}

const placeEvents = (pl) => state.data.events.filter(e => e.place === pl.id);
const regionPeople = (rid) => state.data.people.filter(p => p.region === rid);

const yearsText = (p) => (born(p) && died(p))
  ? `${AR(born(p))} – ${AR(died(p))} م` : (died(p) ? `ت ${AR(died(p))} م` : '');

/* ---------------- shell ---------------- */
function renderRegions(){
  $('#regions').innerHTML = state.data.regions.map(r =>
    `<button class="region${r.id===state.region?' on':''}"
      data-region="${r.id}" aria-pressed="${r.id===state.region}">${esc(r.name)}</button>`).join('');
  $$('.region').forEach(b => b.onclick = () => selectRegion(b.dataset.region));
  $('#regionNote').textContent = region().blurb;
}

function selectRegion(id){
  state.region = id;
  state.sel = null;
  state.limit = 80;
  renderRegions();
  renderList();
  paintRegions();
  const r = region();
  frame(r, true);
  drawMarkers(); drawTimeline(); drawWeb(); renderDetail();
}

/** ينهي البحث: يمسح الحقل والحالة معًا فلا يبقى أحدهما متأخرًا عن الآخر */
function clearSearch(){
  if (!state.q) return;
  state.q = '';
  const q = $('#q');
  if (q) q.value = '';
}

function renderTabs(){
  if (!VISIBLE_KINDS.has(state.kind)) state.kind = 'place';
  $$('.tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === state.kind);
    b.setAttribute('aria-selected', b.dataset.kind === state.kind);
    b.onclick = () => {
      // البحث يعبر الأنواع، فالتبويب أثناءه كان يُعطَّل. الأوضح أن يُنهيه:
      // ضغط التبويب يمسح البحث ويعرض نوعه، فلا زرّ ميت في الواجهة.
      clearSearch();
      state.kind = b.dataset.kind; state.limit = 80; renderTabs(); renderList();
    };
  });
}

function bucket(){
  const d = state.data;
  if (!VISIBLE_KINDS.has(state.kind)) state.kind = 'place';
  if (state.kind === 'site')
    return state.sites ? state.sites.rows.filter(inRegion) : [];
  const map = { place:d.places, person:d.people, event:d.events, material:d.materials };
  return map[state.kind].filter(shown);
}

function renderList(){
  const hits = searchHits();
  const items = hits || bucket();
  const cnt = $('#count');
  const big = (n) => AR(n.toLocaleString('en-US').replace(/,/g, '٬'));
  if (cnt) cnt.textContent = `${big(items.length)} ${hits ? 'نتيجة' : 'عنصر'}`;
  $$('.tabs button').forEach(b => {
    b.disabled = false;
    b.classList.toggle('muted', !!hits);            // باهتة أثناء البحث، لا معطّلة
    b.title = hits ? 'البحث يعرض كل الأنواع — اضغط لإنهائه والعودة إلى هذا التبويب' : '';
  });
  if (hits && !items.length){
    $('#list').innerHTML = `<p class="empty">لا نتيجة لـ«${esc(state.q)}»${state.era.active ? ' داخل الفترة المختارة' : ''}.</p>`;
    return;
  }
  if (!items.length){
    $('#list').innerHTML = `<p class="empty">لا توجد ${esc(({place:'أماكن',person:'شخصيات',event:'أحداث',material:'مواد',site:'مواقع في السجل الوطني'})[state.kind])}
      في «${esc(region().name)}».</p>`;
    return;
  }
  const page = items.slice(0, state.limit);
  $('#list').innerHTML = page.map(it => {
    const thumb = it.image
      ? `<img src="${esc(it.image.url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'—'}))">`
      : `<span class="ph">${it.type==='person'?'ش':it.type==='event'?'ح':'م'}</span>`;
    const badge = (hits ? `<span class="badge">${esc(KIND_LABEL[it.type])}</span>` : '')
                + (it.featured ? '<span class="badge feat">الشخصية النموذج</span>' : '');
    return `<button class="row${state.sel===it.id?' on':''}" data-id="${esc(it.id)}" aria-pressed="${state.sel===it.id}">
      ${thumb}<span><strong>${esc(it.name)}${badge}</strong><small>${esc(subtitle(it))}</small></span></button>`;
  }).join('') + (items.length > page.length
    ? `<button class="more" id="more">عرض المزيد · بقي ${AR((items.length - page.length).toLocaleString('en-US').replace(/,/g,'٬'))}</button>`
    : '');
  $$('.row').forEach(b => b.onclick = () => select(b.dataset.id));
  const more = $('#more');
  if (more) more.onclick = () => { state.limit += 200; renderList(); };
}

const subtitle = (it) =>
  it.type === 'site'     ? `${it.kind}${it.gov ? ' · ' + it.gov : ''} · ${it.adm}`
: it.type === 'person'   ? `${it.role} · ${yearsText(it)}`
: it.type === 'event'    ? `${it.kind ? it.kind + ' · ' : ''}${AR(it.year)} م`
: it.type === 'material' ? `${it.kind} · ${it.date}`
: it.kind;

function select(id){
  if (state.sel !== id) state.whoAll = false;
  state.sel = id;
  renderList(); renderDetail(); drawWeb();
  const it = byId(id);
  if (it && it.coord && state.map) state.map.flyTo(it.coord, Math.max(state.map.getZoom(), 11), { duration:.7 });
  drawMarkers(); drawTimeline();
}

/* ---------------- detail ---------------- */
function chip(it, extra){
  return `<button class="chip" data-go="${esc(it.id)}"><b>${esc(it.name)}</b>${extra?`<i>${esc(extra)}</i>`:''}</button>`;
}

function renderDetail(){
  const box = $('#detail');
  if (state.chat && state.voices){ box.innerHTML = renderChat(); wireChat(); return; }
  let it = state.sel && byId(state.sel);
  if (!it){
    const r = region();
    box.innerHTML = `<div class="d-body">
      <p class="d-kicker">${esc(r.name)}</p>
      <h2>اختر مدخلًا لتظهر حكايته ووثائقه وصلاته</h2>
      ${r.blurb ? `<p class="txt">${esc(r.blurb)}</p>` : ''}
    </div>`;
    return;
  }

  const img = it.image ? `<div class="d-img">
      <img src="${esc(it.image.url)}" alt="${esc(it.name)}" onerror="this.closest('.d-img').remove()">
      <span class="tag">${esc(KIND_LABEL[it.type])}</span>
      ${it.imageNote ? `<span class="cap">${esc(it.imageNote)}</span>` : ''}
    </div>` : '';

  let when = '', secs = '';

  if (it.type === 'person'){
    const cons = contemporaries(it), evs = eventsInLife(it);
    when = `<p class="d-when">${esc(yearsText(it))}
      ${born(it)&&died(it) ? `<em>· ${AR(died(it)-born(it))} سنة</em>` : ''}
      ${it.hijri ? `<em>· ${esc(it.hijri)}</em>` : ''}</p>`;
    if (born(it) && died(it)) when += lifeBar(it);
    if (cons.length) secs += section('من عاصره',
      `<div class="chips">${cons.slice(0,12).map(c => chip(c, yearsText(c).replace(' م',''))).join('')}</div>`);
    if (evs.length) secs += section('أحداث في زمنه',
      `<div class="chips">${evs.map(e => chip(e, AR(e.year))).join('')}</div>`);
    if (it.timeline && it.timeline.length)
      secs += section('محطات من سيرته',
        `<ol class="tl">${it.timeline.map(m => `<li>
           <span class="tl-y">${AR(m.y)}</span>
           <span class="tl-t">${esc(m.t)}<em class="tl-s">${esc(m.s)}</em></span></li>`).join('')}</ol>`);
    if (state.voices && state.voices.voices[it.id])
      secs += `<button class="talk" data-talk="${esc(it.id)}">ابدأ الحوار ↩</button>`;
  }

  if (it.type === 'event'){
    const alive = aliveAt(it.year), near = nearbyEvents(it);
    const pl = it.place && byId(it.place);
    when = `<p class="d-when">${AR(it.year)}${it.endYear&&it.endYear!==it.year?` – ${AR(it.endYear)}`:''} م
      ${it.hijri ? `<em>· ${esc(it.hijri)}</em>` : ''}${pl ? `<em>· ${esc(pl.name)}</em>` : ''}</p>`;
    const docs = eventDocs(it);
    if (it.narratives && it.narratives.length)
      secs += section('من كتب التاريخ',
        it.narratives.filter(nv => nv.ar).map(nv =>
          `<div class="narr"><p class="narr-ar">${esc(nv.ar)}</p></div>`).join(''));

    if (docs.length) secs += section('وثائق ومواد',
      `<div class="chips">${docs.map(m => chip(m, m.date)).join('')}</div>`);

    if (alive.length){
      const cap = state.whoAll ? alive.length : 6;
      const rows = alive.slice(0, cap).map(p =>
        `<li><button class="who-go" data-go="${esc(p.id)}">
           <b>${esc(p.name)}</b><i>${esc(yearsText(p).replace(' م',''))}</i></button>` +
        (state.voices && state.voices.voices[p.id]
          ? `<button class="who-ask" data-ask-about="${esc(p.id)}" data-event="${esc(it.id)}"
               title="اسأله عن ${esc(it.name)}" aria-label="اسأله عن ${esc(it.name)}">↩</button>` : '') +
        `</li>`).join('');
      secs += section('من كان في زمنه', `<ul class="who">${rows}</ul>` +
        (alive.length > cap
          ? `<button class="more-who" id="moreWho">عرض الباقي · ${AR(alive.length - cap)}</button>`
          : (state.whoAll && alive.length > 6
              ? `<button class="more-who" id="moreWho">طيّ القائمة</button>` : '')));
    }
    if (near.length) secs += section('أحداث قريبة',
      `<div class="chips">${near.slice(0,12).map(e => chip(e, AR(e.year))).join('')}</div>`);
  }

  if (it.type === 'place'){
    const evs = placeEvents(it), ppl = regionPeople(it.region);
    when = `<p class="d-when">${esc(it.kind)}${it.inception ? ` <em>· يذكر المصدر ${AR(it.inception.y)}</em>` : ''}</p>`;
    if (evs.length) secs += section('أحداث في هذا المكان',
      `<div class="chips">${evs.map(e => chip(e, AR(e.year))).join('')}</div>`);
    if (ppl.length) secs += section(`شخصيات من ${esc(region().name)}`,
      `<div class="chips">${ppl.map(p => chip(p, yearsText(p).replace(' م',''))).join('')}</div>`);
  }

  if (it.type === 'material'){
    when = `<p class="d-when">${esc(it.kind)} <em>· ${esc(it.date)}</em></p>`;
  }

  if (it.type === 'site'){
    const src = state.sites && state.sites.source;
    when = `<p class="d-when">${esc(it.kind)}<em>${it.gov ? ' · ' + esc(it.gov) : ''} · ${esc(it.adm)}</em></p>`;
    secs += section('البيانات المتاحة في السجل', `<ul class="detail-meta">
      <li><b>الصنف</b><span>${esc(it.kind)}</span></li>
      <li><b>المنطقة الإدارية</b><span>${esc(it.adm)}</span></li>
      ${it.gov ? `<li><b>المحافظة</b><span>${esc(it.gov)}</span></li>` : ''}
      <li><b>الإحداثي</b><span>غير منشور</span></li>
      <li><b>التاريخ</b><span>غير منشور</span></li></ul>`);
    it = Object.assign({}, it, {
      blurb: 'موقع وارد في البيانات المنشورة لوزارة الثقافة. تتاح حاليًا هويته وتصنيفه ونطاقه الإداري.',
      note: 'لا تتضمن البيانات المنشورة إحداثيات هذا الموقع؛ لذلك لا نضعه على الخريطة قبل استكمال التوثيق من مصدر إضافي أو مسح ميداني.',
      tier: 'official',
      source: (src && src.url) || '#',
      sourceName: src ? `${src.publisher} · ${src.title}` : 'المصدر'
    });
  }

  box.innerHTML = `${img}<div class="d-body">
    <p class="d-kicker">${esc(ownRegionName(it))} · ${esc(it.role || it.kind || KIND_LABEL[it.type])}</p>
    <h2>${esc(it.name)}</h2>
    ${when}
    ${it.blurb ? `<p class="txt">${esc(it.blurb)}</p>` : ''}
    ${secs}
  </div>`;

  const mw = $('#moreWho');
  if (mw) mw.onclick = () => { state.whoAll = !state.whoAll; renderDetail(); };

  const talk = $('#detail [data-talk]');
  if (talk) talk.onclick = () => openChat(talk.dataset.talk);
  $$('#detail [data-ask-about], #detail .who-ask').forEach(b => b.onclick = () => {
    const ev = byId(b.dataset.event);
    openChat(b.dataset.askAbout);
    if (ev) setTimeout(() => sendChat(`ماذا تعرف عن ${ev.name}؟`), 60);
  });
  $$('#detail .chip[data-go], #detail .who-go').forEach(b => b.onclick = () => {
    const t = byId(b.dataset.go);
    if (!t) return;
    // بعض الأشخاص بلا منطقة محدَّدة؛ لا ننقل الشريط إلى قيمة لا وجود لها
    const known = t.region && state.data.regions.some(r => r.id === t.region);
    if (known && t.region !== state.region) { state.region = t.region; renderRegions(); }
    state.kind = t.type; renderTabs(); renderList(); select(t.id);
  });
}

/** منطقة العنصر نفسه لا المنطقة المختارة في الشريط — فالبحث يعبر المناطق */
function ownRegionName(it){
  const r = it.region && state.data.regions.find(x => x.id === it.region);
  return r ? r.name : 'لم يحدّد المصدر منطقته';
}

const section = (title, html) => `<div class="d-sec"><h3>${esc(title)}</h3>${html}</div>`;

function lifeBar(p){
  const [lo, hi] = span();
  const a = ((born(p) - lo) / (hi - lo)) * 100, b = ((died(p) - lo) / (hi - lo)) * 100;
  return `<div class="lifebar"><i style="inset-inline-start:${a}%;width:${Math.max(b-a,1.5)}%"></i></div>
    <div class="lifescale"><span>${AR(lo)}</span><span>${AR(hi)}</span></div>`;
}

function span(){
  // الشخصية المعلَنة خارج نطاق المشروع لا تمدّ المحور، وإلا امتدّ عقودًا فارغة لأجل واحد
  const ys = [...state.data.people.filter(p => !p.outsideWindow).flatMap(p => [born(p), died(p)]),
              ...state.data.events.flatMap(e => [e.year, e.endYear])]
             .filter(v => typeof v === 'number' && isFinite(v));
  if (!ys.length) return [1700, 1960];
  return [Math.floor(Math.min(...ys)/50)*50, Math.ceil(Math.max(...ys)/50)*50];
}

/* ---------------- map ---------------- */
/** منطقة لها حدود تُلاءم حجم الشاشة؛ وإلا مركز وتقريب ثابتان */
function frame(r, animate){
  if (!state.map) return;
  if (r.bounds) state.map.fitBounds(r.bounds, { padding:[12,12], animate: !!animate });
  else if (animate) state.map.flyTo(r.center, r.zoom, { duration:.8 });
  else state.map.setView(r.center, r.zoom);
}

/** الحدث بلا إحداثي في المصدر يُعرض عند مركز منطقته، موسومًا بأنه تقريبي */
function eventCoord(e){
  if (e.coord) return { at:e.coord, approx:false };
  const r = state.data.regions.find(x => x.id === e.region);
  return r ? { at:r.center, approx:true } : null;
}

/** ما الذي يجمع حدثين: المكان نفسه دائمًا، وصلة الأشخاص للحدث المختار فقط
 *  — لأن ربط كل حدثين تشاركا شخصية يُنتج مئات الخطوط ويطمس الخريطة. */
function eventLinks(evs, selId){
  const out = [];
  const share = (a, b) => state.data.people.filter(p => born(p) && died(p) &&
    born(p) <= a.year && a.year <= died(p) && born(p) <= b.year && b.year <= died(p));

  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++){
    const a = evs[i], b = evs[j];
    if (a.place && a.place === b.place){
      const pl = byId(a.place);
      out.push({ a, b, kind:'place', why:`المكان نفسه: ${pl ? pl.name : ''}` });
    }
  }
  if (selId){
    const sel = evs.find(e => e.id === selId);
    if (sel) evs.forEach(o => {
      if (o.id === sel.id) return;
      const both = share(sel, o);
      if (both.length) out.push({ a:sel, b:o, kind:'person',
        why:`عاشهما معًا ${AR(both.length)}: ${both.slice(0,4).map(x => x.name).join('، ')}${both.length > 4 ? '، وغيرهم' : ''}` });
    });
  }
  return out.slice(0, 60);
}

/** مواد من المنطقة نفسها وفترة قريبة — قاعدة معلنة، لا ربط تحريري */
const DOC_WINDOW = 25;
const eventDocs = (e) => state.data.materials.filter(m =>
  m.region === e.region && m.year && Math.abs(m.year - e.year) <= DOC_WINDOW);

function initMap(){
  if (!window.L){ $('#map').innerHTML = '<p class="empty">تعذّر تحميل الخريطة. تصفّح الفهرس والزمن.</p>'; return; }
  const r = region();
  state.map = L.map('map', { scrollWheelZoom:false, zoomControl:false, attributionControl:false, minZoom:3, maxZoom:16 })
               .setView(r.center, r.zoom);
  frame(r, false);
  L.control.zoom({ position:'bottomleft' }).addTo(state.map);

  // تفاصيل الشوارع تظهر وحدها عند التقريب، مصبوغة لتبقى في مزاج الورق القديم.
  // كانت بلاطات OpenStreetMap، وسياستها تحظر أحيانًا («سوء استخدام»)؛ فصارت من OpenFreeMap: بلا مفتاح ولا حدّ.
  state.map.on('zoomend', loadDetail);
  loadDetail();

  drawGraticule();
  localOrFetch(window.WASHAIJ_LAND, './land.geojson').then(land => {
    state.land = L.geoJSON(land, {
      style: f => ({
        color:'#8a7350', weight: f.properties.focus ? 1.6 : 0.9,
        opacity:.85, fillColor: f.properties.focus ? '#eee1c2' : '#dacba6', fillOpacity:1
      }),
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties.ar,
        { className:'land-label', permanent:false, direction:'center' })
    }).addTo(state.map);
    state.land.bringToBack();
    return localOrFetch(window.WASHAIJ_REGIONS, './regions.geojson').then(drawRegions);
  }).then(syncBase).catch(() => {});

  state.map.on('zoomend', syncBase);
  drawMarkers();
  setTimeout(() => state.map.invalidateSize(), 250);
}

/** لون لكل منطقة، في مدى ألوان الورق القديم */
const REGION_TINT = {
  najd:'#e8cf96', eastern:'#c9d3b4', south:'#e0bd8e', north:'#d5d5bd', hijaz:'#eccfae'
};

/** مناطق المشروع مرسومة على الخريطة؛ الضغط عليها يفتحها */
function drawRegions(gj){
  if (gj.bounds) state.data.regions.forEach(r => { if (gj.bounds[r.id]) r.bounds = gj.bounds[r.id]; });

  state.regionLayer = L.geoJSON(gj, {
    style: f => regionStyle(f.properties.rid),
    onEachFeature: (f, layer) => {
      const rid = f.properties.rid;
      layer.bindTooltip(f.properties.adm, { className:'land-label', direction:'center', sticky:true });
      layer.on('click', () => selectRegion(rid));
      layer.on('mouseover', () => { if (state.region !== rid) layer.setStyle(regionStyle(rid, true)); });
      layer.on('mouseout',  () => layer.setStyle(regionStyle(rid)));
    }
  }).addTo(state.map);
  if (state.land) state.land.bringToBack();

  // اسم كل منطقة في وسطها، يظهر في العرض الشامل فقط
  state.regionLabels = L.layerGroup().addTo(state.map);
  Object.entries(gj.bounds || {}).forEach(([rid, b]) => {
    const r = state.data.regions.find(x => x.id === rid);
    if (!r) return;
    const at = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    state.regionLabels.addLayer(L.marker(at, {
      interactive:false,
      icon: L.divIcon({ className:'region-name', html:esc(r.name), iconSize:[92,20], iconAnchor:[46,10] })
    }));
  });
}

function regionStyle(rid, hover){
  const on = state.region === rid;
  return { color: on ? '#5c4a2c' : '#a08a5e', weight: on ? 2 : .8,
           opacity: on ? .95 : .5,
           fillColor: REGION_TINT[rid] || '#e7dabd',
           fillOpacity: on ? .95 : (hover ? .8 : .62) };
}

function paintRegions(){
  if (!state.regionLayer) return;
  state.regionLayer.eachLayer(l => l.setStyle(regionStyle(l.feature.properties.rid)));
}

/** الأرض المرسومة تختفي تدريجيًا لتكشف الشوارع عند التقريب */
/* خلفية التفاصيل: خريطةٌ متّجهة من OpenFreeMap (مجانية، بلا مفتاح ولا حدّ طلبات، والاستعمال التجاري مسموح)،
   تُحمَّل مكتبتها عند أول تقريب فلا تثقل الصفحة، وبلا أسماء: فأسماء المواضع من وشائج نفسها. */
const DETAIL = {
  zoom: 8,                                  // يبدأ التحميل قبل ظهور التفاصيل (٩) بدرجة
  style: 'https://tiles.openfreemap.org/styles/positron',
  js: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  css: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  plugin: 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js',
  credit: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · '
        + '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · '
        + '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>'
};

/* الإسناد: تشترطه رخصة OpenStreetMap وOpenFreeMap ما دامت تفاصيل الشوارع ظاهرة، ولا يلزم في العرض الشامل
   (حدود Natural Earth ملكٌ عام). يظهر مختصرًا مع التفاصيل، ثم ينطوي بعد خمس ثوانٍ إلى زرّ (i) —
   كما تجيز إرشادات OpenStreetMap — ويعود بالضغط عليه. */
function syncCredit(show){
  if (!state.credit){
    const c = L.control({ position:'bottomright' });
    c.onAdd = () => {
      const d = L.DomUtil.create('div', 'map-credit');
      d.innerHTML = `<button type="button" aria-label="مصادر الخريطة" aria-expanded="true">i</button><span>${DETAIL.credit}</span>`;
      const b = d.querySelector('button');
      b.onclick = () => { const open = d.classList.toggle('shut') === false; b.setAttribute('aria-expanded', open); };
      L.DomEvent.disableClickPropagation(d);
      return d;
    };
    state.credit = c;
  }
  const on = !!state.credit._map;
  if (show && !on){
    state.credit.addTo(state.map);
    const d = state.credit.getContainer();
    clearTimeout(state.creditTimer);
    state.creditTimer = setTimeout(() => { d.classList.add('shut'); d.querySelector('button').setAttribute('aria-expanded', 'false'); }, 5000);
  } else if (!show && on){
    clearTimeout(state.creditTimer);
    state.credit.remove();
  }
}
const loadScript = (src) => new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s);
});
function loadDetail(){
  if (state.detail || !state.map || state.map.getZoom() < DETAIL.zoom) return;
  state.detail = 'loading';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = DETAIL.css; document.head.appendChild(css);
  Promise.all([loadScript(DETAIL.js).then(() => loadScript(DETAIL.plugin)), fetch(DETAIL.style).then(r => r.json())])
    .then(([, style]) => {
      style.layers = style.layers.filter(l => l.type !== 'symbol');   // بلا أسماء ولا أرقام طرق
      state.tiles = L.maplibreGL({ style, interactive: false }).addTo(state.map);
      state.detail = 'ready';
      syncBase();
    })
    .catch(() => { state.detail = 'failed'; });   // تعذّر التحميل: تبقى الخريطة العتيقة وحدها، بلا تفاصيل شوارع
}

function syncBase(){
  if (!state.map) return;
  const z = state.map.getZoom(), close = z >= 9;
  document.getElementById('map').classList.toggle('close-up', close);
  syncCredit(close && state.detail === 'ready');
  if (state.land) state.land.setStyle(f => ({
    color:'#8a7350', weight: f.properties.focus ? 1.6 : 0.9,
    opacity: close ? .5 : .85,
    fillColor: f.properties.focus ? '#eee1c2' : '#dacba6',
    fillOpacity: close ? 0 : 1
  }));
  if (state.regionLayer) state.regionLayer.eachLayer(l => {
    const st = regionStyle(l.feature.properties.rid);
    l.setStyle(close ? { ...st, fillOpacity:0, opacity:.45 } : st);
  });
  document.getElementById('map').classList.toggle('wide-view', z <= 7);
}

/** شبكة خطوط الطول والعرض — ملمح الخرائط القديمة */
function drawGraticule(){
  const g = L.layerGroup().addTo(state.map);
  const opt = { color:'#a8946c', weight:.7, opacity:.55, dashArray:'2 6', interactive:false };
  for (let lon = 25; lon <= 70; lon += 5) g.addLayer(L.polyline([[5,lon],[42,lon]], opt));
  for (let lat = 5; lat <= 40; lat += 5) g.addLayer(L.polyline([[lat,25],[lat,70]], opt));
  g.eachLayer(l => l.bringToBack());
}

function drawMarkers(){
  if (!state.map) return;
  state.markers.forEach(m => state.map.removeLayer(m));
  if (state.links){ state.links.forEach(l => state.map.removeLayer(l)); }
  state.links = [];

  const visible = [];
  all().filter(shown).forEach(x => {
    if (x.type === 'event'){ const c = eventCoord(x); if (c) visible.push(Object.assign({}, x, { at:c.at, approx:c.approx })); }
    else if (x.coord) visible.push(Object.assign({}, x, { at:x.coord, approx:false }));
  });

  // خطوط الصلة بين الأحداث تُرسم أولًا لتبقى تحت الدبابيس
  const evs = visible.filter(x => x.type === 'event');
  const pos = Object.fromEntries(evs.map(e => [e.id, e.at]));
  eventLinks(evs, state.sel).forEach(l => {
    const line = L.polyline([pos[l.a.id], pos[l.b.id]], {
      color: l.kind === 'place' ? '#8a6a4a' : '#a9762f',
      weight: l.kind === 'place' ? 2.2 : 1.6,
      opacity: .6, dashArray: l.kind === 'place' ? null : '5 6', interactive: true
    }).addTo(state.map);
    line.bindTooltip(`${esc(l.a.name)} ↔ ${esc(l.b.name)}<br><em>${esc(l.why)}</em>`, { sticky:true });
    state.links.push(line);
  });

  visible.filter(x => x.proposed && x.uncertaintyKm && state.sel === x.id).forEach(x => {
    state.links.push(L.circle(x.at, { radius:x.uncertaintyKm*1000, color:'#a9762f', weight:1.2,
      opacity:.75, dashArray:'4 5', fillColor:'#c79a5c', fillOpacity:.1 }).addTo(state.map)
      .bindTooltip(`هامش عدم اليقين ±${AR(x.uncertaintyKm)} كم`, { sticky:true }));
  });

  const seats = {};
  visible.forEach(x => { const k = x.at.join(','); (seats[k] = seats[k] || []).push(x.id); });
  // نوع كل عنصر مرة واحدة؛ نداء byId داخل الحلقة كان يعيد بناء السجل كله لكل دبوس
  const typeOf = new Map(visible.map(x => [x.id, x.type]));
  state.markers = visible.map(x => {
    const on = state.sel === x.id;
    const size = x.type === 'event' ? 22 : x.type === 'place' ? 17 : 14;
    const group = seats[x.at.join(',')];
    let at = x.at;
    if (group.length > 1){
      // المكان يبقى على إحداثيه بالضبط؛ ما سواه يتحلّق حوله في أطواق
      // يتّسع نصف قطرها مع العدد، لئلا يحجب أربعون شخصًا بلدتَهم.
      const anchor = group.find(id => typeOf.get(id) === 'place');
      const ring = group.filter(id => id !== anchor);
      const i = ring.indexOf(x.id);
      if (i >= 0){
        const per = 12, lap = Math.floor(i / per), k = i % per;
        const n = Math.min(per, ring.length - lap * per);
        const a = (k / n) * Math.PI * 2 + lap * 0.26;
        const R = 0.0042 * (lap + 1);
        at = [x.at[0] + R*Math.cos(a), x.at[1] + R*Math.sin(a) / Math.cos(x.at[0]*Math.PI/180)];
      }
    }
    const icon = L.divIcon({ className:`pin pin-${x.type}${on?' sel':''}${x.approx?' approx':''}${x.proposed && x.tier!=='reviewed' ?' proposed':''}${x.tier==='reviewed'?' reviewed':''}`,
      iconSize:[size,size], iconAnchor:[size/2,size/2] });
    // ليفلت يشتقّ zIndex من خط العرض بقيم تبلغ عشرات الألوف،
    // فالإزاحة تحتاج أن تكون أكبر منها لتغلبها لا لتُبتلع فيها.
    const zi = x.type === 'place' ? 4e6 : x.type === 'event' ? 2e6 : 0;
    return L.marker(at, { icon, title:x.name, zIndexOffset:zi, riseOnHover:true })
      .addTo(state.map)
      .bindPopup(`<span class="pop-kind">${esc(KIND_LABEL[x.type])}</span><strong>${esc(x.name)}</strong><br>${esc(subtitle(x))}` +
        '')
      .on('click', () => { state.kind = x.type; renderTabs(); renderList(); select(x.id); });
  });
}

/* ---------------- timeline ---------------- */
function drawTimeline(){
  const [lo, hi] = span(), W = hi - lo;
  const pos = (y) => ((y - lo) / W) * 100;
  const inScope = state.data.people.filter(shown);
  const people = inScope.filter(p => born(p) && died(p)).sort((a,b) => born(a)-born(b));
  const undated = inScope.length - people.length;
  const events = state.data.events.filter(shown).sort((a,b) => a.year - b.year);

  const ticks = [];
  for (let y = lo; y <= hi; y += 50) ticks.push(`<span style="inset-inline-start:${pos(y)}%">${AR(y)}</span>`);

  // أحداث متقاربة زمنيًا تتراكب تسمياتها، فننزل المتأخر منها درجة
  let lastPos = -99, lvl = 0, maxLvl = 0;
  const placed = events.map(e => {
    const x = pos(e.year);
    lvl = (x - lastPos < 7) ? lvl + 1 : 0;
    lastPos = x; maxLvl = Math.max(maxLvl, lvl);
    return { e, x, lvl };
  });
  const evRow = events.length ? `<p class="tl-head">أحداث</p>
    <div class="tl-row" style="height:${50 + maxLvl*17}px">${placed.map(({e,x,lvl}) =>
      `<button class="tl-ev${state.sel===e.id?' on':''}" data-id="${esc(e.id)}" title="${esc(e.name)}"
        style="inset-inline-start:${x}%;top:${lvl*17}px"><i></i><u></u><b>${AR(e.year)}</b></button>`).join('')}</div>` : '';

  const shownPpl = people.slice(0, 40);
  const pplRow = shownPpl.length ? `<p class="tl-head">فترات حياة${people.length > 40
      ? ` · تُعرض ${AR(40)} من ${AR(people.length)}` : ''}</p>${shownPpl.map(p =>
    `<div class="tl-row"><button class="tl-bar${state.sel===p.id?' on':''}" data-id="${esc(p.id)}"
      style="inset-inline-start:${pos(born(p))}%;width:${Math.max(pos(died(p))-pos(born(p)),9)}%"
      title="${esc(p.name)} (${AR(born(p))}–${AR(died(p))})"><b>${esc(p.name)}</b></button></div>`).join('')}` : '';

  $('#timeline').innerHTML = `<div class="tl-axis">${ticks.join('')}</div>${evRow}${pplRow}` +
    (!events.length && !people.length
      ? `<p class="empty">لا شيء في «${esc(region().name)}» ضمن هذه الفترة.</p>` : '');

  $$('#timeline [data-id]').forEach(b => b.onclick = () => {
    const t = byId(b.dataset.id); state.kind = t.type; renderTabs(); renderList(); select(t.id);
  });
}

/* ---------------- ego web ---------------- */
/** اسم طويل على سطرين بدل قصّه */
function wrapLabel(name, max = 17, lines = 2){
  const words = String(name).split(' ');
  const out = [];
  let cur = '';
  for (const w of words){
    if (!cur) { cur = w; }
    else if ((cur + ' ' + w).length <= max) { cur += ' ' + w; }
    else { out.push(cur); cur = w; if (out.length === lines - 1) break; }
  }
  if (cur && out.length < lines) out.push(cur);
  const used = out.join(' ').length;
  if (used < String(name).length) out[out.length-1] = out[out.length-1] + '…';
  return out;
}

/** عقد الشبكة وحوافها للنطاق المعروض */
function webModel(){
  const d = state.data;
  const scope = x => shown(x);
  const places = d.places.filter(scope), people = d.people.filter(scope);
  const events = d.events.filter(scope), mats = d.materials.filter(scope);
  const regions = d.regions.filter(r => r.id !== 'all' &&
    (state.region === 'all' ? [...places,...people,...events,...mats].some(x => x.region === r.id)
                            : r.id === state.region));

  const crowded = (places.length + people.length + events.length + mats.length) > 90;
  const nodes = [
    ...regions.map(r => ({ id:'r_'+r.id, kind:'region', name:r.name, rid:r.id, r:20 })),
    ...places.map(x => ({ id:x.id, kind:'place',    name:x.name, rid:x.region, r:12 })),
    ...(crowded ? [] : people.map(x => ({ id:x.id, kind:'person', name:x.name, rid:x.region, r:12 }))),
    ...events.map(x => ({ id:x.id, kind:'event',    name:x.name, rid:x.region, r:11 })),
    ...(crowded ? [] : mats.map(x => ({ id:x.id, kind:'material', name:x.name, rid:x.region, r:8 }))),
  ];
  state.webCrowded = crowded;
  const has = new Set(nodes.map(n => n.id));
  const edges = [];
  const link = (a, b, w) => { if (has.has(a) && has.has(b)) edges.push([a, b, w]); };

  nodes.forEach(n => { if (n.kind !== 'region') link(n.id, 'r_' + n.rid, 'tie'); });
  events.forEach(e => { if (e.place) link(e.id, e.place, 'at'); });
  people.forEach(p => eventsInLife(p).filter(scope).forEach(e => link(p.id, e.id, 'era')));
  return { nodes, edges };
}

/** توزيع قوى بسيط: تنافر بين العقد، وزنبرك على الحواف، وشدّ نحو المركز */
function layout(nodes, edges, w, h, iters){
  const N = nodes.length;
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    n.x = w/2 + Math.cos(a) * w * .31; n.y = h/2 + Math.sin(a) * h * .31; n.vx = n.vy = 0;
  });
  const at = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  for (let it = 0; it < iters; it++){
    const cool = 1 - it / iters;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++){
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx*dx + dy*dy || .01, d = Math.sqrt(d2);
      const f = Math.min(5200 / d2, 45), ux = dx/d, uy = dy/d;
      a.vx -= ux*f; a.vy -= uy*f; b.vx += ux*f; b.vy += uy*f;
    }
    edges.forEach(([sa, sb, kind]) => {
      const a = nodes[at[sa]], b = nodes[at[sb]];
      if (!a || !b) return;
      const rest = kind === 'tie' ? 96 : 74;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .01;
      const f = (d - rest) * .022, ux = dx/d, uy = dy/d;
      a.vx += ux*f; a.vy += uy*f; b.vx -= ux*f; b.vy -= uy*f;
    });
    nodes.forEach(n => {
      n.vx += (w/2 - n.x) * .0045; n.vy += (h/2 - n.y) * .0045;
      n.x += n.vx * cool * .5; n.y += n.vy * cool * .5;
      n.vx *= .82; n.vy *= .82;
      n.x = Math.max(n.r + 6, Math.min(w - n.r - 6, n.x));
      n.y = Math.max(n.r + 6, Math.min(h - n.r - 18, n.y));
    });
  }
}

function drawWeb(){
  const svg = $('#web');
  if (!state.data) return;
  const W = 760, H = 520;
  const key = state.region + '|' + (state.era.active ? state.era.from + '-' + state.era.to : 'كل');
  if (!state.web || state.web.key !== key){
    const m = webModel();
    if (!m.nodes.length){
      svg.innerHTML = `<text class="web-empty" x="${W/2}" y="${H/2}">لا عناصر موثّقة في هذه المنطقة بعد</text>`;
      state.web = { key, nodes:[], edges:[] };
      return;
    }
    const iters = Math.max(70, Math.min(300, Math.round(26000 / Math.max(m.nodes.length, 1))));
    layout(m.nodes, m.edges, W, H, iters);
    state.web = { key, ...m };
  }
  const { nodes, edges } = state.web;
  if (!nodes.length){
    svg.innerHTML = `<text class="web-empty" x="${W/2}" y="${H/2}">لا عناصر موثّقة في هذه المنطقة بعد</text>`;
    return;
  }
  const at = Object.fromEntries(nodes.map(n => [n.id, n]));
  const sel = state.sel;
  const near = new Set();
  if (sel) edges.forEach(([a, b]) => { if (a === sel) near.add(b); if (b === sel) near.add(a); });

  const eSvg = edges.map(([a, b, kind]) => {
    const A = at[a], B = at[b];
    if (!A || !B) return '';
    const hot = sel && (a === sel || b === sel);
    const dim = sel && !hot;
    const why = kind === 'tie' ? 'ضمن منطقة' : kind === 'at' ? 'وقع في' : 'عاش في زمن';
    return `<line class="edge e-${kind}${hot ? ' hot' : ''}${dim ? ' dim' : ''}"
      x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}"
      ><title>${esc(A.name)} — ${why} — ${esc(B.name)}</title></line>`;
  }).join('');

  const nSvg = nodes.map(n => {
    const isSel = n.id === sel, isNear = near.has(n.id);
    const dim = sel && !isSel && !isNear;
    const label = n.kind === 'region' || isSel || isNear || nodes.length <= 20;
    const clickable = n.kind !== 'region';
    return `<g class="node ${n.kind}${isSel ? ' on' : ''}${dim ? ' dim' : ''}"
        ${clickable ? `data-id="${esc(n.id)}" tabindex="0" role="button"` : `data-region="${esc(n.rid)}" tabindex="0" role="button"`}
        aria-label="${esc(n.name)}">
      <title>${esc(n.name)}</title>
      <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}"/>
      ${label ? wrapLabel(n.name, n.kind === 'region' ? 14 : 16).map((line, li) =>
        `<text x="${n.x.toFixed(1)}" y="${(n.y + n.r + 13 + li*12).toFixed(1)}">${esc(line)}</text>`).join('') : ''}
    </g>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = eSvg + nSvg + (state.webCrowded
    ? `<text class="web-empty" x="${W/2}" y="${H-8}">النطاق واسع، فتُعرض المناطق والأماكن والأحداث فقط — اختر منطقة لترى شخصياتها</text>`
    : '');

  $$('#web .node').forEach(g => {
    const go = () => {
      if (g.dataset.id){
        const t = byId(g.dataset.id);
        if (!t) return;
        state.kind = t.type; renderTabs(); renderList(); select(t.id);
      } else if (g.dataset.region && g.dataset.region !== state.region){
        selectRegion(g.dataset.region);
      }
    };
    g.onclick = go;
    g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } };
  });
}

/* ---------------- الافتتاح والفترات ---------------- */
function playIntro(){
  const el = $('#intro');
  if (!el) return;
  const logo = $('.intro-logo');
  const introMap = $('.intro-map');
  const target = $('.topbar .brand img');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.add('intro-active');
  if (reduce){
    el.remove();
    document.body.classList.remove('intro-active');
    return;
  }

  let started = false;
  const merge = () => {
    if (started) return;
    started = true;
    const from = logo.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = Math.max(.12, to.width / from.width);
    target.style.opacity = '0';

    logo.animate([
      { transform:'translate(0,0) scale(1)', opacity:1 },
      { transform:`translate(${dx}px,${dy}px) scale(${scale})`, opacity:1, offset:.76 },
      { transform:`translate(${dx}px,${dy}px) scale(${scale})`, opacity:0 }
    ], { duration:780, easing:'cubic-bezier(.4,0,.2,1)', fill:'forwards' });
    introMap?.animate([
      { transform:'translateZ(0) scale(1)', opacity:.82 },
      { transform:'translateZ(0) scale(1.04)', opacity:.54, offset:.5 },
      { transform:'translateZ(0) scale(1.07)', opacity:0 }
    ], { duration:860, easing:'cubic-bezier(.2,.75,.2,1)', fill:'forwards' });
    el.animate([
      { opacity:1 },
      { opacity:1, offset:.2 },
      { opacity:0 }
    ], { duration:880, easing:'ease-out', fill:'forwards' });
    target.animate([
      { opacity:0 },
      { opacity:0, offset:.62 },
      { opacity:1 }
    ], { duration:800, easing:'ease-out', fill:'forwards' });
    $('.layout')?.animate([
      { opacity:.45, transform:'translateZ(0) scale(1.008)' },
      { opacity:1, transform:'translateZ(0) scale(1)' }
    ], { duration:880, easing:'cubic-bezier(.2,.75,.2,1)' });

    setTimeout(() => {
      el.remove();
      target.style.opacity = '';
      document.body.classList.remove('intro-active');
      if (state.map) state.map.invalidateSize();
    }, 920);
  };
  el.addEventListener('click', merge, { once:true });
  setTimeout(merge, 1100);
}

/** فترات مسماة، حدودها مأخوذة من تواريخ أحداث موثّقة في السجل */
const PERIODS = [
  { id:'all',    name:'كل الفترات', span:null },
  { id:'first',  name:'الدولة السعودية الأولى', span:[1727, 1818] },
  { id:'between',name:'بين الدولتين والثانية',  span:[1818, 1902] },
  { id:'unify',  name:'التوحيد والتأسيس',       span:[1902, 1932] },
  { id:'after',  name:'بعد التأسيس',            span:[1932, 1990] },
];

function renderPeriods(){
  const box = $('#periods');
  if (!box) return;
  const cur = state.era.active ? `${state.era.from}-${state.era.to}` : 'all';
  box.innerHTML = PERIODS.map(p => {
    const on = p.span ? cur === `${p.span[0]}-${p.span[1]}` : cur === 'all';
    return `<button class="period${on ? ' on' : ''}" data-period="${p.id}" aria-pressed="${on}">
      <b>${esc(p.name)}</b><small>${p.span ? AR(p.span[0]) + ' – ' + AR(p.span[1]) + ' م' : 'من ' + AR(1650) + ' إلى ' + AR(2000)}</small></button>`;
  }).join('');
  $$('.period').forEach(b => b.onclick = () => {
    const per = PERIODS.find(x => x.id === b.dataset.period);
    const from = $('#eraFrom'), to = $('#eraTo');
    if (!per.span){ from.value = from.min; to.value = to.max; }
    else { from.value = per.span[0]; to.value = per.span[1]; }
    from.dispatchEvent(new Event('input'));
  });
}

/* ---------------- الشخصيات المتكلّمة ---------------- */
function loadVoices(){
  return localOrFetch(window.WASHAIJ_VOICES, './voices.json')
    .then(v => { state.voices = v; renderDetail(); })
    .catch(() => {});
}

/** نصّ رفضٍ أخير، فلا تخرج فقاعةٌ فارغة إن نقص الحقل من السجل */
const FALLBACK_REFUSAL = 'ليس في السجل الذي أتكلّم منه سندٌ لهذا، فلا أقوله.';

/** يطابق السؤال بموضوع موثّق؛ وما لا يطابق تعتذر عنه الشخصية */
function answer(pid, q){
  const v = state.voices && state.voices.voices[pid];
  if (!v) return { text:'السجل غير محمّل بعد.', sources:[] };
  const n = norm(q);
  if (!n.trim()) return null;

  if (v.guard && v.guard[0].split('|').some(k => n.includes(norm(k))))
    return { text: v.guard[1], sources: [], guard: true };

  // أقوى موضوع موثّق عند هذه الشخصية
  let best = null, bestScore = 0;
  for (const t of v.topics){
    let score = 0;
    for (const k of t.keys.split('|')){
      const key = norm(k);
      if (key && n.includes(key)) score += key.length;   // المطابقة الأطول أرجح
    }
    if (score > bestScore){ bestScore = score; best = t; }
  }

  // سؤال عن حدث بعينه: الجواب من سجل الحدث نفسه — بشرط مطابقةٍ دالّة،
  // لا كلمةٍ عابرة، وإلا ابتلع الحدثُ أسئلةً حقّها موضوعُ رفضٍ صريح.
  const p = state.data.people.find(x => x.id === pid);
  if (p){
    let hit = null, hitScore = 0;
    for (const e of eventsInLife(p)){
      const words = norm(e.name).split(' ').filter(w => w.length > 3);
      const got = words.filter(w => n.includes(w));
      // كلمتان دالّتان، أو كلمة واحدة طويلة لا تلتبس
      const ok = got.length >= 2 || got.some(w => w.length >= 6);
      const sc = ok ? got.reduce((a,w) => a + w.length, 0) : 0;
      if (sc > hitScore){ hitScore = sc; hit = e; }
    }
    if (hit && hitScore >= bestScore) return {
      text: `${hit.name} سنة ${AR(hit.year)}م` + (hit.hijri ? ` (${hit.hijri})` : '') +
            (hit.blurb ? `. ${hit.blurb}` : '.') +
            (hit.note ? ` ${hit.note}` : '') +
            ` وقع هذا في سنوات حياتي (${yearsText(p).replace(' م','')}).`,
      sources: [{ label:hit.sourceName, url:hit.source, name:hit.name }]
    };
  }

  if (!best) return { text: v.refusal || FALLBACK_REFUSAL, sources: [], refused: true };
  return { text: best.a, sources: (best.s || []).filter(Boolean) };
}

function openChat(pid){
  const v = state.voices && state.voices.voices[pid];
  if (!v) return;
  state.chat = { pid, msgs: [{ who:'them', text: v.opening, sources: [], opening:true }], busy:false };
  renderDetail();
}
const closeChat = () => { state.chat = null; renderDetail(); };

const scrollChat = () => setTimeout(() => {
  const l = $('#chatLog'); if (l) l.scrollTop = l.scrollHeight;
}, 30);

function sendChat(q){
  const c = state.chat;
  if (!c || !q.trim() || c.busy) return;
  c.msgs.push({ who:'me', text:q.trim() });
  // النموذج اللغوي للمُفعَّلين وحدهم؛ البقية على المحرّك المحلي بلا نداءٍ ضائع
  const ep = window.WASHAIJ_CHAT;
  const on = (window.WASHAIJ_CHAT_IDS || []).includes(c.pid);
  if (ep && on) { askModel(c, q.trim(), ep); return; }
  const a = answer(c.pid, q);
  if (a) c.msgs.push({ who:'them', text:a.text, sources:a.sources, refused:a.refused, guard:a.guard });
  renderDetail(); scrollChat();
}

/** يسأل النموذج عبر الوسيط ويكتب الجواب حرفًا حرفًا */
async function askModel(c, q, endpoint){
  c.busy = true;
  const bubble = { who:'them', text:'', typing:true };
  c.msgs.push(bubble);
  renderDetail(); scrollChat();

  const history = c.msgs
    .filter(m => !m.typing && !m.opening)
    .map(m => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text }));

  try {
    const res = await fetch(endpoint, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ pid: c.pid, messages: history })
    });
    if (!res.ok || !res.body) throw new Error('تعذّر الاتصال');
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;){
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream:true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts){
        const line = p.trim();
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.t){ bubble.text += ev.t; bubble.typing = false; renderDetail(); scrollChat(); }
        if (ev.error) throw new Error(ev.error);
      }
    }
    if (!bubble.text){ bubble.text = 'لم يصلني جواب.'; bubble.refused = true; }
  } catch (e) {
    // الوسيط متعذّر: نعود إلى المحرّك المحلي بلا انقطاع للزائر
    const a = answer(c.pid, q);
    bubble.text = a ? a.text : 'تعذّر الاتصال.';
    bubble.sources = a && a.sources; bubble.refused = a && a.refused; bubble.guard = a && a.guard;
  } finally {
    bubble.typing = false; c.busy = false;
    renderDetail(); scrollChat();
  }
}

function renderChat(){
  const c = state.chat, v = state.voices.voices[c.pid], d = state.voices;
  const bubbles = c.msgs.map(m => {
    if (m.who === 'me') return `<div class="bub me">${esc(m.text)}</div>`;
    const cls = m.refused ? ' refused' : m.guard ? ' guard' : '';
    const srcs = (m.sources || []).length
      ? `<div class="bub-src">${m.sources.map(s => s.url
          ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name || s.label)} ↗</a>`
          : `<span>${esc(s.name || s.label)}</span>`).join('')}</div>` : '';
    if (m.typing) return '<div class="bub them typing"><i></i><i></i><i></i></div>';
    return `<div class="bub them${cls}">${esc(m.text)}${srcs}</div>`;
  }).join('');

  return `<div class="chat">
    <div class="chat-head">
      <button class="chat-back" id="chatBack" aria-label="رجوع">→</button>
      <div><strong>${esc(v.name)}</strong><small>${esc(v.role)} · ${esc(v.years)}</small></div>
    </div>

    <div class="chat-log" id="chatLog">${bubbles}</div>
    <div class="chat-chips">${(v.suggested || []).map(q =>
      `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="chat-form" id="chatForm">
      <input id="chatIn" type="text" placeholder="اكتب سؤالك عن حياته أو زمنه…" autocomplete="off" aria-label="اكتب سؤالك">
      <button type="submit" aria-label="أرسل السؤال">اسأل</button>
    </form>
    ${d.engine ? `<p class="chat-engine">${esc(d.engine)}</p>` : ''}
  </div>`;
}

function wireChat(){
  const back = $('#chatBack'); if (back) back.onclick = closeChat;
  $$('#detail .chip[data-ask]').forEach(b => b.onclick = () => sendChat(b.dataset.ask));
  const f = $('#chatForm');
  if (f) f.onsubmit = (e) => { e.preventDefault(); const i = $('#chatIn'); sendChat(i.value); i.value = ''; i.focus(); };
}

/* ---------------- السجل الوطني للمواقع (وزارة الثقافة) ---------------- */
function loadSites(){
  return localOrFetch(window.WASHAIJ_SITES, './sites.json').then(d => {
    d.rows.forEach(r => { r.kind = r.type; r.type = 'site'; });   // النوع الأصلي يصير «صنف»
    state.sites = d;
      if (state.kind === 'site' || state.q) renderList();
  }).catch(() => { state.sites = { rows:[], byRegion:{}, total:0, source:null }; });
}

/** كم موقعًا سجّلته الوزارة في هذا النطاق، وكم منها موقّع على الخريطة */

/* ---------------- شريط الفترة والبحث ---------------- */
function initFilters(){
  const [lo, hi] = span();
  const from = $('#eraFrom'), to = $('#eraTo');
  state.era = { from:lo, to:hi, active:false };
  [from, to].forEach(el => { el.min = lo; el.max = hi; el.step = 1; });   // خطوة سنة حتى لا تُقصّ حدود الفترات
  from.value = lo; to.value = hi;

  const paint = () => {
    const a = ((state.era.from - lo) / (hi - lo)) * 100;
    const b = ((state.era.to   - lo) / (hi - lo)) * 100;
    $('#eraFill').style.insetInlineStart = a + '%';
    $('#eraFill').style.width = Math.max(b - a, 0) + '%';
    $('#eraOut').textContent = state.era.active
      ? `${AR(state.era.from)} – ${AR(state.era.to)} م` : `${AR(lo)} – ${AR(hi)} م · كل الفترات`;
    $('#eraReset').hidden = !state.era.active;
  };

  const apply = () => {
    let a = +from.value, b = +to.value;
    if (a > b) { [a, b] = [b, a]; from.value = a; to.value = b; }
    state.era = { from:a, to:b, active: !(a === lo && b === hi) };
    state.web = null; state.sel = null;
    paint(); renderPeriods(); renderList(); renderDetail(); drawMarkers(); drawTimeline(); drawWeb();
  };

  from.addEventListener('input', apply);
  to.addEventListener('input', apply);
  $('#eraReset').addEventListener('click', () => { from.value = lo; to.value = hi; apply(); });
  renderPeriods();
  $('#eraNote').textContent = '';
  paint();

  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = q.value; state.limit = 80; renderList(); }, 140);
  });
}

/* ---------------- views ---------------- */
const HINTS = { map:'', time:'', web:'' };
function setView(v){
  state.view = v;
  $$('.views button').forEach(b => { const on = b.dataset.view === v;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#mapView').classList.toggle('hide', v !== 'map');
  $('#timeView').classList.toggle('hide', v !== 'time');
  $('#webView').classList.toggle('hide', v !== 'web');
  $('#stageHint').textContent = HINTS[v];
  if (v === 'map' && state.map) setTimeout(() => state.map.invalidateSize(), 80);
  if (v === 'time') drawTimeline();
  if (v === 'web') drawWeb();
}

/* ---------------- boot ---------------- */
localOrFetch(window.WASHAIJ_DATA, './data.json')
  .then(d => {
    state.data = d;
    renderRegions(); renderTabs(); initFilters(); renderList(); renderDetail();
    $$('.views button').forEach(b => b.onclick = () => setView(b.dataset.view));
    setView('map');
    initMap(); drawTimeline(); drawWeb();
    // ?view=time أو ?view=web — روابط صفحة التعريف إلى العرض نفسه
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'time' || view === 'web') setView(view);
    loadSites();
    loadVoices().then(() => {
      const pid = new URLSearchParams(location.search).get('chat');
      if (!pid || !state.voices || !state.voices.voices[pid]) return;
      const person = byId(pid);
      if (person){
        const knownRegion = person.region && state.data.regions.some(r => r.id === person.region);
        if (knownRegion) state.region = person.region;
        state.kind = 'person';
        renderRegions(); renderTabs(); renderList(); select(pid);
      }
      openChat(pid);
    });
    playIntro();
  })
  .catch(err => {
    $('#list').innerHTML = `<p class="empty">تعذّر تحميل البيانات (${esc(err.message)}).<br>
      شغّل الملفات عبر خادم محلي، لا بفتح الملف مباشرة.</p>`;
  });

let fitTimer;
addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const r = state.data && region();
    if (r && r.bounds && !state.sel) frame(r, false);
  }, 220);
});
