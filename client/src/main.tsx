import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme.css';
import { App } from './App';
import { useStore } from './store';

useStore.getState().init();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
