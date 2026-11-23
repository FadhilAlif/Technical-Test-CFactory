'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/arc/badge/badge';
import { ThemeSwitch, type Theme } from '@/components/arc/theme-switch/theme-switch';
import { fetchHealthStatus } from '@/lib/api-client';
import styles from './image-processor.module.css';

type ApiHealthState = 'checking' | 'online' | 'degraded' | 'offline';

export function ThemeToggleBar() {
  const [theme, setTheme] = useState<Theme>('light');
  const [health, setHealth] = useState<ApiHealthState>('checking');

  useEffect(() => {
    const saved = window.localStorage.getItem('caip-theme');
    const preferred: Theme =
      saved === 'dark' || saved === 'light'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

    setTheme(preferred);
    document.documentElement.setAttribute('data-theme', preferred);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealthStatus(controller.signal)
      .then((res) => {
        setHealth(res.status === 'ok' ? 'online' : 'degraded');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setHealth('offline');
      });

    return () => {
      controller.abort();
    };
  }, []);

  const applyTheme = (next: Theme): void => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    window.localStorage.setItem('caip-theme', next);
  };

  const handleThemeChange = (next: Theme): void => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };

    if (prefersReducedMotion || !docWithTransition.startViewTransition) {
      applyTheme(next);
      return;
    }

    docWithTransition.startViewTransition(() => {
      applyTheme(next);
    });
  };

  const healthTone =
    health === 'online'
      ? 'success'
      : health === 'degraded'
        ? 'warning'
        : health === 'offline'
          ? 'danger'
          : 'neutral';

  const healthLabel =
    health === 'online'
      ? 'Worker API online'
      : health === 'degraded'
        ? 'API degraded'
        : health === 'offline'
          ? 'API offline'
          : 'Checking API';

  return (
    <div className={styles.headerControls}>
      <Badge tone={healthTone} dot size="md">
        {healthLabel}
      </Badge>
      <ThemeSwitch
        theme={theme}
        variant="rise"
        iconOnly
        onThemeChange={(next) => handleThemeChange(next)}
      />
    </div>
  );
}
