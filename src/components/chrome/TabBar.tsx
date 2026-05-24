import React from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { Tab } from './Tab';
import { TabGroupLabel } from './TabGroupLabel';
import { useIncognito } from '../../hooks/useIncognito';
import type { Tab as TabType } from '../../types/browser';

export const TabBar: React.FC = () => {
  const { tabs, groups, activeTabId } = useBrowserStore();
  const incognito = useIncognito();

  const createTab = () => {
    window.horizonAPI.invoke('tab:create', {});
  };

  return (
    <div
      className="h-[30px] flex items-center overflow-x-auto px-3 gap-px shrink-0"
      style={{ background: 'transparent', WebkitAppRegion: 'drag' }}
    >
      {incognito && (
        <span
          data-testid="incognito-badge"
          className="ml-20 mr-2 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent-primary)',
            letterSpacing: '0.08em',
            WebkitAppRegion: 'no-drag',
          }}
          aria-label="Incognito window"
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 13l9-9 9 9" />
            <path d="M5 13h14v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6z" />
            <circle cx="9" cy="17" r="1.2" />
            <circle cx="15" cy="17" r="1.2" />
          </svg>
          Incognito
        </span>
      )}
      <div className="flex items-center gap-px flex-1" style={{ WebkitAppRegion: 'no-drag' }}>
        {renderTabsWithGroups(
          [...tabs].sort((a, b) => Number(b.isPinned) - Number(a.isPinned)),
          groups,
          activeTabId
        )}
        <button
          data-testid="new-tab-button"
          aria-label="New tab"
          onClick={createTab}
          className="h-[26px] w-[30px] flex items-center justify-center rounded-[8px] ml-1"
          style={{
            color: 'var(--chrome-fg-subtle)',
            background: 'transparent',
            transition: 'background var(--transition-fast), color var(--transition-fast)',
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surface-hover)';
            e.currentTarget.style.color = 'var(--chrome-fg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--chrome-fg-subtle)';
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

/**
 * Walk the tabs in order and insert a TabGroupLabel before each run of
 * tabs that share a groupId. Pinned tabs sort first and can't be in a
 * group (matches Chrome).
 */
function renderTabsWithGroups(
  sortedTabs: TabType[],
  groups: { id: string; name: string; color: string }[],
  activeTabId: string | null
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let prevGroupId: string | undefined;
  sortedTabs.forEach((tab, i) => {
    if (tab.groupId && tab.groupId !== prevGroupId) {
      const g = groups.find((x) => x.id === tab.groupId);
      if (g) nodes.push(<TabGroupLabel key={`g-${g.id}`} group={g as never} />);
    }
    nodes.push(<Tab key={tab.id} tab={tab} isActive={tab.id === activeTabId} index={i} />);
    prevGroupId = tab.groupId;
  });
  return nodes;
}
