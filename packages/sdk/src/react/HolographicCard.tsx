import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import type { DomainProfileData } from '../types.js';
import { MidnamesError } from '../errors.js';
import { getDomainProfile } from '../core.js';
import { getDefaultProvider } from '../provider.js';
import { sanitizeUrl } from '../utils/sanitize.js';

/**
 * HolographicCard props
 */
export interface HolographicCardProps {
  /** Domain name to resolve and display */
  domain: string;
  /** Public data provider for fetching domain information */
  publicDataProvider?: PublicDataProvider;
  /** Custom CSS gradient string for the background gradient effect */
  behindGradient?: string;
  /** Custom CSS gradient string for the inner card gradient */
  innerGradient?: string;
  /** Whether to display the background gradient effect */
  showBehindGradient?: boolean;
  /** Additional CSS classes to apply to the card wrapper */
  className?: string;
  /** Enable or disable the 3D tilt effect on mouse hover */
  enableTilt?: boolean;
  /** Enable or disable the 3D tilt effect on mobile devices */
  enableMobileTilt?: boolean;
  /** Sensitivity of the 3D tilt effect on mobile devices */
  mobileTiltSensitivity?: number;
  /** Text displayed on the contact button */
  contactText?: string;
  /** Whether to display the user information section */
  showUserInfo?: boolean;
  /** Callback function called when the contact button is clicked */
  onContactClick?: () => void;
  /** Callback function called when an error occurs */
  onError?: (error: MidnamesError) => void;
}

const DEFAULT_BEHIND_GRADIENT =
  'radial-gradient(farthest-side circle at var(--midnames-holo-pointer-x) var(--midnames-holo-pointer-y),hsla(266,100%,90%,var(--midnames-holo-card-opacity)) 4%,hsla(266,50%,80%,calc(var(--midnames-holo-card-opacity)*0.75)) 10%,hsla(266,25%,70%,calc(var(--midnames-holo-card-opacity)*0.5)) 50%,hsla(266,0%,60%,0) 100%),radial-gradient(35% 52% at 55% 20%,#00ffaac4 0%,#073aff00 100%),radial-gradient(100% 100% at 50% 50%,#00c1ffff 1%,#073aff00 76%),conic-gradient(from 124deg at 50% 50%,#c137ffff 0%,#07c6ffff 40%,#07c6ffff 60%,#c137ffff 100%)';

const DEFAULT_INNER_GRADIENT = 'linear-gradient(145deg,#60496e8c 0%,#71C4FF44 100%)';

const ANIMATION_CONFIG = {
  SMOOTH_DURATION: 600,
  INITIAL_DURATION: 1500,
  INITIAL_X_OFFSET: 70,
  INITIAL_Y_OFFSET: 60,
  DEVICE_BETA_OFFSET: 20,
} as const;

