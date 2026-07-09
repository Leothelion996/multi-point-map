import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';
import { ShellProvider } from '../context/ShellContext.jsx';

export default function AppShell() {
  return (
    <ShellProvider>
      <NavBar />
      <Outlet />
    </ShellProvider>
  );
}
