// apps/web/src/components/canvas/nodes/AIResponseNode.tsx
'use client';

import { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
    Sparkles, Calculator, ListOrdered, Brain, Code, GitBranch,
    ChevronDown, ChevronRight, Maximize2, Minimize2, Trash2,
    MessageSquarePlus, StickyNote, ExternalLink,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { MermaidRenderer } from '../MermaidRenderer';
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

function extractMermaidBlocks(content: string): { mermaidCharts: string[]; cleanedContent: string } {
    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;
    const charts: string[] = [];
    let match;
    while ((match = mermaidRegex.exec(content)) !== null) {
        charts.push(match[1].trim());
    }
    const cleaned = content.replace(mermaidRegex, '').trim();
    return { mermaidCharts: charts, cleanedContent: cleaned };
}

function AIResponseNodeComponent({ data, selected }: NodeProps) {
    const [hovered, setHovered] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isCollapsed = data.is_collapsed;
    const content = data.content || '';
    const askMode = data.ask_mode || 'explain_simply';
    const ModeIcon = MODE_ICONS[askMode] || Sparkles;
    const modeColor = MODE_COLORS[askMode] || MODE_COLORS.explain_simply;
    const isLoading = data.status === 'loading';
    const childCount = data.children_count || 0;

    const { mermaidCharts, cleanedContent } = useMemo(
        () => extractMermaidBlocks(content),
        [content],
    );
    const hasMermaid = mermaidCharts.length > 0;

    // Width scales with expand state for readability
    const nodeWidth = isCollapsed ? 300 : expanded ? 640 : 420;

    return (
        <div
            className={`
                rounded-xl border-2 transition-all duration-300 ease-in-out
                bg-white dark:bg-gray-800
                ${isLoading ? 'border-blue-300 dark:border-blue-700 animate-pulse shadow-md' : ''}
                ${!isLoading && selected ? 'border-blue-400 dark:border-blue-600 ring-2 ring-blue-400/30 shadow-lg' : ''}
                ${!isLoading && !selected ? 'border-gray-200 dark:border-gray-700 shadow-sm' : ''}
                ${hovered && !isLoading ? 'shadow-md border-blue-300 dark:border-blue-700' : ''}
            `}
            style={{ width: nodeWidth, transition: 'width 0.3s ease' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />
            <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-3 !h-3 !border-2 !border-white dark:!border-gray-900" />

            {/* ── Header ── */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
                {/* Collapse toggle */}
                <button
                    onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
                    className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                    {isCollapsed
                        ? <ChevronRight className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />
                    }
                </button>

                {/* Mode badge */}
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${modeColor}`}>
                    <ModeIcon className="w-3 h-3" />
                    {askMode?.replace(/_/g, ' ')}
                </div>

                <span className="flex-1" />

                {/* Collapsed meta */}
                {isCollapsed && (
                    <div className="flex items-center gap-1.5">
                        {hasMermaid && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 font-medium">
                                📊
                            </span>
                        )}
                        {childCount > 0 && (
                            <span className="text-[10px] text-gray-400 font-medium">
                                {childCount} branch{childCount !== 1 ? 'es' : ''}
                            </span>
                        )}
                    </div>
                )}

                {/* Expand full-width toggle */}
                {!isCollapsed && content.length > 500 && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title={expanded ? 'Compact' : 'Expand for readability'}
                    >
                        {expanded
                            ? <Minimize2 className="w-3.5 h-3.5 text-gray-400" />
                            : <Maximize2 className="w-3.5 h-3.5 text-gray-400" />
                        }
                    </button>
                )}

                {/* Actions on hover */}
                {hovered && (
                    <div className="flex items-center gap-0.5 ml-1">
                        <button onClick={(e) => { e.stopPropagation(); data.onAskFollowup?.(); }} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded" title="Ask follow-up">
                            <MessageSquarePlus className="w-3.5 h-3.5 text-blue-500" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); data.onAddNote?.(); }} className="p-1 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded" title="Add note">
                            <StickyNote className="w-3.5 h-3.5 text-amber-500" />
                        </button>
                        {data.onNavigateToSource && (
                            <button onClick={(e) => { e.stopPropagation(); data.onNavigateToSource(); }} className="p-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded" title="Open in Reader">
                                <ExternalLink className="w-3.5 h-3.5 text-indigo-500" />
                            </button>
                        )}
                        {data.onDelete && (
                            <button onClick={(e) => { e.stopPropagation(); data.onDelete(); }} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Question bar ── */}
            {data.question && !isCollapsed && (
                <div className="px-4 py-2.5 bg-blue-50/60 dark:bg-blue-950/20 border-b border-blue-100/50 dark:border-blue-900/30">
                    <p className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wide mb-0.5">Question</p>
                    <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed">{data.question}</p>
                </div>
            )}

            {/* ── Body ── */}
            {isLoading ? (
                <div className="px-4 py-8 text-center">
                    <Sparkles className="w-5 h-5 mx-auto mb-2 text-blue-500 animate-spin" />
                    <p className="text-xs text-gray-500">Generating...</p>
                </div>
            ) : content && !isCollapsed ? (
                <div
                    className="px-4 py-4 overflow-auto canvas-node-content"
                    style={{ maxHeight: expanded ? 'none' : 380 }}
                >
                    {/* Mermaid diagrams */}
                    {hasMermaid && (
                        <div className="mb-4 space-y-3">
                            {mermaidCharts.map((chart, i) => (
                                <div
                                    key={i}
                                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-900/30"
                                >
                                    <MermaidRenderer chart={chart} className="max-w-full" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Markdown body */}
                    <ReactMarkdown
                        remarkPlugins={[remarkMath, remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        className="canvas-prose"
                        components={{
                            code({ inline, className, children, ...props }: any) {
                                const codeStr = String(children).replace(/\n$/, '');
                                if (className === 'language-mermaid' || (!inline && codeStr.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/))) {
                                    return (
                                        <div className="my-3 border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-900/30">
                                            <MermaidRenderer chart={codeStr} className="max-w-full" />
                                        </div>
                                    );
                                }
                                if (inline) {
                                    return <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-900 rounded text-[12px] font-mono" {...props}>{children}</code>;
                                }
                                return (
                                    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-[12px] leading-relaxed my-3 font-mono">
                                        <code>{codeStr}</code>
                                    </pre>
                                );
                            },
                        }}
                    >
                        {expanded ? cleanedContent : cleanedContent.slice(0, 1800)}
                    </ReactMarkdown>

                    {!expanded && cleanedContent.length > 1800 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                            className="text-xs text-blue-500 hover:text-blue-700 hover:underline mt-3 block font-medium"
                        >
                            Show full response ↓
                        </button>
                    )}
                </div>
            ) : isCollapsed && content ? (
                <div className="px-4 py-2.5">
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                        {hasMermaid ? '📊 Diagram · ' : ''}
                        {content.replace(/[#*`$]/g, '').replace(/```mermaid[\s\S]*?```/g, '').slice(0, 120)}
                    </p>
                </div>
            ) : null}

            {/* ── Footer ── */}
            {data.model && !isCollapsed && (
                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/50">
                    <span className="text-[10px] text-gray-400 font-medium">
                        {data.model}{data.tokens_used ? ` · ${data.tokens_used} tokens` : ''}
                    </span>
                </div>
            )}
        </div>
    );
}

export const AIResponseNode = memo(AIResponseNodeComponent);