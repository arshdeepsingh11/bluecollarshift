import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { PublicLayout, PublicRoutes } from './surfaces/PublicSite';
import { SEO } from './pages/public/Pages';

/** Build-time only: renders public pages to static HTML for speed and SEO. */
export function render(url: string) {
  const html = renderToString(
    <StaticRouter location={url}>
      <PublicLayout>
        <PublicRoutes />
      </PublicLayout>
    </StaticRouter>,
  );
  return { html, seo: SEO[url] };
}
export const routes = Object.keys(SEO);
