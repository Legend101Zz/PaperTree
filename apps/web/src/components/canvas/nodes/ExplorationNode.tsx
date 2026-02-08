// apps/web/src/components/canvas/nodes/ExplorationNode.tsx
'use client';

import { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Highlighter, ExternalLink, Trash2 } from 'lucide-react';

function ExplorationNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className={`
        rounded-xl shadow-md border-2 transition-all duration-200
        bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700
        ${selected ? 'ring-2 ring-amber-500 ring-offset-2' : ''}
        ${hovered ? 'shadow-lg scale-[1.01]' : ''}
      `}
            style={{ minWidth: 260, maxWidth: 360 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-3 !h-3" />
            <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 dark:border-amber-800">
                <div className="p-1.5 rounded-lg bg-amber-200 dark:bg-amber-800/60">
                    <Highlighter className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                </div>
                <span className="flex-1 text-xs font-medium text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                    Highlighted Text
                </span>
                {hovered && (
                    <div className="flex items-center gap-1">
                        {data.onNavigateToSource && (
                            <button
                                onClick={(e) => { e.stopPropagation(); data.onNavigateToSource(); }}
                                className="p-1 hover:bg-amber-200 dark:hover:bg-amber-800 rounded"
                                title="Go to source"
                            >
                                <ExternalLink className="w-3.5 h-3.5 text-amber-600" />
                            </button>
                        )}
                        {data.onDelete && (
                            <button
                                onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                                title="Delete"
                            >
                                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Excerpt */}
            <div className="px-3 py-3">
                <p className="text-sm italic text-amber-900 dark:text-amber-100 leading-relaxed">
                    &ldquo;{data.selected_text || data.content || data.label}&rdquo;
                </p>
                {data.source_page !== undefined && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        📍 Page {data.source_page + 1}
                    </p>
                )}
            </div>
        </div>
    );
}

export const ExplorationNode = memo(ExplorationNodeComponent);