// apps/web/src/components/canvas/nodes/ExplorationNode.tsx
'use client';

import { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Highlighter, ExternalLink, Trash2, MessageSquarePlus } from 'lucide-react';

function ExplorationNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const childCount = data.children_count || 0;
    const text = data.content || data.selected_text || data.label || '';
    const isLong = text.length > 120;

    return (
        <div
            className={`
                rounded-xl border-2 transition-all duration-200
                bg-gradient-to-br from-amber-50/80 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/10
                ${selected ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-lg' : 'border-amber-200 dark:border-amber-800/60 shadow-sm'}
                ${hovered ? 'shadow-md border-amber-300 dark:border-amber-700' : ''}
            `}
            style={{ width: 320 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />
            <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />

            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-100/50 dark:border-amber-800/30">
                <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex-shrink-0">
                    <Highlighter className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                    Highlight
                </span>
                <span className="flex-1" />
                {data.source_page !== undefined && (
                    <span className="text-[10px] font-medium text-amber-500 bg-amber-100/80 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                        p.{data.source_page + 1}
                    </span>
                )}
            </div>

            {/* Quoted text */}
            <div className="px-4 py-3">
                <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-[1.7] italic">
                    "{isLong ? text.slice(0, 150) + '…' : text}"
                </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-amber-100/50 dark:border-amber-800/30">
                <div className="flex items-center gap-2">
                    {childCount > 0 && (
                        <span className="text-[10px] font-medium text-amber-500">
                            {childCount} response{childCount !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {hovered && (
                    <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); data.onAskFollowup?.(); }} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors" title="Ask AI">
                            <MessageSquarePlus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); data.onNavigateToSource?.(); }} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors" title="View in Reader">
                            <ExternalLink className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); data.onDelete?.(); }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export const ExplorationNode = memo(ExplorationNodeComponent);