/* وشائج — نموذج أولي. كل عنصر يحمل رابط مصدره. */
'use strict';

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const AR = (n) => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const KIND_LABEL = { place:'مكان', person:'شخصية', event:'حدث', material:'مادة أرشيفية' };

const state = { data:null, region:'all', kind:'place', view:'map', sel:null, map:null, markers:[] };

/* ---------------- data helpers ---------------- */
const all = () => {
  const d = state.data;
  return [...d.places, ...d.people, ...d.events, ...d.materials];
};
const byId = (id) => all().find(x => x.id === id);
const region = () => state.data.regions.find(r => r.id === state.region);
const inRegion = (x) => state.region === 'all' || x.region === state.region;

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

const placeEvents = (pl) => state.data.events.filter(e => e.place === pl.id);
const regionPeople = (rid) => state.data.people.filter(p => p.region === rid);

const yearsText = (p) => (born(p) && died(p))
  ? `${AR(born(p))} – ${AR(died(p))} م` : 'تواريخ غير مكتملة في المصدر';

/* ---------------- shell ---------------- */
function renderRegions(){
  $('#regions').innerHTML = state.data.regions.map(r =>
    `<button class="region${r.id===state.region?' on':''}${r.focus?' focus-region':''}"
      data-region="${r.id}" aria-pressed="${r.id===state.region}">${esc(r.name)}</button>`).join('');
  $$('.region').forEach(b => b.onclick = () => selectRegion(b.dataset.region));
  $('#regionNote').textContent = region().blurb;
}

function selectRegion(id){
  state.region = id;
  state.sel = null;
  renderRegions();
  renderList();
  const r = region();
  frame(r, true);
  drawMarkers(); drawTimeline(); drawWeb(); renderDetail();
}

function renderTabs(){
  $$('.tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === state.kind);
    b.setAttribute('aria-selected', b.dataset.kind === state.kind);
    b.onclick = () => { state.kind = b.dataset.kind; renderTabs(); renderList(); };
  });
}

function bucket(){
  const d = state.data;
  const map = { place:d.places, person:d.people, event:d.events, material:d.materials };
  return map[state.kind].filter(inRegion);
}

function renderList(){
  const items = bucket();
  if (!items.length){
    $('#list').innerHTML = `<p class="empty">لا توجد ${esc(({place:'أماكن',person:'شخصيات',event:'أحداث',material:'مواد'})[state.kind])}
      موثّقة في «${esc(region().name)}» ضمن هذا النموذج بعد.<br>النموذج يعرض ما تحقّقنا من مصدره فقط.</p>`;
    return;
  }
  $('#list').innerHTML = items.map(it => {
    const thumb = it.image
      ? `<img src="${esc(it.image.url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'—'}))">`
      : `<span class="ph">${it.type==='person'?'ش':it.type==='event'?'ح':'م'}</span>`;
    return `<button class="row${state.sel===it.id?' on':''}" data-id="${esc(it.id)}" aria-pressed="${state.sel===it.id}">
      ${thumb}<span><strong>${esc(it.name)}</strong><small>${esc(subtitle(it))}</small></span></button>`;
  }).join('');
  $$('.row').forEach(b => b.onclick = () => select(b.dataset.id));
}

const subtitle = (it) =>
  it.type === 'person'   ? `${it.role} · ${yearsText(it)}`
: it.type === 'event'    ? `${AR(it.year)} م`
: it.type === 'material' ? `${it.kind} · ${it.date}`
: it.kind;

