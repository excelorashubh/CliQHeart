import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Heart, Home, LogOut, MessageCircle, PlusSquare, Search, UserRound,
  Settings, Video, Menu, X,
} from 'lucide-react';
import { Brand, Avatar } from './Brand.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  { name: 'Home', to: '/', Icon: Home },
  { name: 'Search', to: '/search', Icon: Search },
  { name: 'Reels', to: '/reels', Icon: Video },
  { name: 'Messages', to: '/messages', Icon: MessageCircle },
  { name: 'Notifications', to: '/notifications', Icon: Heart, disabled: true },
  { name: 'Create post', to: '/create', Icon: PlusSquare },
  { name: 'Profile', to: '/profile', Icon: UserRound, profile: true },
];

export function AppLayout({ children }) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const navigate = useNavigate();

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
              <Icon size={21} strokeWidth={1.8} /><span>{name}</span>
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
      {links.filter(({ name }) => ['Home', 'Search', 'Reels', 'Create post', 'Messages'].includes(name)).map(({ name, to, Icon }) =>
        <NavLink end={to === '/'} key={name} to={to} aria-label={name} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={22} /></NavLink>)}
      <NavLink to="/profile" aria-label="Profile" className={({ isActive }) => `mobile-profile${isActive ? ' is-active' : ''}`}><Avatar name={user?.displayName} src={user?.avatarUrl} size="small" /></NavLink>
    </nav>
  </div>;
}
