import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
// highlight.js token colours for the continuous diff viewer.
import 'highlight.js/styles/github-dark.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

document.documentElement.classList.add(`platform-${window.revu.platform}`);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