function select(id){
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
  const it = state.sel && byId(state.sel);
  if (!it){
    const r = region();
    box.innerHTML = `<div class="d-body">
      <p class="d-kicker">${esc(r.name)}</p>
      <h2>اختر عنصرًا من الفهرس</h2>
      <p class="txt">${esc(r.blurb)}</p>
      <p class="txt">كل بطاقة هنا تعرض تاريخها ومكانها ومصدرها. عند اختيار شخصية تظهر سنوات حياتها،
      ومن كان معاصرًا لها، وما وقع من أحداث في تلك الفترة.</p>
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
    secs += section(`من كان موجودًا في حياته (${AR(cons.length)})`,
      cons.length ? `<div class="chips">${cons.map(c => chip(c, yearsText(c).replace(' م',''))).join('')}</div>`
                  : `<p class="txt">لا تتقاطع فترة حياته مع شخصية أخرى في هذا النموذج.</p>`);
    secs += section(`أحداث في زمنه (${AR(evs.length)})`,
      evs.length ? `<div class="chips">${evs.map(e => chip(e, AR(e.year))).join('')}</div>`
                 : `<p class="txt">لا حدث موثّق في هذا النموذج ضمن سنوات حياته.</p>`);
  }

  if (it.type === 'event'){
    const alive = aliveAt(it.year), near = nearbyEvents(it);
    const pl = it.place && byId(it.place);
    when = `<p class="d-when">${AR(it.year)}${it.endYear&&it.endYear!==it.year?` – ${AR(it.endYear)}`:''} م
      ${it.hijri ? `<em>· ${esc(it.hijri)}</em>` : ''}${pl ? `<em>· ${esc(pl.name)}</em>` : ''}</p>`;
    secs += section(`من كان حيًّا وقتها (${AR(alive.length)})`,
      alive.length ? `<div class="chips">${alive.map(p => chip(p, yearsText(p).replace(' م',''))).join('')}</div>`
                   : `<p class="txt">لا شخصية موثّقة في هذا النموذج ضمن تلك السنة.</p>`);
    secs += section('أحداث قريبة زمنيًا',
      near.length ? `<div class="chips">${near.map(e => chip(e, AR(e.year))).join('')}</div>`
                  : `<p class="txt">لا أحداث أخرى قريبة في هذا النموذج.</p>`);
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

  const lic = it.image
    ? `<p class="credit"><b>الترخيص:</b> ${esc(it.image.license)}<br><b>النسب:</b> ${esc(it.image.artist)}
       ${it.image.page ? `<br><a href="${esc(it.image.page)}" target="_blank" rel="noopener">صفحة الملف ↗</a>` : ''}</p>` : '';

  box.innerHTML = `${img}<div class="d-body">
    <p class="d-kicker">${esc(region().name)} · ${esc(it.role || it.kind || KIND_LABEL[it.type])}</p>
    <h2>${esc(it.name)}</h2>
    ${when}
    <p class="txt">${esc(it.blurb)}</p>
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}
    ${secs}
    ${lic}
    <a class="src" href="${esc(it.source)}" target="_blank" rel="noopener noreferrer">${esc(it.sourceName || 'المصدر')} ↗</a>
  </div>`;

  $$('#detail .chip').forEach(b => b.onclick = () => {
    const t = byId(b.dataset.go);
    if (!t) return;
    if (t.region !== state.region) { state.region = t.region; renderRegions(); }
    state.kind = t.type; renderTabs(); renderList(); select(t.id);
  });
}

const section = (title, html) => `<div class="d-sec"><h3>${esc(title)}</h3>${html}</div>`;

function lifeBar(p){
  const [lo, hi] = span();
  const a = ((born(p) - lo) / (hi - lo)) * 100, b = ((died(p) - lo) / (hi - lo)) * 100;
  return `<div class="lifebar"><i style="inset-inline-start:${a}%;width:${Math.max(b-a,1.5)}%"></i></div>
    <div class="lifescale"><span>${AR(lo)}</span><span>${AR(hi)}</span></div>`;
}

function span(){
  const ys = [...state.data.people.flatMap(p => [born(p), died(p)]),
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

function initMap(){
  if (!window.L){ $('#map').innerHTML = '<p class="empty">تعذّر تحميل الخريطة. تصفّح الفهرس والزمن.</p>'; return; }
  const r = region();
  state.map = L.map('map', { scrollWheelZoom:false, zoomControl:false, minZoom:3, maxZoom:16 })
               .setView(r.center, r.zoom);
  frame(r, false);
  L.control.zoom({ position:'bottomleft' }).addTo(state.map);

  // تفاصيل الشوارع تظهر وحدها عند التقريب، مصبوغة لتبقى في مزاج الورق القديم
  state.tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom:9, maxZoom:16, opacity:.75, className:'aged-tiles',
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · حدود: Natural Earth'
  }).addTo(state.map);

  drawGraticule();
  fetch('./land.geojson').then(x => x.json()).then(land => {
    state.land = L.geoJSON(land, {
      style: f => ({
        color:'#8a7350', weight: f.properties.focus ? 1.6 : 0.9,
        opacity:.85, fillColor: f.properties.focus ? '#efe2c4' : '#e7dabd', fillOpacity:1
      }),
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties.ar,
        { className:'land-label', permanent:false, direction:'center' })
    }).addTo(state.map);
    state.land.bringToBack();
    syncBase();
  }).catch(() => {});

  state.map.on('zoomend', syncBase);
  drawMarkers();
  setTimeout(() => state.map.invalidateSize(), 250);
}

/** الأرض المرسومة تختفي تدريجيًا لتكشف الشوارع عند التقريب */
function syncBase(){
  if (!state.map) return;
  const z = state.map.getZoom(), close = z >= 9;
  document.getElementById('map').classList.toggle('close-up', close);
  if (state.land) state.land.setStyle(f => ({
    color:'#8a7350', weight: f.properties.focus ? 1.6 : 0.9,
    opacity: close ? .5 : .85,
    fillColor: f.properties.focus ? '#efe2c4' : '#e7dabd',
    fillOpacity: close ? 0 : 1
  }));
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
  const visible = all().filter(x => inRegion(x) && x.coord);
  const seats = {};
  visible.forEach(x => { const k = x.coord.join(','); (seats[k] = seats[k] || []).push(x.id); });
  state.markers = visible.map(x => {
    const on = state.sel === x.id, size = x.type === 'place' ? 19 : 15;
    const group = seats[x.coord.join(',')];
    let at = x.coord;
    if (group.length > 1){                       // دبابيس على الإحداثي نفسه
      const i = group.indexOf(x.id), a = (i / group.length) * Math.PI * 2, R = 0.0016;
      at = [x.coord[0] + R*Math.cos(a), x.coord[1] + R*Math.sin(a)];
    }
    const icon = L.divIcon({ className:`pin pin-${x.type}${on?' sel':''}`,
      iconSize:[size,size], iconAnchor:[size/2,size/2] });
    return L.marker(at, { icon, title:x.name })
      .addTo(state.map)
      .bindPopup(`<strong>${esc(x.name)}</strong><br>${esc(subtitle(x))}` +
        (group.length > 1 ? '<br><em>المصدر يعطي هذا العنصر إحداثيات مطابقة لعنصر آخر؛ بوعِد الدبوس قليلًا ليظهر الاثنان.</em>' : ''))
      .on('click', () => { state.kind = x.type; renderTabs(); renderList(); select(x.id); });
  });
}

/* ---------------- timeline ---------------- */
function drawTimeline(){
  const [lo, hi] = span(), W = hi - lo;
  const pos = (y) => ((y - lo) / W) * 100;
  const people = state.data.people.filter(inRegion).filter(p => born(p) && died(p)).sort((a,b) => born(a)-born(b));
  const events = state.data.events.filter(inRegion).sort((a,b) => a.year - b.year);

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

  const pplRow = people.length ? `<p class="tl-head">فترات حياة</p>${people.map(p =>
    `<div class="tl-row"><button class="tl-bar${state.sel===p.id?' on':''}" data-id="${esc(p.id)}"
      style="inset-inline-start:${pos(born(p))}%;width:${Math.max(pos(died(p))-pos(born(p)),9)}%"
      title="${esc(p.name)} (${AR(born(p))}–${AR(died(p))})"><b>${esc(p.name)}</b></button></div>`).join('')}` : '';

  $('#timeline').innerHTML = `<div class="tl-axis">${ticks.join('')}</div>${evRow}${pplRow}` +
    (!events.length && !people.length
      ? `<p class="empty">لا أحداث ولا شخصيات موثّقة زمنيًا في «${esc(region().name)}» ضمن هذا النموذج.</p>` : '');

  $$('#timeline [data-id]').forEach(b => b.onclick = () => {
    const t = byId(b.dataset.id); state.kind = t.type; renderTabs(); renderList(); select(t.id);
  });
}

/* ---------------- ego web ---------------- */
function relations(it){
  if (!it) return [];
  if (it.type === 'person') return [...contemporaries(it).map(x => [x,'معاصر']), ...eventsInLife(it).map(x => [x,'في زمنه'])];
  if (it.type === 'event')  return [...aliveAt(it.year).map(x => [x,'حيّ وقتها']),
                                    ...(it.place && byId(it.place) ? [[byId(it.place),'المكان']] : [])];
  if (it.type === 'place')  return [...placeEvents(it).map(x => [x,'هنا']), ...regionPeople(it.region).map(x => [x,'المنطقة'])];
  return [];
}

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

function drawWeb(){
  const svg = $('#web'), it = state.sel && byId(state.sel);
  if (!it){ svg.innerHTML = `<text class="web-empty" x="320" y="230">اختر عنصرًا لترى صلاته</text>`; return; }
  const rel = relations(it).slice(0, 11);
  if (!rel.length){ svg.innerHTML = `<text class="web-empty" x="320" y="230">لا صلات موثّقة لهذا العنصر بعد</text>`; return; }
  const cx = 320, cy = 226, R = 160;
  const nodes = rel.map(([x,label], i) => {
    const a = (-Math.PI/2) + (i / rel.length) * Math.PI * 2;
    return { x:cx + R*Math.cos(a), y:cy + R*Math.sin(a), item:x, label };
  });
  svg.innerHTML =
    nodes.map(n => `<line class="edge" x1="${cx}" y1="${cy}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}"/>`).join('') +
    `<g class="node center"><circle cx="${cx}" cy="${cy}" r="32"/>
      <text x="${cx}" y="${cy+50}" style="fill:#16352f;font-size:13px">${esc(it.name)}</text></g>` +
    nodes.map(n => `<g class="node ${n.item.type}" data-id="${esc(n.item.id)}" tabindex="0" role="button"
        aria-label="${esc(n.item.name)} — ${esc(n.label)}">
      <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="19"/>
      ${wrapLabel(n.item.name).map((line,li) =>
        `<text x="${n.x.toFixed(1)}" y="${(n.y + 34 + li*14).toFixed(1)}">${esc(line)}</text>`).join('')}
    </g>`).join('');
  $$('#web .node[data-id]').forEach(g => {
    const go = () => { const t = byId(g.dataset.id); state.kind = t.type; renderTabs(); renderList(); select(t.id); };
    g.onclick = go;
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

/* ---------------- views ---------------- */
const HINTS = {
  map:'الدبابيس تشير إلى المكان الموثّق في المصدر، لا إلى موضع التصوير.',
  time:'المحور بالميلادي. التواريخ الهجرية تظهر فقط حين يذكرها المصدر.',
  web:'الصلات محسوبة من تقاطع التواريخ والأماكن في المصادر، لا استنتاج آلي.'
};
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
fetch('./data.json')
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(d => {
    state.data = d;
    renderRegions(); renderTabs(); renderList(); renderDetail();
    $$('.views button').forEach(b => b.onclick = () => setView(b.dataset.view));
    setView('map');
    initMap(); drawTimeline(); drawWeb();
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
