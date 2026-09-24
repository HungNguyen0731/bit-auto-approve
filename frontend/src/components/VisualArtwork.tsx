import React, { useId } from 'react';

export type ArtworkVariant =
  | 'cloud'
  | 'credentials'
  | 'connection'
  | 'verification'
  | 'verified'
  | 'automation'
  | 'empty-jobs'
  | 'empty-logs';

interface BitbucketMarkProps {
  className?: string;
  label?: string;
}

export const BitbucketMark: React.FC<BitbucketMarkProps> = ({
  className = 'h-6 w-6',
  label,
}) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="currentColor"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zm13.742 14.32H9.522L8.17 8.466h7.561z" />
  </svg>
);

interface VisualArtworkProps {
  variant: ArtworkVariant;
  className?: string;
  title?: string;
  decorative?: boolean;
}

const sceneCopy: Record<ArtworkVariant, string> = {
  cloud: 'Bitbucket Cloud workspace ready to connect',
  credentials: 'Credentials protected in a local secure vault',
  connection: 'Secure network tunnel from the local machine to Bitbucket Cloud',
  verification: 'Connection handshake in progress',
  verified: 'Verified Bitbucket identity and successful connection',
  automation: 'Automated pull request approval pipeline',
  'empty-jobs': 'No approval jobs configured yet',
  'empty-logs': 'No approval activity recorded yet',
};

const BrowserFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <g>
    <rect x="76" y="68" width="368" height="232" rx="28" fill="#fff" opacity=".97" />
    <rect x="76" y="68" width="368" height="46" rx="28" fill="#E8F1FF" />
    <rect x="76" y="92" width="368" height="22" fill="#E8F1FF" />
    <circle cx="106" cy="91" r="6" fill="#FF7452" />
    <circle cx="126" cy="91" r="6" fill="#FFAB00" />
    <circle cx="146" cy="91" r="6" fill="#36B37E" />
    <rect x="173" y="83" width="204" height="16" rx="8" fill="#C9D7EC" />
    {children}
  </g>
);

