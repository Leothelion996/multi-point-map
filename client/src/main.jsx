import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PopupProvider } from './context/PopupContext.jsx';
import './styles/app.css';

// No StrictMode: the map pages manage imperative Google Maps objects whose
// lifecycles don't tolerate dev-only double-mounting.
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <PopupProvider>
        <App />
      </PopupProvider>
    </AuthProvider>
  </BrowserRouter>
);
