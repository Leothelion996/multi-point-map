import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Map as MapIcon, Sidebar as SidebarIcon } from 'react-feather';
import { useAuth } from '../context/AuthContext.jsx';
import { useShell } from '../context/ShellContext.jsx';
import NavMenu from './NavMenu.jsx';

export default function NavBar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { toggleSidebar } = useShell();

  const onMapPage =
    pathname === '/' ||
    pathname.startsWith('/zipcodes') ||
    pathname.startsWith('/panel-stock-analysis');

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <nav className="bg-white shadow-sm relative z-20">
      <div className="nav-grid-container px-4 h-16">
        <div className="nav-logo-area">
          <NavMenu />
          <MapIcon className="ml-2 text-blue-600 h-6 w-6" />
          <span className="ml-2 text-xl font-semibold text-gray-900">CustomMaps Pro</span>
        </div>
        <div className="nav-spacer"></div>
        <div className="nav-controls-area">
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-all"
          >
            <LogOut className="mr-1 h-4 w-4" /> <span>Logout</span>
          </button>
          {onMapPage && (
            <button
              onClick={toggleSidebar}
              aria-label="Toggle right panel"
              className="p-2 rounded-md text-gray-500 hover:text-gray-600 hover:bg-gray-100 focus:outline-none"
            >
              <SidebarIcon className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
