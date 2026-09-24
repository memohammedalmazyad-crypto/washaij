import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('./land.geojson', import.meta.url);
const output = new URL('./intro-map.svg', import.meta.url);
const geojson = JSON.parse(await readFile(source, 'utf8'));

const width = 1600;
const height = 1000;
const bounds = { west: 28, east: 61, south: 10, north: 35 };
const included = new Set(['SAU', 'YEM', 'OMN', 'ARE', 'QAT', 'KWT', 'BHR', 'JOR', 'IRQ', 'EGY']);

const project = ([longitude, latitude]) => [
  ((longitude - bounds.west) / (bounds.east - bounds.west)) * width,
  ((bounds.north - latitude) / (bounds.north - bounds.south)) * height,
];

const ringPath = ring => ring.map((point, index) => {
  const [x, y] = project(point);
  return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(' ') + 'Z';

function geometryPath(geometry) {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap(polygon => polygon.map(ringPath)).join(' ');
  }
  return '';
}

const lands = geojson.features
  .filter(feature => included.has(feature.properties.iso))
  .sort((a, b) => Number(a.properties.iso === 'SAU') - Number(b.properties.iso === 'SAU'))
  .map(feature => {
    const isSaudi = feature.properties.iso === 'SAU';
    return `<path class="${isSaudi ? 'saudi' : 'neighbor'}" d="${geometryPath(feature.geometry)}"/>`;
  })
  .join('\n    ');

const cities = [
  ['الرياض', 46.6753, 24.7136, true],
  ['مكة', 39.8579, 21.3891, false],
  ['المدينة', 39.6142, 24.4672, false],
  ['جدة', 39.1925, 21.4858, false],
  ['الدمام', 50.0888, 26.4207, false],
  ['أبها', 42.5053, 18.2164, false],
].map(([name, longitude, latitude, primary]) => {
  const [x, y] = project([longitude, latitude]);
  return `<g class="city${primary ? ' primary' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle class="pulse" r="${primary ? 22 : 14}"/>
      <circle class="pin" r="${primary ? 6 : 4.5}"/>
      <text x="${primary ? 17 : 12}" y="${primary ? -13 : 4}" direction="rtl" unicode-bidi="plaintext">${name}</text>
    </g>`;
}).join('\n    ');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">خريطة شبه الجزيرة العربية</title>
  <desc id="desc">خريطة زخرفية تبرز المملكة العربية السعودية ومدناً مختارة</desc>
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b2e29"/>
      <stop offset=".52" stop-color="#17473f"/>
      <stop offset="1" stop-color="#092822"/>
    </linearGradient>
    <linearGradient id="saudiFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d6be8b" stop-opacity=".72"/>
      <stop offset="1" stop-color="#a88c5a" stop-opacity=".48"/>
    </linearGradient>
    <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
      <path d="M80 0H0V80" fill="none" stroke="#f4ecd9" stroke-opacity=".035" stroke-width="1"/>
    </pattern>
    <radialGradient id="vignette">
      <stop offset="40%" stop-color="#173d36" stop-opacity="0"/>
      <stop offset="100%" stop-color="#061d19" stop-opacity=".74"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#sea)"/>
  <rect width="1600" height="1000" fill="url(#grid)"/>
  <g fill-rule="evenodd" stroke-linejoin="round">
    ${lands}
  </g>
  <g class="routes" fill="none">
    <path d="M560 546 C690 430 820 430 925 411 S1120 310 1230 320"/>
    <path d="M560 546 C690 640 790 700 876 671 S990 590 1080 520"/>
    <path d="M575 440 C690 450 800 435 925 411"/>
  </g>
  <g class="cities" font-family="Arial, sans-serif" font-size="17" fill="#f4ecd9">
    ${cities}
  </g>
  <rect width="1600" height="1000" fill="url(#vignette)"/>
  <style>
    .neighbor{fill:#c8b58b;fill-opacity:.11;stroke:#e6d5ad;stroke-opacity:.28;stroke-width:2}
    .saudi{fill:url(#saudiFill);stroke:#eedcb4;stroke-opacity:.72;stroke-width:3}
    .routes path{stroke:#ead7ad;stroke-opacity:.2;stroke-width:2;stroke-dasharray:7 12}
    .city .pulse{fill:#e4c698;fill-opacity:.14;stroke:#e4c698;stroke-opacity:.28;stroke-width:1}
    .city .pin{fill:#f5e8c9;stroke:#f5e8c9;stroke-opacity:.26;stroke-width:7}
    .city text{fill-opacity:.6;paint-order:stroke;stroke:#173d36;stroke-opacity:.55;stroke-width:3px;stroke-linejoin:round}
    .city.primary text{fill-opacity:.9;font-weight:700}
  </style>
</svg>
`;

await writeFile(output, svg, 'utf8');
console.log(`Wrote ${output.pathname}`);
