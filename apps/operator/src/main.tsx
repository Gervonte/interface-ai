import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const theme = createTheme({ primaryColor: 'teal', defaultRadius: 'md', fontFamily: 'system-ui, sans-serif' });
ReactDOM.createRoot(root).render(
  <React.StrictMode><MantineProvider theme={theme}><App /></MantineProvider></React.StrictMode>,
);
