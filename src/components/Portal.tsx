"use client";
import React, { useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

type PortalProps = {
  children: React.ReactNode;
  containerId?: string;
};

export default function Portal({ children, containerId = 'modal-root' }: PortalProps) {
  const [mounted, setMounted] = useState(false);
  const container = useMemo(() => {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      try { el.setAttribute('data-keep', 'true'); } catch {}
      try { el.classList.add('nextjs-portal'); } catch {}
      // Keep this container above app chrome but below system overlays
      el.style.position = 'fixed';
      el.style.left = '0';
      el.style.top = '0';
      el.style.right = '0';
      el.style.bottom = '0';
      el.style.zIndex = '2147483647';
      // Default to non-interactive; becomes interactive only when it has children
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
      
    }
    return el;
  }, [containerId]);

  useEffect(() => { setMounted(true); }, []);

  // Ensure pointer-events reflect actual content presence at mount
  useLayoutEffect(() => {
    if (!container) return;
    const hosts = container.querySelectorAll('[data-portal-host="1"]').length;
    const hasContent = hosts > 0;
    container.style.pointerEvents = hasContent ? 'auto' : 'none';
    try { container.setAttribute('data-active', hasContent ? '1' : '0'); } catch {}
  }, [container]);

  // Observe child mutations and toggle pointer-events based on actual hosts
  useEffect(() => {
    if (!container) return;
    const update = () => {
      const hosts = container.querySelectorAll('[data-portal-host="1"]').length;
      const hasContent = hosts > 0;
      container.style.pointerEvents = hasContent ? 'auto' : 'none';
      try { container.setAttribute('data-active', hasContent ? '1' : '0'); } catch {}
    };
    const mo = new MutationObserver(update);
    mo.observe(container, { childList: true, subtree: true });
    // Initial sync
    update();
    return () => {
      mo.disconnect();
      // On unmount, make sure portal doesn't trap clicks
      try { container.style.pointerEvents = 'none'; container.setAttribute('data-active', '0'); } catch {}
    };
  }, [container]);

  if (!mounted || !container) {
    // Inline fallback
    return <>{children}</>;
  }
  return createPortal(
    <div data-portal-host="1">
      {children}
    </div>,
    container
  );
}