export const VisualArtwork: React.FC<VisualArtworkProps> = ({
  variant,
  className = 'h-auto w-full',
  title,
  decorative = true,
}) => {
  const accessibleTitle = title || sceneCopy[variant];
  const instanceId = useId().replace(/:/g, '');
  const gradientBgId = `visual-bg-${instanceId}`;
  const gradientBlueId = `visual-blue-${instanceId}`;
  const gradientNavyId = `visual-navy-${instanceId}`;
  const shadowId = `visual-shadow-${instanceId}`;

  return (
    <svg
      viewBox="0 0 520 360"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : accessibleTitle}
      aria-hidden={decorative ? true : undefined}
    >
      {!decorative && <title>{accessibleTitle}</title>}
      <defs>
        <linearGradient id={gradientBgId} x1="40" y1="24" x2="470" y2="334" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5F9FF" />
          <stop offset="1" stopColor="#DCEAFF" />
        </linearGradient>
        <linearGradient id={gradientBlueId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#579DFF" />
          <stop offset="1" stopColor="#0C66E4" />
        </linearGradient>
        <linearGradient id={gradientNavyId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#294A7A" />
          <stop offset="1" stopColor="#172B4D" />
        </linearGradient>
        <filter id={shadowId} x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="16" stdDeviation="14" floodColor="#172B4D" floodOpacity=".16" />
        </filter>
      </defs>

      <rect x="16" y="16" width="488" height="328" rx="42" fill={`url(#${gradientBgId})`} />
      <circle cx="446" cy="70" r="52" fill="#CFE2FF" opacity=".8" />
      <circle cx="70" cy="298" r="36" fill="#B8F5D4" opacity=".55" />
      <path d="M44 258C136 214 178 328 286 286c74-29 119-17 184 18" fill="none" stroke="#9AB9E5" strokeWidth="2" strokeDasharray="7 9" opacity=".6" />

      <g filter={`url(#${shadowId})`}>
        {variant === 'cloud' && (
          <BrowserFrame>
            <rect x="104" y="140" width="136" height="124" rx="20" fill="#F1F7FF" />
            <path d="M130 218h83a22 22 0 0 0 2-44 39 39 0 0 0-75-8 27 27 0 0 0-10 52Z" fill="#0C66E4" opacity=".16" />
            <path d="M145 214h59a16 16 0 0 0 1-32 28 28 0 0 0-54-6 20 20 0 0 0-6 38Z" fill={`url(#${gradientBlueId})`} />
            <g transform="translate(264 140)">
              <rect width="150" height="34" rx="12" fill="#E9F2FF" />
              <circle cx="18" cy="17" r="8" fill="#0C66E4" />
              <rect x="34" y="11" width="88" height="7" rx="3.5" fill="#35577F" />
              <rect x="34" y="22" width="58" height="5" rx="2.5" fill="#9AAEC9" />
              <rect y="48" width="150" height="34" rx="12" fill="#F0F8F4" />
              <circle cx="18" cy="65" r="8" fill="#22A06B" />
              <rect x="34" y="59" width="76" height="7" rx="3.5" fill="#35577F" />
              <rect x="34" y="70" width="98" height="5" rx="2.5" fill="#9AAEC9" />
              <rect y="96" width="150" height="34" rx="12" fill="#FFF6E5" />
              <circle cx="18" cy="113" r="8" fill="#F5A524" />
              <rect x="34" y="107" width="95" height="7" rx="3.5" fill="#35577F" />
              <rect x="34" y="118" width="68" height="5" rx="2.5" fill="#9AAEC9" />
            </g>
          </BrowserFrame>
        )}

        {variant === 'credentials' && (
          <>
            <rect x="106" y="88" width="308" height="202" rx="32" fill="#fff" />
            <rect x="132" y="116" width="140" height="24" rx="12" fill="#E8F1FF" />
            <rect x="132" y="156" width="256" height="46" rx="14" fill="#F7F9FC" stroke="#C5D6EC" strokeWidth="2" />
            <circle cx="158" cy="179" r="7" fill="#9AAEC9" />
            <circle cx="182" cy="179" r="7" fill="#9AAEC9" />
            <circle cx="206" cy="179" r="7" fill="#9AAEC9" />
            <circle cx="230" cy="179" r="7" fill="#9AAEC9" />
            <rect x="132" y="224" width="162" height="38" rx="13" fill={`url(#${gradientNavyId})`} />
            <rect x="316" y="216" width="72" height="62" rx="22" fill={`url(#${gradientBlueId})`} />
            <path d="M336 235v-7a16 16 0 0 1 32 0v7" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
            <rect x="330" y="234" width="44" height="32" rx="10" fill="#fff" />
            <circle cx="352" cy="248" r="5" fill="#0C66E4" />
            <path d="M352 251v7" stroke="#0C66E4" strokeWidth="4" strokeLinecap="round" />
          </>
        )}

        {variant === 'connection' && (
          <>
            <rect x="68" y="120" width="112" height="132" rx="28" fill="#fff" />
            <rect x="340" y="96" width="112" height="156" rx="28" fill="#fff" />
            <rect x="94" y="146" width="60" height="60" rx="18" fill={`url(#${gradientNavyId})`} />
            <path d="M103 217h42" stroke="#9AB9E5" strokeWidth="8" strokeLinecap="round" />
            <rect x="366" y="124" width="60" height="60" rx="18" fill={`url(#${gradientBlueId})`} />
            <g transform="translate(382 140) scale(1.15)" fill="#fff">
              <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zm13.742 14.32H9.522L8.17 8.466h7.561z" />
            </g>
            <path d="M181 173c45-54 104-54 158 0" fill="none" stroke="#B8C9E2" strokeWidth="16" strokeLinecap="round" />
            <path d="M181 173c45-54 104-54 158 0" fill="none" stroke="#0C66E4" strokeWidth="6" strokeLinecap="round" strokeDasharray="12 12" />
            <circle cx="260" cy="139" r="34" fill="#fff" />
            <path d="M244 139h32M260 123v32" stroke="#22A06B" strokeWidth="7" strokeLinecap="round" />
            <path d="M389 214h-38m38 14h-24" stroke="#9AB9E5" strokeWidth="7" strokeLinecap="round" />
          </>
        )}

        {(variant === 'verification' || variant === 'verified') && (
          <BrowserFrame>
            <circle cx="260" cy="198" r="72" fill={variant === 'verified' ? '#D9F9E8' : '#E7F0FF'} />
            {variant === 'verified' ? (
              <>
                <circle cx="260" cy="198" r="48" fill="#22A06B" />
                <path d="m236 198 16 17 33-38" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
              </>
            ) : (
              <>
                <circle cx="260" cy="198" r="48" fill={`url(#${gradientBlueId})`} />
                <circle cx="260" cy="198" r="31" fill="none" stroke="#fff" strokeWidth="8" strokeDasharray="34 18" />
                <circle cx="260" cy="198" r="7" fill="#fff" />
              </>
            )}
            <rect x="112" y="146" width="70" height="18" rx="9" fill="#CFE2FF" />
            <rect x="118" y="174" width="48" height="9" rx="4.5" fill="#9AAEC9" />
            <rect x="338" y="146" width="70" height="18" rx="9" fill="#CFF3DF" />
            <rect x="354" y="174" width="48" height="9" rx="4.5" fill="#9AAEC9" />
          </BrowserFrame>
        )}

        {variant === 'automation' && (
          <>
            <rect x="58" y="92" width="404" height="196" rx="34" fill="#fff" />
            <g transform="translate(88 125)">
              <rect width="92" height="120" rx="22" fill="#E8F1FF" />
              <rect x="22" y="20" width="48" height="48" rx="15" fill={`url(#${gradientBlueId})`} />
              <g transform="translate(34 32)" fill="#fff"><path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zm13.742 14.32H9.522L8.17 8.466h7.561z" /></g>
              <rect x="18" y="84" width="56" height="7" rx="3.5" fill="#4D6484" />
              <rect x="27" y="99" width="38" height="6" rx="3" fill="#9AAEC9" />
            </g>
            <path d="M184 185h52" stroke="#9AB9E5" strokeWidth="8" strokeLinecap="round" />
            <path d="m226 173 14 12-14 12" fill="none" stroke="#0C66E4" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <g transform="translate(244 125)">
              <rect width="92" height="120" rx="22" fill="#FFF6E5" />
              <circle cx="46" cy="44" r="24" fill="#F5A524" />
              <path d="M32 45h28M46 31v28" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
              <rect x="18" y="84" width="56" height="7" rx="3.5" fill="#4D6484" />
              <rect x="27" y="99" width="38" height="6" rx="3" fill="#9AAEC9" />
            </g>
            <path d="M340 185h42" stroke="#9AB9E5" strokeWidth="8" strokeLinecap="round" />
            <path d="m372 173 14 12-14 12" fill="none" stroke="#22A06B" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="414" cy="185" r="34" fill="#22A06B" />
            <path d="m397 185 12 13 24-28" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

        {(variant === 'empty-jobs' || variant === 'empty-logs') && (
          <>
            <ellipse cx="260" cy="284" rx="148" ry="22" fill="#9AB9E5" opacity=".25" />
            <rect x="116" y="82" width="288" height="192" rx="30" fill="#fff" />
            <rect x="144" y="116" width="232" height="26" rx="13" fill="#E8F1FF" />
            <rect x="144" y="160" width="232" height="74" rx="18" fill="#F3F6FA" stroke="#D7E2F0" strokeWidth="2" strokeDasharray="7 7" />
            {variant === 'empty-jobs' ? (
              <>
                <circle cx="260" cy="197" r="26" fill="#0C66E4" />
                <path d="M246 197h28M260 183v28" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
              </>
            ) : (
              <>
                <circle cx="260" cy="197" r="28" fill="#DCEAFF" />
                <path d="M248 186h24M248 197h24M248 208h16" stroke="#0C66E4" strokeWidth="5" strokeLinecap="round" />
              </>
            )}
          </>
        )}
      </g>
    </svg>
  );
};

type MetricVariant = 'jobs' | 'approved' | 'connection' | 'uptime';

export const MetricEmblem: React.FC<{ variant: MetricVariant; className?: string }> = ({
  variant,
  className = 'h-12 w-12',
}) => {
  const palette = {
    jobs: ['#E8F1FF', '#0C66E4'],
    approved: ['#D9F9E8', '#22A06B'],
    connection: ['#EDE7FF', '#6554C0'],
    uptime: ['#FFF1D6', '#F5A524'],
  }[variant];

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="20" fill={palette[0]} />
      {variant === 'jobs' && (
        <>
          <circle cx="20" cy="20" r="6" fill={palette[1]} />
          <circle cx="44" cy="32" r="6" fill={palette[1]} />
          <circle cx="20" cy="44" r="6" fill={palette[1]} />
          <path d="M25 21c12 0 7 11 14 11M25 43c12 0 7-11 14-11" fill="none" stroke={palette[1]} strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {variant === 'approved' && (
        <>
          <path d="M32 13 48 19v12c0 11-6 18-16 22-10-4-16-11-16-22V19Z" fill={palette[1]} />
          <path d="m24 32 6 6 11-13" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {variant === 'connection' && (
        <>
          <circle cx="21" cy="32" r="8" fill={palette[1]} />
          <circle cx="43" cy="20" r="7" fill={palette[1]} opacity=".65" />
          <circle cx="43" cy="44" r="7" fill={palette[1]} opacity=".65" />
          <path d="m27 29 10-6m-10 12 10 6" stroke={palette[1]} strokeWidth="4" strokeLinecap="round" />
        </>
      )}
      {variant === 'uptime' && (
        <>
          <circle cx="32" cy="32" r="18" fill={palette[1]} />
          <path d="M32 21v12l9 6" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
};
