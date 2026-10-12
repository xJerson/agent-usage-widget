import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FloatApp } from './FloatApp';
import type { FloatRole } from '../shared/types';
import './styles.css';

const param = new URLSearchParams(location.search).get('role');
const role: FloatRole | null = param === 'panel' || param === 'toast' || param === 'bar' ? param : null;
if (role) document.body.classList.add('float-window');
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    {role ? <FloatApp role={role} /> : <App />}
  </StrictMode>,
);
