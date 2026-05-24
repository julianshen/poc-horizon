import React, { useCallback, useState } from 'react';
import type { TabGroup, TabGroupColor } from '../../types/browser';

interface Props {
  group: TabGroup;
}

/** RGB pairs (chip background, text color) for the 8 group palette colors. */
const COLOR_TOKENS: Record<TabGroupColor, { bg: string; fg: string }> = {
  grey:   { bg: 'rgba(120,120,128,0.20)', fg: '#5e5852' },
  blue:   { bg: 'rgba(94,168,255,0.22)',  fg: '#1d5dbf' },
  red:    { bg: 'rgba(212,77,77,0.22)',   fg: '#a8332c' },
  yellow: { bg: 'rgba(232,180,64,0.26)',  fg: '#8a6512' },
  green:  { bg: 'rgba(80,170,90,0.22)',   fg: '#2f7c3a' },
  pink:   { bg: 'rgba(212,77,122,0.22)',  fg: '#a32f5e' },
  purple: { bg: 'rgba(140,80,200,0.22)',  fg: '#6536a8' },
  cyan:   { bg: 'rgba(60,170,190,0.22)',  fg: '#1b6d80' },
};

export const TabGroupLabel: React.FC<Props> = ({ group }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  const tokens = COLOR_TOKENS[group.color];

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== group.name) {
      window.horizonAPI.invoke('tabGroup:update', { groupId: group.id, changes: { name: next } });
    } else {
      setDraft(group.name);
    }
    setIsEditing(false);
  }, [draft, group.id, group.name]);

  return (
    <span
      data-testid="tab-group-label"
      data-group-id={group.id}
      className="h-[22px] flex items-center px-2 mx-0.5 rounded-md text-[11px] font-semibold select-none shrink-0"
      style={{
        background: tokens.bg,
        color: tokens.fg,
        letterSpacing: '-0.005em',
        WebkitAppRegion: 'no-drag',
      }}
      onDoubleClick={() => { setDraft(group.name); setIsEditing(true); }}
      aria-label={`Tab group ${group.name}`}
    >
      {isEditing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') { setDraft(group.name); setIsEditing(false); }
          }}
          className="bg-transparent outline-none w-20"
          style={{ color: tokens.fg, font: 'inherit' }}
        />
      ) : (
        group.name
      )}
    </span>
  );
};
