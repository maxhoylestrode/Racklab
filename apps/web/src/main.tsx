import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App';
import { applyMotion, applyTheme, useUi, watchSystemTheme } from './store/ui';

applyTheme(useUi.getState().theme);
watchSystemTheme();
applyMotion(useUi.getState().reducedMotion);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
