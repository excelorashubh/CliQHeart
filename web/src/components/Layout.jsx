import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Bell, Heart, Home, LogOut, MessageCircle, PlusSquare, Search, UserRound,
  Settings, Video, Menu, X,
} from 'lucide-react';
import { Brand, Avatar } from './Brand.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationApi } from '../services/api.js';

const links = [
  { name: 'Home', to: '/', Icon: Home },
  { name: 'Search', to: '/search', Icon: Search },
  { name: 'Reels', to: '/reels', Icon: Video },
  { name: 'Messages', to: '/messages', Icon: MessageCircle },
  { name: 'Notifications', to: '/notifications', Icon: Bell },
  { name: 'Create post', to: '/create', Icon: PlusSquare },
  { name: 'Profile', to: '/profile', Icon: UserRound, profile: true },
];

export function AppLayout({ children }) {
  const { user, signOut, unreadNotificationCount, setUnreadNotificationCount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    let controller;
    async function refreshUnreadCount() {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await notificationApi.unreadCount({ signal: controller.signal });
        if (active) setUnreadNotificationCount(result.unreadCount || 0);
      } catch (error) {
        if (active && error.name !== 'AbortError') console.error('Could not refresh notification count.', error);
      }
    }
    refreshUnreadCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshUnreadCount();
    }, 30000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [user?.id, setUnreadNotificationCount]);

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      const result = await signOut();
      navigate('/login', {
        replace: true,
        state: result.remoteRevoked ? undefined : { logoutWarning: result.error },
      });
    } finally {
      setLogoutBusy(false);
    }
  }

  return <div className="app-shell">
    <header className="mobile-header">
      <Link to="/" aria-label="CliQHeart home"><Brand /></Link>
      <button className="icon-button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((open) => !open)}>
        {menuOpen ? <X size={21} /> : <Menu size={21} />}
      </button>
    </header>
    <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
      <Link to="/" className="sidebar-brand" onClick={() => setMenuOpen(false)}><Brand /></Link>
      <nav className="nav-list" aria-label="Main navigation">
        {links.map(({ name, to, Icon, disabled, profile }) => disabled
          ? <Link className="nav-link nav-link--disabled" title={`${name} isn't supported by the current API`} to={to} key={name}>
              <Icon size={21} strokeWidth={1.8} /><span>{name}</span><small>Coming soon</small>
            </Link>
          : profile
            ? <NavLink className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to={to} key={name} onClick={() => setMenuOpen(false)}>
                <Avatar name={user?.displayName} src={user?.avatarUrl} size="small" /><span>{name}</span>
              </NavLink>
          : <NavLink end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to={to} key={name} onClick={() => setMenuOpen(false)}>
              <span className="nav-icon-wrap"><Icon size={21} strokeWidth={1.8} />{name === 'Notifications' && unreadNotificationCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</span><span>{name}</span>
            </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <NavLink className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to="/settings" onClick={() => setMenuOpen(false)}><Settings size={21} /><span>Settings</span></NavLink>
        <button className="nav-link logout-link" onClick={logout} disabled={logoutBusy}><LogOut size={21} /><span>{logoutBusy ? 'Logging out…' : 'Log out'}</span></button>
        {user && <Link to="/profile" className="account-shortcut">
          <Avatar name={user.displayName} src={user.avatarUrl} size="small" />
          <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        </Link>}
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="main-column">{children}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {links.filter(({ name }) => ['Home', 'Search', 'Reels', 'Create post', 'Messages', 'Notifications'].includes(name)).map(({ name, to, Icon }) =>
        <NavLink end={to === '/'} key={name} to={to} aria-label={name} className={({ isActive }) => isActive ? 'is-active' : ''}>
          <span className="nav-icon-wrap"><Icon size={22} />{name === 'Notifications' && unreadNotificationCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</span>
        </NavLink>)}
      <NavLink to="/profile" aria-label="Profile" className={({ isActive }) => `mobile-profile${isActive ? ' is-active' : ''}`}><Avatar name={user?.displayName} src={user?.avatarUrl} size="small" /></NavLink>
    </nav>
  </div>;
}
