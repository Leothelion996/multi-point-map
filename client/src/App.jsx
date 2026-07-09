import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import LocationsPage from './pages/LocationsPage.jsx';
import ZipCodesPage from './pages/ZipCodesPage.jsx';
import PanelStockAnalysisPage from './pages/PanelStockAnalysisPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/" element={<LocationsPage />} />
        <Route path="/zipcodes" element={<ZipCodesPage />} />
        <Route path="/panel-stock-analysis" element={<PanelStockAnalysisPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
