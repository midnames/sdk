import React, { useEffect, useMemo, useState } from 'react';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import type { DomainProfileData } from '../types.js';
import { MidnamesError } from '../errors.js';
import { deriveShieldedAddress } from '../utils/address.js';
import { Copy, Check } from 'lucide-react';
import { getDomainProfile } from '../core.js';
import { getDefaultProvider } from '../provider.js';
import { sanitizeUrl } from '../utils/sanitize.js';

export type DomainProfileWidgetProps = {
  fullDomain: string;
  publicDataProvider?: PublicDataProvider;
  className?: string;
  showStatus?: boolean;
  onError?: (error: MidnamesError) => void;
  
  // Variant and layout
  variant?: 'full' | 'compact' | 'inline' | 'minimal';
  
  // Visibility controls
  showBanner?: boolean;
  showAvatar?: boolean;
  showBio?: boolean;
  showDomainInfo?: boolean;
  showSocialLinks?: boolean;
  showCopyButtons?: boolean;
  
  // Field selection
  fields?: ('target' | 'owner' | 'resolver')[];
  customFields?: string[];
  
  // Styling
  theme?: 'light' | 'dark' | 'auto';
  borderRadius?: 'none' | 'sm' | 'md' | 'lg';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  
  // Custom rendering
  renderActions?: (data: DomainProfileData | null) => React.ReactNode;
  
  // Event callbacks
  onFieldClick?: (field: string, value: string) => void;
  onCopySuccess?: (field: string, value: string) => void;
};

