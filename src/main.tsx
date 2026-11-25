import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Public pages are pre-rendered to static HTML at build time (fast first paint, SEO, works without JS).
// React then takes over the same container (identical content, no layout shift on the public site).
createRoot(root).render(app);
