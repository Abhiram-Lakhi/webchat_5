import { load as loadHtml } from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function sameDomain(target: string, baseHost: string) {
  try {
    const h = new URL(target).host.toLowerCase();
    const b = baseHost.toLowerCase();
    return h === b || h.endsWith('.' + b);
  } catch {
    return false;
  }
}

function extractText(html: string) {
  const $ = loadHtml(html);
  $('script,style,noscript,template,nav,footer,header,svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function extractLinks(html: string, base: string, baseHost: string) {
  const $ = loadHtml(html);
  const out = new Set<string>();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    try {
      const u = new URL(href, base);
      u.hash = '';
      if (sameDomain(u.toString(), baseHost)) out.add(u.toString());
    } catch {}
  });
  return [...out];
}

export async function crawl(startUrl: string, maxPages = 40) {
  const baseHost = new URL(startUrl).host;
  const seen = new Set<string>();
  const queue = [startUrl];
  const pages: Array<{ url: string; text: string; title?: string }> = [];

  while (queue.length && pages.length < maxPages) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);

    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA } });
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('text/html')) continue;

      const html = await res.text();
      const text = extractText(html);
      if (text && text.length > 80) {
        const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 140) : undefined;
        pages.push({ url: u, text: text.slice(0, 5000), title });
      }

      for (const l of extractLinks(html, u, baseHost)) if (!seen.has(l)) queue.push(l);
      await new Promise((r) => setTimeout(r, 120));
    } catch {
      // ignore per-page failures
    }
  }
  return pages;
}
