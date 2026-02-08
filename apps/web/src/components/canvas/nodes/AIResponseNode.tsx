// apps/web/src/components/canvas/nodes/AIResponseNode.tsx
'use client';

import { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
    Sparkles, Calculator, ListOrdered, Brain, Code, GitBranch,
    ChevronDown, ChevronRight, Maximize2, Minimize2, Trash2,
    MessageSquarePlus, StickyNote,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import type { AskMode } from '@/types/canvas';

const MODE_ICONS: Record<string, React.ElementType> = {
    explain_simply: Sparkles,
    explain_math: Calculator,
    derive_steps: ListOrdered,
    intuition: Brain,
    pseudocode: Code,
    diagram: GitBranch,
};

const MODE_COLORS: Record<string, string> = {
    explain_simply: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    explain_math: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    derive_steps: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    intuition: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    pseudocode: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    diagram: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
};

function AIResponseNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isCollapsed = data.is_collapsed;
    const content = data.content || '';
    const askMode = data.ask_mode || 'explain_simply';
    const ModeIcon = MODE_ICONS[askMode] || Sparkles;
    const modeColor = MODE_COLORS[askMode] || MODE_COLORS.explain_simply;
    const isLoading = data.status === 'loading';

    return (
        <div
            className={`
        rounded-xl shadow-md border-2 transition-all duration-200
        bg-white dark:bg-gray-800 border-blue-200 dark:border-blue-800
        ${selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
        ${hovered ? 'shadow-lg scale-[1.01]' : ''}
        ${isLoading ? 'animate-pulse' : ''}
      `}
            style={{
                minWidth: 280,
                maxWidth: isCollapsed ? 300 : (expanded ? 600 : 420),
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-3 !h-3" />
            <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                >
                    {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-gray-500" />
                        : <ChevronDown className="w-4 h-4 text-gray-500" />
                    }
                </button>

                <div className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${modeColor}`}>
                    <ModeIcon className="w-3 h-3" />
                    <span className="hidden sm:inline">{askMode.replace('_', ' ')}</span>
                </div>

                <span className="flex-1 font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
                    {data.question || data.label}
                </span>

                {hovered && (
                    <div className="flex items-center gap-0.5">
                        {!isCollapsed && content.length > 400 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                title={expanded ? 'Compact' : 'Expand'}
                            >
                                {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); data.onAskFollowup?.(); }}
                            className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded"
                            title="Ask follow-up"
                        >
                            <MessageSquarePlus className="w-3.5 h-3.5 text-blue-500" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); data.onAddNote?.(); }}
                            className="p-1 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded"
                            title="Add note"
                        >
                            <StickyNote className="w-3.5 h-3.5 text-amber-500" />
                        </button>
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

            {/* Question */}
            {data.question && !isCollapsed && (
                <div className="px-3 py-2 bg-blue-50/50 dark:bg-blue-950/20 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Question:</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{data.question}</p>
                </div>
            )}

            {/* Content */}
            {isLoading ? (
                <div className="px-3 py-6 text-center">
                    <Sparkles className="w-5 h-5 mx-auto mb-2 text-blue-500 animate-spin" />
                    <p className="text-xs text-gray-500">Generating...</p>
                </div>
            ) : content && !isCollapsed ? (
                <div
                    className="px-3 py-3 overflow-auto"
                    style={{ maxHeight: expanded ? 'none' : 300 }}
                >
                    <ReactMarkdown
                        remarkPlugins={[remarkMath, remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        className="prose prose-sm dark:prose-invert max-w-none"
                        components={{
                            code({ inline, className, children }: any) {
                                if (inline) {
                                    return <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-900 rounded text-xs">{children}</code>;
                                }
                                return (
                                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto text-xs">
                                        <code>{String(children).replace(/\n$/, '')}</code>
                                    </pre>
                                );
                            },
                        }}
                    >
                        {expanded ? content : content.slice(0, 1500)}
                    </ReactMarkdown>
                    {!expanded && content.length > 1500 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                            className="text-xs text-blue-500 hover:underline mt-2"
                        >
                            Show more...
                        </button>
                    )}
                </div>
            ) : isCollapsed && content ? (
                <div className="px-3 py-2">
                    <p className="text-xs text-gray-500 line-clamp-2">
                        {content.replace(/[#*`$]/g, '').slice(0, 100)}
                    </p>
                </div>
            ) : null}

            {/* Footer: model info */}
            {data.model && !isCollapsed && (
                <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
                    <span className="text-[10px] text-gray-400">
                        {data.model} {data.tokens_used ? `· ${data.tokens_used} tokens` : ''}
                    </span>
                </div>
            )}
        </div>
    );
}

export const AIResponseNode = memo(AIResponseNodeComponent);