function truncate(addr?: string | null, head = 10, tail = 6) {
  if (!addr) return 'N/A';
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function CopyableValue({ 
  value, 
  className, 
  showCopy = true, 
  onCopySuccess, 
  onFieldClick, 
  fieldName 
}: { 
  value?: string | null; 
  className?: string; 
  showCopy?: boolean;
  onCopySuccess?: (field: string, value: string) => void;
  onFieldClick?: (field: string, value: string) => void;
  fieldName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  
  if (!value) return <span className={className}>N/A</span>;
  
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (onCopySuccess && fieldName) {
        onCopySuccess(fieldName, value);
      }
    } catch {
      // Silently fail if clipboard API is not available
    }
  };

  const handleClick = () => {
    if (onFieldClick && fieldName) {
      onFieldClick(fieldName, value);
    }
    if (showCopy) {
      copy();
    }
  };

  return (
    <span 
      className={`${className} ${showCopy || onFieldClick ? 'midnames-copyable' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={value}
    >
      {truncate(value)}
      {showCopy && (
        <span className="midnames-copy-icon-container">
          {copied ? (
            <Check className="midnames-copy-icon midnames-copy-success" />
          ) : (
            <Copy className={`midnames-copy-icon midnames-copy-hover ${hovered ? 'midnames-copy-visible' : 'midnames-copy-invisible'}`} />
          )}
        </span>
      )}
    </span>
  );
}

export function DomainProfileWidget({ 
  fullDomain, 
  publicDataProvider, 
  className, 
  showStatus = true, 
  onError,
  
  // Variant and layout
  variant = 'full',
  
  // Visibility controls
  showBanner = true,
  showAvatar = true,
  showBio = true,
  showDomainInfo = true,
  showSocialLinks = true,
  showCopyButtons = true,
  
  // Field selection
  fields = ['target', 'owner', 'resolver'],
  customFields = [],
  
  // Styling
  theme = 'auto',
  borderRadius = 'md',
  padding = 'md',
  
  // Custom rendering
  renderActions,
  
  // Event callbacks
  onFieldClick,
  onCopySuccess,
}: DomainProfileWidgetProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DomainProfileData | null>(null);
  const [error, setError] = useState<MidnamesError | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    getDomainProfile(fullDomain, { provider: publicDataProvider || getDefaultProvider() })
      .then((d) => {
        if (mounted) {
          if (d.success) {
            setData(d.data);
          } else {
            setError(new MidnamesError(d.error?.message ?? 'Unknown error', d.error?.code ?? 'UNKNOWN', d.error));
            if (onError) onError(new MidnamesError(d.error?.message ?? 'Unknown error', d.error?.code ?? 'UNKNOWN', d.error));
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
  }, [publicDataProvider, fullDomain, onError]);

  const fieldsMap = useMemo(() => {
    const m: Record<string, string> = {};
    if (data?.fields) {
      data.fields.forEach((v, k) => (m[k.toLowerCase()] = v));
    }
    return m;
  }, [data]);

  const displayName = fieldsMap['name'] || fieldsMap['displayname'] || fieldsMap['handle'] || '';
  const bio = fieldsMap['bio'] || fieldsMap['description'] || '';
  const website = fieldsMap['website'] || fieldsMap['url'] || '';
  const twitter = (fieldsMap['twitter'] || '').replace(/^@/, '');
  const github = (fieldsMap['github'] || '').replace(/^@/, '');
  const location = fieldsMap['location'] || '';
  const avatarUrl = fieldsMap['avatar'] || fieldsMap['image'] || fieldsMap['pfp'] || '';
  const bannerUrl = fieldsMap['banner'] || fieldsMap['header'] || '';
  const epk = fieldsMap['epk'];

  const resolvedTarget = useMemo(() => {
    if (!data?.resolvedTarget) return null;
    const target = data.resolvedTarget;
    if (target.type === 'shielded' && epk) {
      return deriveShieldedAddress(target.address, epk) || target.address;
    }
    return target.address;
  }, [data?.resolvedTarget, epk]);

  const status = useMemo<'registered' | 'available' | 'unknown' | 'error'>(() => {
    if (loading) return 'unknown';
    if (error) return 'error';
    return data?.info ? 'registered' : 'available';
  }, [loading, data?.info, error]);

  // Build CSS classes based on props
  const cardClasses = useMemo(() => {
    const classes = ['midnames-card'];
    
    if (variant !== 'full') {
      classes.push(`midnames-card-${variant}`);
    }
    
    if (theme !== 'auto') {
      classes.push(`midnames-theme-${theme}`);
    }
    
    if (borderRadius !== 'md') {
      classes.push(`midnames-border-${borderRadius}`);
    }
    
    if (padding !== 'md') {
      classes.push(`midnames-padding-${padding}`);
    }
    
    if (className) {
      classes.push(className);
    }
    
    return classes.join(' ');
  }, [variant, theme, borderRadius, padding, className]);

  // Filter fields to show
  const fieldsToShow = useMemo(() => {
    const fieldsData: Array<{ key: string; label: string; value: string | null; fieldName: string }> = [];
    
    if (fields.includes('target')) {
      fieldsData.push({ key: 'target', label: 'Resolved Target', value: resolvedTarget, fieldName: 'target' });
    }
    if (fields.includes('owner')) {
      fieldsData.push({ key: 'owner', label: 'Owner', value: data?.info?.owner || null, fieldName: 'owner' });
    }
    if (fields.includes('resolver')) {
      fieldsData.push({ key: 'resolver', label: 'Resolver', value: data?.info?.resolver || null, fieldName: 'resolver' });
    }
    
    // Add custom fields
    customFields.forEach(fieldKey => {
      const fieldValue = fieldsMap[fieldKey.toLowerCase()];
      if (fieldValue) {
        fieldsData.push({ key: fieldKey, label: fieldKey, value: fieldValue, fieldName: fieldKey });
      }
    });
    
    return fieldsData;
  }, [fields, customFields, resolvedTarget, data?.info, fieldsMap]);

  if (error && !loading) {
    return (
      <div className={cardClasses}>
        <div className="midnames-error">
          <div className="midnames-error-title">Error loading domain</div>
          <div className="midnames-error-message">{error.message}</div>
          <div className="midnames-error-code">Code: {error.code}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClasses}>
      {showBanner && bannerUrl && <img src={sanitizeUrl(bannerUrl)} alt="" className="midnames-banner" />}
      <div className="midnames-header">
        {showAvatar && (
          <div className="midnames-avatar">
            {avatarUrl ? (
              <img src={sanitizeUrl(avatarUrl)} alt="" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            ) : (
              <span>{(displayName || data?.fullDomain || '?')[0]?.toUpperCase?.() ?? '?'}</span>
            )}
          </div>
        )}
        <div className="midnames-ident">
          <div className="midnames-name">{displayName || data?.fullDomain || fullDomain}</div>
          {variant !== 'minimal' && <div className="midnames-domain">{data?.fullDomain || fullDomain}</div>}
        </div>
        {showStatus && (
          <div className={`midnames-status midnames-status-${status}`}>
            {loading ? 'Checking…' : status === 'registered' ? 'Registered' : status === 'available' ? 'Available' : status === 'error' ? 'Error' : 'Unknown'}
          </div>
        )}
      </div>
      {showBio && bio && <p className="midnames-bio">{bio}</p>}
      {showDomainInfo && fieldsToShow.length > 0 && (
        <div className="midnames-grid">
          {fieldsToShow.map((field) => (
            <div key={field.key} className="midnames-box">
              <div className="midnames-box-label">{field.label}</div>
              <CopyableValue 
                value={field.value} 
                className="midnames-box-value" 
                showCopy={showCopyButtons}
                onCopySuccess={onCopySuccess}
                onFieldClick={onFieldClick}
                fieldName={field.fieldName}
              />
            </div>
          ))}
        </div>
      )}
      {showSocialLinks && (website || twitter || github || location) && (
        <div className="midnames-links">
          {website && (
            <a className="midnames-chip" href={sanitizeUrl(website.startsWith('http') ? website : `https://${website}`)} target="_blank" rel="noreferrer">{website.replace(/^https?:\/\//, '')}</a>
          )}
          {twitter && (
            <a className="midnames-chip" href={`https://x.com/${twitter}`} target="_blank" rel="noreferrer">@{twitter}</a>
          )}
          {github && (
            <a className="midnames-chip" href={`https://github.com/${github}`} target="_blank" rel="noreferrer">{github}</a>
          )}
          {location && <span className="midnames-chip">{location}</span>}
        </div>
      )}
      {renderActions && (
        <div className="midnames-actions">
          {renderActions(data)}
        </div>
      )}
    </div>
  );
}

