// 建置時把正式 API 的交友圈清單寫進 index.html（介於 circles:start / circles:end 之間）。
// 用法：node scripts/sync-circles.mjs
// 抓取失敗（網路、非 200、格式不對）時只印警告、保留 index.html 原本的內容，不讓部署失敗。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API_URL = process.env.CIRCLES_API_URL ?? 'https://api.foci-app.com/circles';
const PAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const START = '<!-- circles:start -->';
const END = '<!-- circles:end -->';
/** 每組先顯示幾個，其餘收進「看另外 N 個」 */
const PREVIEW_COUNT = 6;
const FETCH_TIMEOUT_MS = 15_000;
const collator = new Intl.Collator('zh-Hant');

const GROUPS = [
  { key: 'interest', title: '興趣圈' },
  { key: 'identity', title: '身份圈' },
  { key: 'region', title: '地區圈' },
  { key: 'gate', title: '有加入條件' },
];
// 四個分類並排，一欄一類
const COLUMNS = [['interest'], ['identity'], ['region'], ['gate']];
const GENDER_LABEL = { female: '女性', male: '男性', other: '其他' };

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isGated(circle) {
  return circle.allowedGenders.length > 0 || circle.minAge != null || circle.maxAge != null;
}

/** 門檻文字：限性別、年齡區間，例如「限女性」「18 到 28 歲」 */
function gateLabel(circle) {
  const parts = [];
  if (circle.allowedGenders.length > 0) {
    parts.push(circle.allowedGenders.map((g) => `限${GENDER_LABEL[g] ?? g}`).join('、'));
  }
  if (circle.minAge != null && circle.maxAge != null) parts.push(`${circle.minAge} 到 ${circle.maxAge} 歲`);
  else if (circle.minAge != null) parts.push(`${circle.minAge} 歲以上`);
  else if (circle.maxAge != null) parts.push(`${circle.maxAge} 歲以下`);
  return parts.join('、');
}

function groupCircles(circles) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const circle of [...circles].sort((a, b) => collator.compare(a.name, b.name))) {
    groups[isGated(circle) ? 'gate' : circle.category].push(circle);
  }
  return groups;
}

function renderRow(circle) {
  const ringClass = isGated(circle) ? 'ring gate' : circle.category === 'region' ? 'ring region' : 'ring';
  // 有門檻的圈顯示門檻文字；其餘顯示後台設定的短說明（tagline），沒設定就只顯示圈名
  const note = isGated(circle) ? gateLabel(circle) : (circle.tagline ?? '').trim();
  const val = note ? `<span class="val">${escapeHtml(note)}</span>` : '';
  return `<li><span class="${ringClass}"></span><span class="name">${escapeHtml(circle.name)}</span>${val}</li>`;
}

function renderGroup(group, items) {
  const preview = items.slice(0, PREVIEW_COUNT);
  const rest = items.slice(PREVIEW_COUNT);
  const more = rest.length
    ? `
          <details class="rows-more">
            <summary><span class="t-more">看另外 ${rest.length} 個</span><span class="t-less">收起</span></summary>
            <ul class="rows">
              ${rest.map(renderRow).join('\n              ')}
            </ul>
          </details>`
    : '';
  return `
        <h3>${group.title}<small>${items.length} 個</small></h3>
          <ul class="rows">
            ${preview.map(renderRow).join('\n            ')}
          </ul>${more}`;
}

function renderSection(circles) {
  const groups = groupCircles(circles);
  const gatedCount = groups.gate.length;
  const columns = COLUMNS.map(
    (keys) => `
        <div class="circle-col" data-reveal>${keys
          .map((key) => renderGroup(GROUPS.find((g) => g.key === key), groups[key]))
          .join('\n')}
        </div>`,
  ).join('\n');
  return `<div class="circles-head" data-reveal>
          <h2 id="circles-title">目前開放的 ${circles.length} 個交友圈</h2>
          <p>興趣、身份、地區三類，另有 ${gatedCount} 個設了加入條件的圈。免費版可以同時加入 3 個，VIP 8 個，VIP+ 不限。</p>
          <a class="text-link" href="#plans">比較三種方案</a>
        </div>
${columns}
      `;
}

async function fetchCircles() {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const valid =
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((c) => typeof c.name === 'string' && typeof c.category === 'string' && Array.isArray(c.allowedGenders));
  if (!valid) throw new Error('回傳格式不符或沒有圈子');
  return data;
}

function replaceCountInHeroLink(html, count) {
  return html.replace(/看全部 \d+ 個圈/, `看全部 ${count} 個圈`);
}

async function main() {
  let circles;
  try {
    circles = await fetchCircles();
  } catch (err) {
    console.warn(`[sync-circles] 無法取得交友圈，保留 index.html 原本的內容：${err.message}`);
    return;
  }

  const html = await readFile(PAGE_PATH, 'utf8');
  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`index.html 找不到 ${START} / ${END} 標記`);
  }
  const before = html.slice(0, startIdx + START.length);
  const after = html.slice(endIdx);
  const next = replaceCountInHeroLink(`${before}\n        ${renderSection(circles)}      ${after}`, circles.length);
  await writeFile(PAGE_PATH, next);
  console.log(`[sync-circles] 已寫入 ${circles.length} 個交友圈`);
}

main().catch((err) => {
  console.error(`[sync-circles] 失敗：${err.stack ?? err}`);
  process.exitCode = 1;
});
