import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import './styles.css';
import { App } from './App';
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const theme = createTheme({ primaryColor: 'blue', primaryShade: 7, defaultRadius: 'sm', fontFamily: 'system-ui, -apple-system, sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: '650' },
  components: { Button: { defaultProps: { size: 'sm' } } },
});
ReactDOM.createRoot(root).render(<React.StrictMode><MantineProvider theme={theme}><App /></MantineProvider></React.StrictMode>);
