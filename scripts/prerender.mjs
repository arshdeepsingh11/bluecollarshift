// Pre-renders public website pages into static HTML (runs after `vite build`).
import { build } from 'vite';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outSsr = path.join(root, 'node_modules/.prerender');
await build({ root, logLevel: 'warn', build: { ssr: 'src/entry-prerender.tsx', outDir: outSsr, emptyOutDir: true }, ssr: { noExternal: ['react-router', 'react-router-dom'] } });
const { render, routes } = await import(pathToFileURL(path.join(outSsr, 'entry-prerender.js')).href); // file URL so it works on Windows (C:\...) and Mac/Linux
const template = await readFile(path.join(root, 'dist/index.html'), 'utf8');
await writeFile(path.join(root, 'dist/app.html'), template); // plain SPA shell (fallback)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
for (const url of routes) {
  const { html, seo } = render(url);
  const canonical = `https://bluecollarshift.com${url === '/' ? '' : url}`;
  const head = [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    url === '/' ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Blue Collar', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android', url: 'https://bluecollarshift.com', description: seo.description, offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD' }, publisher: { '@type': 'Organization', name: 'Blue Collar', url: 'https://bluecollarshift.com', logo: 'https://bluecollarshift.com/brand/logo.svg' } })}</script>` : '',
  ].join('\n    ');
  const page = template
    .replace(/<title>.*?<\/title>/, `<title>${esc(seo.title)}</title>`)
    .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${esc(seo.description)}" />`)
    .replace('<!--seo-->', head)
    // On app./admin. subdomains the same index.html is served: clear the marketing HTML before paint.
    .replace('<div id="root"><!--app--></div>', `<div id="root" data-prerendered="true">${html}</div><script>if(/^(app|admin)\\./.test(location.hostname))document.getElementById('root').innerHTML=''</script>`);
  const file = url === '/' ? 'index.html' : `${url.slice(1)}.html`;
  await writeFile(path.join(root, 'dist', file), page);
  console.log(`prerendered ${url} -> dist/${file} (${(html.length / 1024).toFixed(1)} KB)`);
}
await rm(outSsr, { recursive: true, force: true });
