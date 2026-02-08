// apps/web/src/components/canvas/nodes/PageSuperNode.tsx
'use client';

import { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChevronRight, ChevronDown, FileText, Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

function PageSuperNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const isCollapsed = data.is_collapsed;
    const childCount = data.children_count || 0;

    return (
        <div
            className={`
        rounded-xl shadow-lg border-2 transition-all duration-200
        ${selected ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}
        ${isCollapsed
                    ? 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-slate-300 dark:border-slate-600'
                    : 'bg-white dark:bg-slate-800 border-indigo-300 dark:border-indigo-600'
                }
        ${hovered ? 'shadow-xl scale-[1.01]' : ''}
      `}
            style={{ minWidth: isCollapsed ? 200 : 320, maxWidth: isCollapsed ? 260 : 400 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-indigo-400 !w-3 !h-3" />
            <Handle type="source" position={Position.Bottom} className="!bg-indigo-400 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                <button
                    onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"
                >
                    {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-slate-500" />
                        : <ChevronDown className="w-4 h-4 text-slate-500" />
                    }
                </button>
                <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/40">
                    <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate block">
                        {data.label}
                    </span>
                    {isCollapsed && childCount > 0 && (
                        <span className="text-xs text-slate-500">
                            {childCount} branch{childCount !== 1 ? 'es' : ''}
                        </span>
                    )}
                </div>
                {data.page_number !== undefined && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full">
                        P{data.page_number + 1}
                    </span>
                )}
            </div>

            {/* Summary (when expanded) */}
            {!isCollapsed && data.page_summary && (
                <div className="px-3 py-3 max-h-48 overflow-y-auto">
                    <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300"
                    >
                        {data.page_summary}
                    </ReactMarkdown>
                </div>
            )}

            {!isCollapsed && !data.page_summary && (
                <div className="px-3 py-3 text-center text-xs text-slate-400">
                    <FileText className="w-5 h-5 mx-auto mb-1" />
                    No summary generated yet
                </div>
            )}
        </div>
    );
}

export const PageSuperNode = memo(PageSuperNodeComponent);