// 把首頁「常見問題」的問答寫成 FAQPage 結構化資料（介於 faq-jsonld:start / faq-jsonld:end 之間）。
// 用法：node scripts/sync-faq.mjs　改了首頁 FAQ 的題目或答案就要跑一次，再一起提交。
// 結構化資料的文字必須和畫面上的一致（Google 的規定），所以一律從 HTML 產生，不要手改。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const START = '<!-- faq-jsonld:start -->';
const END = '<!-- faq-jsonld:end -->';
const ITEM_PATTERN = /<details name="faq">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function toPlainText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFaq(page) {
  const items = [...page.matchAll(ITEM_PATTERN)].map(([, question, answer]) => ({
    question: toPlainText(question),
    answer: toPlainText(answer),
  }));
  if (items.length === 0) throw new Error('index.html 找不到任何 <details name="faq">，格式可能改了');
  const broken = items.find((item) => !item.question || !item.answer);
  if (broken) throw new Error(`有一題的問題或答案是空的：${JSON.stringify(broken)}`);
  return items;
}

function renderJsonLd(items) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': 'https://www.foci-app.com/#faq',
    inLanguage: 'zh-Hant',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  // 防止答案裡的文字提早結束 <script>
  const json = JSON.stringify(data, null, 2).replaceAll('</', '<\\/');
  return `${START}\n  <script type="application/ld+json">\n${json}\n  </script>\n  ${END}`;
}

const page = await readFile(PAGE_PATH, 'utf8');
const start = page.indexOf(START);
const end = page.indexOf(END);
if (start === -1 || end === -1 || end < start) throw new Error('index.html 找不到 faq-jsonld 標記');

const items = extractFaq(page);
const next = page.slice(0, start) + renderJsonLd(items) + page.slice(end + END.length);
if (next === page) {
  console.log(`FAQ 結構化資料已是最新（${items.length} 題）`);
} else {
  await writeFile(PAGE_PATH, next);
  console.log(`已更新 FAQ 結構化資料（${items.length} 題）`);
}
