import { useMemo, useState } from 'react';
import { Archive, AtSign, Bot, ChevronDown, ChevronRight, Sparkles, Tag, UserRound, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import type { InboxAgent, InboxFilter, InboxTag, InboxTeamMember } from '@/features/inbox/types';

interface InboxSidebarProps {
  activeFilter: InboxFilter;
  selectedTagId: string | null;
  counts: {
    you: number;
    mentions: number;
    all: number;
    archive: number;
  };
  tags: InboxTag[];
  agents: InboxAgent[];
  teamMembers: InboxTeamMember[];
  onSelectFilter: (filter: InboxFilter) => void;
  onSelectTag: (tagId: string | null) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectTeamMember: (userId: string) => void;
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}

function SidebarItem({ icon, label, count, active = false, onClick }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors ${
        active
          ? 'bg-white text-black font-medium'
          : 'text-white/90 hover:bg-white/10 font-medium'
      }`}
    >
      <span className={active ? 'text-black' : 'text-white'}>{icon}</span>
      <span className="flex-1 text-left font-medium">{label}</span>
      {typeof count === 'number' && (
        <span className={`text-xs font-medium ${active ? 'text-black/70' : 'text-white/70'}`}>{count}</span>
      )}
    </button>
  );
}

export function InboxSidebar({
  activeFilter,
  selectedTagId,
  counts,
  tags,
  agents,
  teamMembers,
  onSelectFilter,
  onSelectTag,
  onSelectAgent,
  onSelectTeamMember,
}: InboxSidebarProps) {
  const [showTags, setShowTags] = useState(true);
  const [showAgents, setShowAgents] = useState(true);

  const sortedTeam = useMemo(
    () => [...teamMembers].sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')),
    [teamMembers]
  );

  return (
    <aside className="inbox-sidebar h-full min-h-0 overflow-y-auto border-r border-white/10 px-3 py-4">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-white">Inbox</h1>
        <p className="text-xs font-medium text-white/70">Conversations</p>
      </div>

      <div className="space-y-1">
        <SidebarItem
          icon={<UserRound className="h-4 w-4" />}
          label="You"
          count={counts.you}
          active={activeFilter === 'you'}
          onClick={() => {
            onSelectFilter('you');
            onSelectTag(null);
          }}
        />
        <SidebarItem
          icon={<AtSign className="h-4 w-4" />}
          label="Mentions"
          count={counts.mentions}
          active={activeFilter === 'mentions'}
          onClick={() => {
            onSelectFilter('mentions');
            onSelectTag(null);
          }}
        />
        <SidebarItem
          icon={<Users className="h-4 w-4" />}
          label="All"
          count={counts.all}
          active={activeFilter === 'all'}
          onClick={() => {
            onSelectFilter('all');
            onSelectTag(null);
          }}
        />
      </div>

      <div className="mt-4">
        <Button
          type="button"
          variant="ghost"
          className="h-7 w-full justify-start px-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => setShowTags((current) => !current)}
        >
          {showTags ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          <Tag className="mr-1 h-3.5 w-3.5" /> Tags
        </Button>

        {showTags && (
          <div className="mt-1 space-y-1 pl-1">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  onSelectFilter('tag');
                  onSelectTag(tag.id);
                }}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                  activeFilter === 'tag' && selectedTagId === tag.id
                    ? 'bg-white text-black'
                    : 'hover:bg-white/10 text-white/90 font-medium'
                }`}
              >
                <span className="truncate font-medium">{tag.name}</span>
                {tag.is_system && (
                  <Badge
                    variant="outline"
                    className={`ml-2 text-[10px] ${
                      activeFilter === 'tag' && selectedTagId === tag.id
                        ? 'border-black/20 text-black/70'
                        : 'border-white/30 text-white/80'
                    }`}
                  >
                    system
                  </Badge>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2">
        <SidebarItem
          icon={<Archive className="h-4 w-4" />}
          label="Archive"
          count={counts.archive}
          active={activeFilter === 'archive'}
          onClick={() => {
            onSelectFilter('archive');
            onSelectTag(null);
          }}
        />
      </div>

      <div className="mt-6">
        <Button
          type="button"
          variant="ghost"
          className="h-7 w-full justify-start px-1 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => setShowAgents((current) => !current)}
        >
          {showAgents ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          <Sparkles className="mr-1 h-3.5 w-3.5" /> AI Agents
        </Button>

        {showAgents && (
          <div className="mt-1 space-y-1 pl-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
              >
                <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-white">
                  <Bot className="h-3 w-3" />
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse" />
                </span>
                <span className="truncate font-medium">{agent.display_name}</span>
              </button>
            ))}
            {!agents.length && <p className="px-2 py-1 text-xs text-white/60">No AI agents yet.</p>}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/70">Your Team</p>
        <div className="space-y-1">
          {sortedTeam.map((member) => (
            <button
              key={member.user_id}
              type="button"
              onClick={() => onSelectTeamMember(member.user_id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-medium text-white">
                {(member.display_name || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate font-medium">{member.display_name || 'Unnamed user'}</span>
            </button>
          ))}
          {!sortedTeam.length && <p className="px-2 py-1 text-xs text-white/60">No team members found.</p>}
        </div>
      </div>
    </aside>
  );
}

