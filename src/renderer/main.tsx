import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { initTheme } from './theme';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

document.documentElement.classList.add(`platform-${window.revu.platform}`);
// Apply the resolved theme (defaults to system before settings load) so the
// first paint isn't a dark→light or light→dark flash. App.tsx will call
// setThemePreference() once it knows the saved value.
initTheme();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
