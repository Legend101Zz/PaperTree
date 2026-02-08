// apps/web/src/components/canvas/nodes/PageSuperNode.tsx
'use client';

import { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
    ChevronRight, ChevronDown, FileText, Layers,
    MessageSquarePlus, StickyNote, ExternalLink, Maximize2, Minimize2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

function PageSuperNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isCollapsed = data.is_collapsed;
    const childCount = data.children_count || 0;
    const hasContent = data.page_summary && data.page_summary.length > 0;
    const nodeWidth = isCollapsed ? 240 : expanded ? 560 : 380;

    return (
        <div
            className={`
                rounded-xl border-2 transition-all duration-300 ease-in-out
                ${isCollapsed
                    ? 'bg-gradient-to-br from-indigo-50/80 to-slate-50 dark:from-indigo-950/20 dark:to-slate-900 border-indigo-200 dark:border-indigo-800/60'
                    : 'bg-white dark:bg-slate-800 border-indigo-300 dark:border-indigo-700'
                }
                ${selected ? 'ring-2 ring-indigo-400/40 shadow-lg' : 'shadow-sm'}
                ${hovered ? 'shadow-md border-indigo-400 dark:border-indigo-600' : ''}
            `}
            style={{ width: nodeWidth, transition: 'width 0.3s ease' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-white dark:!border-slate-900" />
            <Handle type="source" position={Position.Bottom} className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-white dark:!border-slate-900" />

            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100/50 dark:border-slate-700/50">
                <button
                    onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
                    className="p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded transition-colors"
                >
                    {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-indigo-400" />
                        : <ChevronDown className="w-4 h-4 text-indigo-400" />
                    }
                </button>
                <Layers className="w-4 h-4 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <span className="font-semibold text-[13px] text-slate-800 dark:text-slate-200 truncate block leading-tight">
                        {data.label}
                    </span>
                    {isCollapsed && (
                        <span className="text-[10px] text-slate-400 mt-0.5 block">
                            {childCount > 0 ? `${childCount} branch${childCount !== 1 ? 'es' : ''}` : hasContent ? 'Has summary' : 'No content yet'}
                        </span>
                    )}
                </div>
                <span className="px-2.5 py-1 text-[11px] font-bold bg-indigo-500 text-white rounded-full flex-shrink-0">
                    P{(data.page_number ?? 0) + 1}
                </span>
            </div>

            {/* Expanded body */}
            {!isCollapsed && (
                <>
                    {hasContent ? (
                        <div
                            className="px-4 py-4 overflow-auto canvas-node-content"
                            style={{ maxHeight: expanded ? 'none' : 280 }}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                className="canvas-prose"
                            >
                                {expanded ? data.page_summary : data.page_summary.slice(0, 1200)}
                            </ReactMarkdown>

                            {!expanded && data.page_summary.length > 1200 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                                    className="text-xs text-indigo-500 hover:underline mt-2 block font-medium"
                                >
                                    Show full summary ↓
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="px-4 py-6 text-center">
                            <FileText className="w-6 h-6 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                            <p className="text-xs text-slate-400">No summary generated yet</p>
                        </div>
                    )}

                    {/* Action bar */}
                    {hovered && (
                        <div className="flex items-center justify-between px-4 py-2 border-t border-indigo-100/50 dark:border-slate-700/50 bg-indigo-50/30 dark:bg-indigo-950/10">
                            <div className="flex items-center gap-1.5">
                                <button onClick={(e) => { e.stopPropagation(); data.onAskFollowup?.(); }} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors">
                                    <MessageSquarePlus className="w-3 h-3" /> Ask AI
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); data.onAddNote?.(); }} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-200 transition-colors">
                                    <StickyNote className="w-3 h-3" /> Note
                                </button>
                                {hasContent && !expanded && data.page_summary.length > 400 && (
                                    <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="p-1 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded transition-colors" title="Expand">
                                        <Maximize2 className="w-3 h-3 text-indigo-400" />
                                    </button>
                                )}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); data.onNavigateToSource?.(); }} className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors">
                                <ExternalLink className="w-3 h-3" /> Reader
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export const PageSuperNode = memo(PageSuperNodeComponent);