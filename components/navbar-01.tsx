'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Film } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '@/lib/use-auth';
import { cn } from '../lib/utils';

// Void glyph
const Logo = (props: React.SVGAttributes<SVGElement>) => {
  return (
    <svg width='1em' height='1em' viewBox='0 0 324 323' fill='currentColor' xmlns='http://www.w3.org/2000/svg' aria-hidden='true' {...props}>
      <rect
        x='88.1023'
        y='144.792'
        width='151.802'
        height='36.5788'
        rx='18.2894'
        transform='rotate(-38.5799 88.1023 144.792)'
        fill='currentColor'
      />
      <rect
        x='85.3459'
        y='244.537'
        width='151.802'
        height='36.5788'
        rx='18.2894'
        transform='rotate(-38.5799 85.3459 244.537)'
        fill='currentColor'
      />
    </svg>
  );
};

// Hamburger icon; morphs into an X when its button has aria-expanded="true".
const HamburgerIcon = ({ className, ...props }: React.SVGAttributes<SVGElement>) => (
  <svg
    className={cn('pointer-events-none', className)}
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <path
      d="M4 12L20 12"
      className="origin-center -translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] motion-reduce:transition-none group-aria-expanded:translate-x-0 group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[315deg]"
    />
    <path
      d="M4 12H20"
      className="origin-center transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.8)] motion-reduce:transition-none group-aria-expanded:rotate-45"
    />
    <path
      d="M4 12H20"
      className="origin-center translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] motion-reduce:transition-none group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[135deg]"
    />
  </svg>
);

// Types
export interface Navbar01NavLink {
  href: string;
  label: string;
  /** Forces the current-page state; otherwise derived from the pathname. */
  active?: boolean;
}

export interface Navbar01Props extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode;
  logoHref?: string;
  navigationLinks?: Navbar01NavLink[];
  ctaText?: string;
  ctaHref?: string;
  liveGame?: { id: string; opponent: string } | null;
}

// Default navigation links. The gallery index is intentionally disabled; don't link to it.
const defaultNavigationLinks: Navbar01NavLink[] = [
  { href: '/roster', label: 'Roster' },
  { href: '/news', label: 'News' },
  { href: '/donate', label: 'Donate' },
  { href: 'https://sites.google.com/view/venus-penn-ultimate/', label: 'Venus' },
];

const MY_FILM_HREF = '/live/me';

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

