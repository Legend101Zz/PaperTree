'use client';

import { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { MermaidRenderer } from './MermaidRenderer';
import {
    ChevronDown, ChevronRight, FileText, Sparkles, MessageSquare,
    GitBranch, BookOpen, Calculator, Code, Brain, Maximize2, Minimize2,
    ExternalLink, Pin, Trash2
} from 'lucide-react';
import { CanvasNodeData, CanvasNodeType, ContentType, AskMode, ASK_MODE_ICONS } from '@/types';
import { truncateText } from '@/lib/utils';

interface RichNodeProps extends NodeProps {
    data: CanvasNodeData & {
        nodeType: CanvasNodeType;
        onToggleCollapse?: () => void;
        onDelete?: () => void;
        onNavigateToSource?: () => void;
        onExpand?: () => void;
    };
}

// Node type colors
const NODE_COLORS: Record<CanvasNodeType, { bg: string; border: string; icon: React.ElementType }> = {
    paper: { bg: 'bg-blue-50 dark:bg-blue-900/30', border: 'border-blue-300 dark:border-blue-700', icon: BookOpen },
    excerpt: { bg: 'bg-amber-50 dark:bg-amber-900/30', border: 'border-amber-300 dark:border-amber-700', icon: FileText },
    question: { bg: 'bg-purple-50 dark:bg-purple-900/30', border: 'border-purple-300 dark:border-purple-700', icon: MessageSquare },
    answer: { bg: 'bg-green-50 dark:bg-green-900/30', border: 'border-green-300 dark:border-green-700', icon: Sparkles },
    followup: { bg: 'bg-cyan-50 dark:bg-cyan-900/30', border: 'border-cyan-300 dark:border-cyan-700', icon: GitBranch },
    note: { bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-300 dark:border-gray-700', icon: FileText },
    diagram: { bg: 'bg-pink-50 dark:bg-pink-900/30', border: 'border-pink-300 dark:border-pink-700', icon: GitBranch },
};

// Ask mode icons
const ASK_MODE_ICON_MAP: Record<AskMode, React.ElementType> = {
    explain_simply: Sparkles,
    explain_math: Calculator,
    derive_steps: FileText,
    intuition: Brain,
    pseudocode: Code,
    diagram: GitBranch,
    custom: MessageSquare,
};

function extractMermaidCode(content: string): string | null {
    const match = content.match(/```mermaid\s*([\s\S]*?)```/);
    return match ? match[1].trim() : null;
}

function RichCanvasNodeComponent({ data, selected }: RichNodeProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const nodeType = data.nodeType || 'note';
    const colors = NODE_COLORS[nodeType];
    const NodeIcon = colors.icon;

    const isCollapsed = data.is_collapsed;
    const content = data.content || '';
    const contentType = data.content_type || 'markdown';

    // Determine if content has special types
    const hasMermaid = content.includes('```mermaid');
    const hasLatex = content.includes('$');
    const hasCode = content.includes('```') && !hasMermaid;

    // Extract mermaid diagram if present
    const mermaidCode = hasMermaid ? extractMermaidCode(content) : null;

    // Get ask mode icon
    const AskModeIcon = data.ask_mode ? ASK_MODE_ICON_MAP[data.ask_mode] : null;

    // Render content based on type and collapse state
    const renderContent = () => {
        if (isCollapsed) {
            return (
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                    {truncateText(content.replace(/[#*`]/g, ''), 100)}
                </p>
            );
        }

        // For mermaid diagrams
        if (contentType === 'mermaid' || (contentType === 'mixed' && mermaidCode)) {
            return (
                <div className="space-y-3">
                    {mermaidCode && <MermaidRenderer chart={mermaidCode} className="max-w-full" />}
                    {/* Render text content after mermaid */}
                    <ReactMarkdown
                        remarkPlugins={[remarkMath, remarkGfm]}
                        rehypePlugins={[rehypeKatex]}
                        className="prose prose-sm dark:prose-invert max-w-none"
                    >
                        {content.replace(/```mermaid[\s\S]*?```/g, '')}
                    </ReactMarkdown>
                </div>
            );
        }

        // For LaTeX-heavy content
        if (contentType === 'latex' || hasLatex) {
            return (
                <ReactMarkdown
                    remarkPlugins={[remarkMath, remarkGfm]}
                    rehypePlugins={[rehypeKatex]}
                    className="prose prose-sm dark:prose-invert max-w-none"
                >
                    {isExpanded ? content : truncateText(content, 500)}
                </ReactMarkdown>
            );
        }

        // Default markdown rendering
        return (
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                className="prose prose-sm dark:prose-invert max-w-none"
                components={{
                    code({ inline, className, children }) {
                        const codeContent = String(children).replace(/\n$/, '');
                        if (inline) {
                            return <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-sm">{children}</code>;
                        }
                        return (
                            <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto text-xs">
                                <code>{codeContent}</code>
                            </pre>
                        );
                    },
                }}
            >
                {isExpanded ? content : truncateText(content, 500)}
            </ReactMarkdown>
        );
    };

    return (
        <div
            className={`
                relative rounded-xl shadow-md transition-all duration-200
                ${colors.bg} border-2 ${colors.border}
                ${selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                ${isHovered ? 'shadow-lg scale-[1.02]' : ''}
            `}
            style={{
                minWidth: 280,
                maxWidth: isCollapsed ? 300 : (isExpanded ? 600 : 400),
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Handles */}
            <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />
            <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                {/* Collapse toggle */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onToggleCollapse?.();
                    }}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                >
                    {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                </button>

                {/* Node type icon */}
                <div className="p-1.5 rounded-lg bg-white/50 dark:bg-gray-800/50">
                    <NodeIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </div>

                {/* Label */}
                <span className="flex-1 font-medium text-sm text-gray-800 dark:text-gray-200 truncate">
                    {data.label}
                </span>

                {/* Ask mode badge */}
                {AskModeIcon && (
                    <div className="px-2 py-0.5 rounded-full bg-white/50 dark:bg-gray-800/50 text-xs flex items-center gap-1">
                        <AskModeIcon className="w-3 h-3" />
                        <span className="hidden sm:inline">{ASK_MODE_ICONS[data.ask_mode!]}</span>
                    </div>
                )}

                {/* Action buttons (visible on hover) */}
                {isHovered && (
                    <div className="flex items-center gap-1">
                        {!isCollapsed && content.length > 500 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded(!isExpanded);
                                }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                                {isExpanded ? (
                                    <Minimize2 className="w-3.5 h-3.5" />
                                ) : (
                                    <Maximize2 className="w-3.5 h-3.5" />
                                )}
                            </button>
                        )}
                        {data.source && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onNavigateToSource?.();
                                }}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                title="Go to source"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {data.onDelete && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onDelete?.();
                                }}
                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500"
                                title="Delete"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Question (if present) */}
            {data.question && (
                <div className="px-3 py-2 bg-white/30 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Question:</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{data.question}</p>
                </div>
            )}

            {/* Excerpt (if present) */}
            {data.excerpt && nodeType === 'excerpt' && (
                <div className="px-3 py-2 bg-amber-100/30 dark:bg-amber-900/20 border-b border-gray-200 dark:border-gray-700">
                    {data.excerpt.section_title && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                            📍 {data.excerpt.section_title}
                        </p>
                    )}
                    <p className="text-sm italic text-gray-700 dark:text-gray-300">
                        "{truncateText(data.excerpt.expanded_text || data.excerpt.selected_text, 200)}"
                    </p>
                    {data.excerpt.nearby_equations?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {data.excerpt.nearby_equations.slice(0, 2).map((eq, i) => (
                                <span key={i} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 rounded text-xs">
                                    {eq.slice(0, 30)}...
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Content */}
            {content && (
                <div className={`px-3 py-3 ${isCollapsed ? 'max-h-16 overflow-hidden' : 'overflow-auto'}`}
                    style={{ maxHeight: isExpanded ? 'none' : (isCollapsed ? 64 : 300) }}>
                    {renderContent()}
                </div>
            )}

            {/* Source reference footer */}
            {data.source && !isCollapsed && (
                <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white/30 dark:bg-gray-800/30">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            data.onNavigateToSource?.();
                        }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                        <FileText className="w-3 h-3" />
                        {data.source.page_number ? `Page ${data.source.page_number}` : 'View in paper'}
                    </button>
                </div>
            )}

            {/* Tags */}
            {data.tags && data.tags.length > 0 && !isCollapsed && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                    {data.tags.map((tag, i) => (
                        <span
                            key={i}
                            className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-400"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export const RichCanvasNode = memo(RichCanvasNodeComponent);