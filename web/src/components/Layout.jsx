import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Compass, Home, LogOut, MessageCircle, PlusSquare, Search, UserRound,
  Settings, Video, Menu, X,
} from 'lucide-react';
import { Brand, Avatar } from './Brand.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { notificationApi } from '../services/api.js';

const links = [
  { name: 'Home', to: '/', Icon: Home },
  { name: 'Search', to: '/search', Icon: Search },
  { name: 'Explore', to: '/explore/people/', Icon: Compass },
  { name: 'Reels', to: '/reels', Icon: Video },
  { name: 'Messages', to: '/messages', Icon: MessageCircle },
  { name: 'Notifications', to: '/notifications', Icon: Bell },
  { name: 'Create', to: '/create', Icon: PlusSquare },
  { name: 'Profile', to: '/profile', Icon: UserRound, profile: true },
];

const mobileLinks = [
  { name: 'Home', to: '/', Icon: Home },
  { name: 'Search', to: '/search', Icon: Search },
  { name: 'Reels', to: '/reels', Icon: Video },
  { name: 'Chats', to: '/messages', Icon: MessageCircle },
];

export function AppLayout({ children }) {
  const { user, signOut, unreadNotificationCount, setUnreadNotificationCount, unreadMessageCount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const navigate = useNavigate();
  const isProfessional = user?.accountType === 'CREATOR' || user?.accountType === 'BUSINESS';
  const navigationLinks = isProfessional
    ? [...links.slice(0, 5), { name: 'Dashboard', to: '/professional/dashboard', Icon: BarChart3 }, ...links.slice(5)]
    : links;

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
      <div className="mobile-header-actions">
        <Link className="mobile-header-action" to="/create" aria-label="Create post" title="Create post">
          <PlusSquare size={22} strokeWidth={1.9} />
        </Link>
        <NavLink
          className={({ isActive }) => `mobile-header-action${isActive ? ' is-active' : ''}`}
          to="/notifications"
          aria-label={unreadNotificationCount > 0
            ? `Notifications, ${unreadNotificationCount} unread`
            : 'Notifications'}
          title="Notifications"
        >
          <span className="nav-icon-wrap">
            <Bell size={22} strokeWidth={1.9} />
            {unreadNotificationCount > 0 && <span className="notification-badge" aria-hidden="true">
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </span>}
          </span>
        </NavLink>
        <button className="icon-button mobile-menu-button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((open) => !open)}>
        {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
    </header>
    <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
      <Link to="/" className="sidebar-brand" onClick={() => setMenuOpen(false)}><Brand /></Link>
      <nav className="nav-list" aria-label="Main navigation">
        {navigationLinks.map(({ name, to, Icon, disabled, profile }) => disabled
          ? <Link className="nav-link nav-link--disabled" aria-label={name} title={`${name} isn't supported by the current API`} to={to} key={name}>
              <Icon size={21} strokeWidth={1.8} /><span>{name}</span><small>Coming soon</small>
            </Link>
          : profile
            ? <NavLink aria-label={name} title={name} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to={to} key={name} onClick={() => setMenuOpen(false)}>
                <Avatar name={user?.displayName} src={user?.avatarUrl} size="small" /><span>{name}</span>
              </NavLink>
          : <NavLink aria-label={name} title={name} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to={to} key={name} onClick={() => setMenuOpen(false)}>
              <span className="nav-icon-wrap"><Icon size={21} strokeWidth={1.8} />{((name === 'Notifications' && unreadNotificationCount > 0) || (name === 'Messages' && unreadMessageCount > 0)) && <span className="notification-badge" aria-hidden="true">{Math.min(99, name === 'Notifications' ? unreadNotificationCount : unreadMessageCount)}{(name === 'Notifications' ? unreadNotificationCount : unreadMessageCount) > 99 ? '+' : ''}</span>}</span><span>{name}</span>
            </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <NavLink aria-label="More" title="More" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} to="/settings" onClick={() => setMenuOpen(false)}><Settings size={21} /><span>More</span></NavLink>
        <button className="nav-link logout-link" aria-label="Log out" title="Log out" onClick={logout} disabled={logoutBusy}><LogOut size={21} /><span>{logoutBusy ? 'Logging out…' : 'Log out'}</span></button>
        {user && <Link to="/profile" className="account-shortcut" aria-label={`${user.displayName} @${user.username}`} title={`${user.displayName} @${user.username}`}>
          <Avatar name={user.displayName} src={user.avatarUrl} size="small" />
          <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
        </Link>}
      </div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="main-column">{children}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mobileLinks.map(({ name, to, Icon }) =>
        <NavLink end={to === '/'} key={name} to={to} aria-label={name} className={({ isActive }) => isActive ? 'is-active' : ''}>
          <span className="nav-icon-wrap"><Icon size={22} strokeWidth={1.9} />{name === 'Chats' && unreadMessageCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadMessageCount > 99 ? '99+' : unreadMessageCount}</span>}</span>
        </NavLink>)}
      <NavLink to="/profile" aria-label="Profile" className={({ isActive }) => `mobile-profile${isActive ? ' is-active' : ''}`}><Avatar name={user?.displayName} src={user?.avatarUrl} size="small" /></NavLink>
    </nav>
  </div>;
}
