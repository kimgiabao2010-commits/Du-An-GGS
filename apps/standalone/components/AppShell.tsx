'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bot, ChevronRight, CircleDollarSign,
  FileCheck2, LayoutDashboard, ListChecks, Menu, RadioTower, ScrollText,
  Search, ShieldCheck, Workflow, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const navigation = [
  { href: '/', label: 'SOC Console', icon: LayoutDashboard },
  { href: '/tasks', label: 'Cases & Tasks', icon: ListChecks },
  { href: '/evidence', label: 'Evidence', icon: FileCheck2 },
];

const utilities = [
  { href: '/executions', label: 'Executions', icon: Workflow },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/context', label: 'Cost & Context', icon: CircleDollarSign },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/siem', label: 'SIEM', icon: ShieldCheck },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchItems = [...navigation, ...utilities].filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const renderLink = ({ href, label, icon: Icon }: (typeof navigation)[number]) => {
    const active = href === '/' ? pathname === href : pathname.startsWith(href);
    return <Link key={href} className={`shell-nav-link${active ? ' active' : ''}`} href={href} aria-current={active ? 'page' : undefined}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>{active && <ChevronRight className="nav-chevron" size={14} aria-hidden="true" />}
    </Link>;
  };

  return <div className="shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className={`shell-sidebar${open ? ' open' : ''}`} aria-label="Primary navigation">
      <div className="shell-brand"><span className="shell-brand-mark"><ShieldCheck size={20} strokeWidth={1.8} aria-hidden="true" /></span><div><strong>GSS</strong><span>Security intelligence</span></div><span className="brand-edition">SOC</span></div>
      <nav className="shell-nav">
        <p className="nav-label">Workspace</p>
        {navigation.map(renderLink)}
        <p className="nav-label utility-label">Control Plane</p>
        {utilities.map(renderLink)}
      </nav>
      <div className="sidebar-foot">
        <div className="environment-row"><span className="status-dot info" /><span><strong>Local runtime</strong><small>Verify live status in console</small></span></div>
        <div className="source-label"><RadioTower size={14} aria-hidden="true" />Demo adapter</div>
      </div>
    </aside>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <div className="shell-main">
      <header className="shell-topbar">
        <button className="icon-button mobile-menu" onClick={() => setOpen(value => !value)} aria-label={open ? 'Close navigation' : 'Open navigation'}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="global-search"><Search size={16} aria-hidden="true" /><input id="global-search" aria-label="Navigate GSS" placeholder="Go to tasks, agents, evidence…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && searchItems[0]) { router.push(searchItems[0].href); setQuery(''); } if (event.key === 'Escape') setQuery(''); }} /><kbd>⌘ K</kbd>{query && <div className="search-results" role="listbox" aria-label="Navigation results">{searchItems.length ? searchItems.map(item => <Link key={item.href} href={item.href} onClick={() => setQuery('')}><item.icon size={15} /><span>{item.label}</span><ChevronRight size={13} /></Link>) : <span>No destination found</span>}</div>}</div>
        <div className="topbar-status"><ShieldCheck size={14} aria-hidden="true" /><span>Evidence protected</span><span className="status-dot success" /></div>
      </header>
      <main id="main-content" className="shell-content">{children}</main>
    </div>
  </div>;
}
