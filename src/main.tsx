import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, useAuth } from './lib/auth';
import { KitchenProvider } from './lib/store';
import './lib/i18n';
import './index.css';

// Remounting on account change swaps in that account's saved kitchen.
function Kitchen() {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  return (
    <KitchenProvider key={userId ?? 'guest'} userId={userId}>
      <App />
    </KitchenProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Kitchen />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