function isCurrent(pathname: string, href: string) {
  if (isExternal(href)) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function initialOf(email?: string, username?: string) {
  const s = (email || username || '').trim();
  return s ? s[0]!.toUpperCase() : '';
}

export const Navbar = React.forwardRef<HTMLElement, Navbar01Props>(
  (
    {
      className,
      logo = <Logo />,
      logoHref = '/',
      navigationLinks = defaultNavigationLinks,
      ctaText = 'Void Live',
      ctaHref = '/live',
      liveGame,
      ...props
    },
    ref
  ) => {
    const pathname = usePathname() ?? '/';
    const { user, status } = useAuth();
    const signedIn = !!user && (status === 'authenticated' || status === 'expired' || status === 'offline');

    const [menuOpen, setMenuOpen] = React.useState(false);
    const headerRef = React.useRef<HTMLElement | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    const menuId = React.useId();

    const setRefs = React.useCallback(
      (node: HTMLElement | null) => {
        headerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    const closeMenu = React.useCallback((returnFocus: boolean) => {
      setMenuOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    }, []);

    // Close on navigation (covers links, back/forward).
    const [lastPath, setLastPath] = React.useState(pathname);
    if (lastPath !== pathname) {
      setLastPath(pathname);
      if (menuOpen) setMenuOpen(false);
    }

    // While open: focus the first item, close on Esc / outside click / focus leaving the header.
    React.useEffect(() => {
      if (!menuOpen) return;
      menuRef.current?.querySelector<HTMLElement>('a,button')?.focus();

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu(true);
        }
      };
      const onPointer = (e: PointerEvent) => {
        if (headerRef.current && !headerRef.current.contains(e.target as Node)) closeMenu(false);
      };
      const onFocusIn = (e: FocusEvent) => {
        if (headerRef.current && !headerRef.current.contains(e.target as Node)) closeMenu(false);
      };
      // Leaving the phone layout (rotate/resize) closes the menu so it never lingers on desktop.
      const mq = window.matchMedia('(min-width: 768px)');
      const onMq = () => mq.matches && closeMenu(false);

      document.addEventListener('keydown', onKey);
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('focusin', onFocusIn);
      mq.addEventListener('change', onMq);
      return () => {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onPointer);
        document.removeEventListener('focusin', onFocusIn);
        mq.removeEventListener('change', onMq);
      };
    }, [menuOpen, closeMenu]);

    const linkProps = (link: Navbar01NavLink) => {
      const external = isExternal(link.href);
      const current = link.active ?? isCurrent(pathname, link.href);
      return {
        current,
        props: {
          href: link.href,
          'aria-current': current ? ('page' as const) : undefined,
          ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
      };
    };

    const myFilmCurrent = isCurrent(pathname, MY_FILM_HREF);
    const liveCurrent = pathname === ctaHref;
    const initial = initialOf(user?.email, user?.username);

    return (
      <header
        ref={setRefs}
        className={cn(
          'sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70',
          className
        )}
        {...props}
      >
        <div className="mx-auto flex h-16 w-full items-center justify-between gap-3 px-2 sm:px-4 md:px-6">
          {/* Left: menu trigger (phones), wordmark, links (md+) */}
          <div className="flex min-w-0 items-center gap-1 md:gap-6">
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="group size-11 text-foreground md:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen(o => !o)}
            >
              <HamburgerIcon />
            </Button>

            <Link
              href={logoHref}
              aria-current={pathname === logoHref ? 'page' : undefined}
              className="flex h-11 items-center gap-2 rounded-md px-1 text-foreground"
            >
              <span className="text-2xl">{logo}</span>
              <span className="font-display text-2xl leading-none tracking-wide pt-0.5">
                Void<span className="hidden sm:inline"> Ultimate</span>
              </span>
            </Link>

            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {navigationLinks.map(link => {
                  const { current, props: lp } = linkProps(link);
                  return (
                    <li key={link.href}>
                      <Link
                        {...lp}
                        className={cn(
                          'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
                          current
                            ? 'bg-surface-2 text-foreground'
                            : 'text-fg-secondary hover:bg-surface-2 hover:text-foreground'
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          {/* Right: live badge, My film (signed in), Void Live CTA */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {liveGame && (
              <Link
                href={`/live/watch/${liveGame.id}`}
                className="flex h-8 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                <span className="relative flex size-1.5" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-destructive" />
                </span>
                <span>
                  Live<span className="hidden sm:inline"> vs. {liveGame.opponent}</span>
                  <span className="sr-only sm:hidden"> vs. {liveGame.opponent}</span>
                </span>
              </Link>
            )}

            {signedIn && (
              <Link
                href={MY_FILM_HREF}
                aria-current={myFilmCurrent ? 'page' : undefined}
                className={cn(
                  'hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors md:inline-flex',
                  myFilmCurrent
                    ? 'bg-surface-2 text-foreground'
                    : 'text-fg-secondary hover:bg-surface-2 hover:text-foreground'
                )}
              >
                <Film aria-hidden="true" className="size-4" />
                My film
              </Link>
            )}

            <div className="relative">
              {liveGame && (
                <>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[-2px] z-0 rounded-md motion-reduce:[animation:none!important]"
                    style={{
                      background:
                        'conic-gradient(from var(--border-angle), color-mix(in oklch, var(--destructive) 45%, black) 0%, var(--destructive) 20%, color-mix(in oklch, var(--destructive) 50%, white) 27%, var(--destructive) 35%, color-mix(in oklch, var(--destructive) 45%, black) 55%, color-mix(in oklch, var(--destructive) 45%, black) 100%)',
                      animation: 'border-spotlight 4s linear infinite',
                    }}
                  />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] rounded-md bg-background" />
                </>
              )}
              <Button asChild variant="brand" size="sm" className="relative z-[2] h-9 px-4">
                <Link href={ctaHref} aria-current={liveCurrent ? 'page' : undefined}>
                  {signedIn && initial && (
                    <span
                      aria-hidden="true"
                      className="-ml-1.5 flex size-5 items-center justify-center rounded-full bg-brand-foreground text-[11px] font-semibold text-brand"
                    >
                      {initial}
                    </span>
                  )}
                  {ctaText}
                  {signedIn && <span className="sr-only"> (signed in)</span>}
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Phone menu: rendered only when open, so phones never flash it and desktop never shows it. */}
        {menuOpen && (
          <div
            id={menuId}
            ref={menuRef}
            className="absolute inset-x-0 top-full border-b border-border bg-card shadow-lg md:hidden"
          >
            <nav aria-label="Main" className="mx-auto px-2 py-2">
              <ul className="flex flex-col">
                {navigationLinks.map(link => {
                  const { current, props: lp } = linkProps(link);
                  return (
                    <li key={link.href}>
                      <Link
                        {...lp}
                        onClick={() => closeMenu(false)}
                        className={cn(
                          'flex h-12 items-center rounded-md px-3 text-base font-medium transition-colors',
                          current
                            ? 'bg-surface-2 text-foreground'
                            : 'text-fg-secondary hover:bg-surface-2 hover:text-foreground'
                        )}
                      >
                        {link.label}
                        {current && <span className="ml-auto size-1.5 rounded-full bg-brand" aria-hidden="true" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 border-t border-border pt-2">
                {signedIn ? (
                  <Link
                    href={MY_FILM_HREF}
                    aria-current={myFilmCurrent ? 'page' : undefined}
                    onClick={() => closeMenu(false)}
                    className={cn(
                      'flex h-12 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors',
                      myFilmCurrent
                        ? 'bg-surface-2 text-foreground'
                        : 'text-fg-secondary hover:bg-surface-2 hover:text-foreground'
                    )}
                  >
                    <Film aria-hidden="true" className="size-4" />
                    My film
                  </Link>
                ) : (
                  <p className="px-3 py-2 text-sm text-fg-muted">
                    Players and coaches: sign in to Void Live for scores and game film.
                  </p>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>
    );
  }
);

Navbar.displayName = 'Navbar';

export { Logo, HamburgerIcon };