const clamp = (v: number, min = 0, max = 100) => Math.min(Math.max(v, min), max);
const round = (v: number, p = 3) => parseFloat(v.toFixed(p));
const adjust = (v: number, a: number, b: number, c: number, d: number) => round(c + ((d - c) * (v - a)) / (b - a));
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const HolographicCardComponent: React.FC<HolographicCardProps> = ({
  domain,
  publicDataProvider,
  behindGradient,
  innerGradient,
  showBehindGradient = true,
  className = '',
  enableTilt = true,
  enableMobileTilt = false,
  mobileTiltSensitivity = 5,
  contactText = 'Contact',
  showUserInfo = true,
  onContactClick,
  onError,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lastXY = useRef<{ x: number; y: number } | null>(null);

  // Domain data state
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DomainProfileData | null>(null);
  const [error, setError] = useState<MidnamesError | null>(null);

  // Fetch domain data
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    
    getDomainProfile(domain, { provider: publicDataProvider || getDefaultProvider() })
      .then((result) => {
        if (mounted) {
          if (result.success) {
            setData(result.data);
          } else {
            const err = new MidnamesError(result.error?.message ?? 'Unknown error', result.error?.code ?? 'UNKNOWN', result.error);
            setError(err);
            if (onError) onError(err);
            setData(null);
          }
        }
      })
      .catch((err) => {
        if (mounted) {
          const midnamesErr = err instanceof MidnamesError ? err : new MidnamesError('Unknown error', 'UNKNOWN', err);
          setError(midnamesErr);
          if (onError) onError(midnamesErr);
        }
      })
      .finally(() => mounted && setLoading(false));
    
    return () => {
      mounted = false;
    };
  }, [publicDataProvider, domain, onError]);

  // Extract fields from domain data
  const fieldsMap = useMemo(() => {
    const m: Record<string, string> = {};
    if (data?.fields) {
      data.fields.forEach((v, k) => (m[k.toLowerCase()] = v));
    }
    return m;
  }, [data]);

  const displayName = fieldsMap['name'] || fieldsMap['displayname'] || fieldsMap['handle'] || '';
  const avatarUrl = fieldsMap['avatar'] || fieldsMap['image'] || fieldsMap['pfp'] || '';
  const handle = fieldsMap['handle'] || '';

  // Animation logic
  const animation = useMemo(() => {
    if (!enableTilt) return null;
    let raf: number | null = null;

    const update = (x: number, y: number, card: HTMLElement, wrap: HTMLElement) => {
      const w = card.clientWidth;
      const h = card.clientHeight;
      const px = clamp((100 / w) * x);
      const py = clamp((100 / h) * y);
      const cx = px - 50;
      const cy = py - 50;
      const props: Record<string, string> = {
        '--midnames-holo-pointer-x': `${px}%`,
        '--midnames-holo-pointer-y': `${py}%`,
        '--midnames-holo-background-x': `${adjust(px, 0, 100, 35, 65)}%`,
        '--midnames-holo-background-y': `${adjust(py, 0, 100, 35, 65)}%`,
        '--midnames-holo-pointer-from-center': `${clamp(Math.hypot(py - 50, px - 50) / 50, 0, 1)}`,
        '--midnames-holo-pointer-from-top': `${py / 100}`,
        '--midnames-holo-pointer-from-left': `${px / 100}`,
        '--midnames-holo-rotate-x': `${round(-(cx / 5))}deg`,
        '--midnames-holo-rotate-y': `${round(cy / 4)}deg`,
      };
      Object.entries(props).forEach(([k, v]) => wrap.style.setProperty(k, v));
    };

    const animateToCenter = (dur: number, sx: number, sy: number, card: HTMLElement, wrap: HTMLElement) => {
      const start = performance.now();
      const tx = card.clientWidth / 2;
      const ty = card.clientHeight / 2;
      const loop = (t: number) => {
        const p = clamp((t - start) / dur);
        const e = easeInOutCubic(p);
        update(adjust(e, 0, 1, sx, tx), adjust(e, 0, 1, sy, ty), card, wrap);
        if (p < 1) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };

    return { update, animateToCenter, cancel: () => raf && cancelAnimationFrame(raf) };
  }, [enableTilt]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const card = cardRef.current, wrap = wrapRef.current;
    if (!card || !wrap || !animation) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastXY.current = { x, y };
    animation.update(x, y, card, wrap);
  }, [animation]);

  const onPointerEnter = useCallback(() => {
    const card = cardRef.current, wrap = wrapRef.current;
    if (!card || !wrap || !animation) return;
    animation.cancel();
    wrap.classList.add('midnames-holo-active');
    card.classList.add('midnames-holo-active');
    lastXY.current = { x: card.clientWidth / 2, y: card.clientHeight / 2 };
  }, [animation]);

  const onPointerLeave = useCallback(() => {
    const card = cardRef.current, wrap = wrapRef.current;
    if (!card || !wrap || !animation) return;
    const { x, y } = lastXY.current || { x: card.clientWidth / 2, y: card.clientHeight / 2 };
    animation.animateToCenter(ANIMATION_CONFIG.SMOOTH_DURATION, x, y, card, wrap);
    wrap.classList.remove('midnames-holo-active');
    card.classList.remove('midnames-holo-active');
  }, [animation]);

  const onDeviceOrientation = useCallback((e: DeviceOrientationEvent) => {
    const card = cardRef.current, wrap = wrapRef.current;
    if (!card || !wrap || !animation) return;
    const { beta, gamma } = e;
    if (beta == null || gamma == null) return;
    animation.update(card.clientHeight / 2 + gamma * mobileTiltSensitivity, card.clientWidth / 2 + (beta - ANIMATION_CONFIG.DEVICE_BETA_OFFSET) * mobileTiltSensitivity, card, wrap);
  }, [animation, mobileTiltSensitivity]);

  useEffect(() => {
    if (!enableTilt || !animation) return;
    const card = cardRef.current!, wrap = wrapRef.current!;
    if (!card || !wrap) return;
    const pm = onPointerMove as EventListener;
    const pe = onPointerEnter as EventListener;
    const pl = onPointerLeave as EventListener;
    const doHandler = onDeviceOrientation as EventListener;

    const askMotion = () => {
      if (!enableMobileTilt || location.protocol !== 'https:') return;
      interface DeviceMotionEventWithPermission {
        requestPermission?(): Promise<'granted' | 'denied'>;
      }
      const AnyMotion = window.DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
      if (AnyMotion && typeof AnyMotion.requestPermission === 'function') {
        AnyMotion.requestPermission().then((s: string) => s === 'granted' && window.addEventListener('deviceorientation', doHandler));
      } else {
        window.addEventListener('deviceorientation', doHandler);
      }
    };

    card.addEventListener('pointerenter', pe);
    card.addEventListener('pointermove', pm);
    card.addEventListener('pointerleave', pl);
    card.addEventListener('click', askMotion);

    const ix = wrap.clientWidth - ANIMATION_CONFIG.INITIAL_X_OFFSET;
    const iy = ANIMATION_CONFIG.INITIAL_Y_OFFSET;
    animation.update(ix, iy, card, wrap);
    animation.animateToCenter(ANIMATION_CONFIG.INITIAL_DURATION, ix, iy, card, wrap);

    return () => {
      card.removeEventListener('pointerenter', pe);
      card.removeEventListener('pointermove', pm);
      card.removeEventListener('pointerleave', pl);
      card.removeEventListener('click', askMotion);
      window.removeEventListener('deviceorientation', doHandler);
      animation.cancel();
    };
  }, [enableTilt, enableMobileTilt, animation, onPointerMove, onPointerEnter, onPointerLeave, onDeviceOrientation]);

  const cardStyle = useMemo(() => ({
    '--midnames-holo-behind-gradient': showBehindGradient ? (behindGradient ?? DEFAULT_BEHIND_GRADIENT) : 'none',
    '--midnames-holo-inner-gradient': innerGradient ?? DEFAULT_INNER_GRADIENT,
  }) as React.CSSProperties, [showBehindGradient, behindGradient, innerGradient]);

  return (
    <div ref={wrapRef} className={`midnames-holo-card-wrapper ${className}`.trim()} style={cardStyle}>
      <section ref={cardRef} className="midnames-holo-card">
        <div className="midnames-holo-inside">
          <div className="midnames-holo-shine" />
          <div className="midnames-holo-glare" />
          <div className="midnames-holo-content midnames-holo-avatar-content">
            {loading && (
              <div className="midnames-holo-loading">Loading domain...</div>
            )}
            {error && !loading && (
              <div className="midnames-holo-error">
                <div>Failed to load domain</div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>{error.message}</div>
              </div>
            )}
            {avatarUrl && !loading && !error && (
              <img className="midnames-holo-avatar" src={sanitizeUrl(avatarUrl)} alt={`${displayName || domain} avatar`} loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            {showUserInfo && !loading && !error && (displayName || handle || contactText) && (
              <div className="midnames-holo-user-info">
                <div className="midnames-holo-user-details">
                  <div className="midnames-holo-mini-avatar">
                    <img src={sanitizeUrl(avatarUrl)} alt="mini" loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <div className="midnames-holo-user-text">
                    {displayName && <div className="midnames-holo-handle">{displayName}</div>}
                    {handle && <div className="midnames-holo-status">@{handle}</div>}
                    <div className="midnames-holo-status">{domain}</div>
                  </div>
                </div>
                <button className="midnames-holo-contact-btn" onClick={onContactClick} type="button">{contactText}</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

const HolographicCard = React.memo(HolographicCardComponent);
export default HolographicCard;