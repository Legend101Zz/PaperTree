// apps/web/src/components/reader/InlineExplanation.tsx
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, Explanation, AskMode } from '@/types';
import {
    X, MessageSquare, Pin, Check, ChevronDown, ChevronUp,
    Sparkles, Send, Loader2, FileText, RefreshCw, GitBranch
} from 'lucide-react';

interface InlineExplanationProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onFollowUp: (parentId: string, question: string) => void;
    onTogglePin: (id: string, isPinned: boolean) => void;
    onToggleResolved: (id: string, isResolved: boolean) => void;
    onGoToPdf: (page: number) => void;
    isLoading: boolean;
    onExploreInCanvas?: (
        highlightId: string,
        selectedText: string,
        pageNumber: number,
        question?: string,
        askMode?: AskMode,
    ) => void;
}

function getThemeColors(theme: string) {
    const themes = {
        light: {
            bg: 'bg-white',
            border: 'border-gray-200',
            text: 'text-gray-800',
            muted: 'text-gray-500',
            card: 'bg-gray-50',
            cardHover: 'hover:bg-gray-100',
            input: 'bg-white border-gray-300 focus:border-amber-400 focus:ring-amber-400/20',
            accent: 'text-amber-600',
            accentBg: 'bg-amber-50',
            accentBorder: 'border-amber-200',
            accentButton: 'bg-amber-500 hover:bg-amber-600',
            headerBg: 'bg-gradient-to-r from-amber-50 to-yellow-50',
            highlightBg: 'bg-amber-50/50',
            shadow: 'shadow-xl shadow-amber-500/10'
        },
        dark: {
            bg: 'bg-gray-900',
            border: 'border-gray-700',
            text: 'text-gray-100',
            muted: 'text-gray-400',
            card: 'bg-gray-800',
            cardHover: 'hover:bg-gray-700',
            input: 'bg-gray-800 border-gray-600 focus:border-cyan-400 focus:ring-cyan-400/20',
            accent: 'text-cyan-400',
            accentBg: 'bg-cyan-500/10',
            accentBorder: 'border-cyan-500/30',
            accentButton: 'bg-cyan-500 hover:bg-cyan-600',
            headerBg: 'bg-gradient-to-r from-cyan-900/30 to-teal-900/30',
            highlightBg: 'bg-cyan-500/10',
            shadow: 'shadow-2xl shadow-cyan-500/20'
        },
        sepia: {
            bg: 'bg-[#faf6ed]',
            border: 'border-[#d4c4a8]',
            text: 'text-[#5c4b37]',
            muted: 'text-[#8b7355]',
            card: 'bg-[#f0e6d3]',
            cardHover: 'hover:bg-[#e8dcc8]',
            input: 'bg-[#faf6ed] border-[#c9b896] focus:border-orange-500 focus:ring-orange-500/20',
            accent: 'text-orange-700',
            accentBg: 'bg-orange-100/50',
            accentBorder: 'border-orange-300',
            accentButton: 'bg-orange-600 hover:bg-orange-700',
            headerBg: 'bg-gradient-to-r from-orange-100/50 to-amber-100/50',
            highlightBg: 'bg-orange-100/30',
            shadow: 'shadow-xl shadow-orange-500/10'
        }
    };
    return themes[theme as keyof typeof themes] || themes.light;
}

export function InlineExplanation({
    highlights,
    explanations,
    onFollowUp,
    onTogglePin,
    onToggleResolved,
    onGoToPdf,
    isLoading,
    onExploreInCanvas,
}: InlineExplanationProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [followUpText, setFollowUpText] = useState('');
    const [activeFollowUp, setActiveFollowUp] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const inlineExplanation = useReaderStore((state) => state.inlineExplanation);
    const closeInlineExplanation = useReaderStore((state) => state.closeInlineExplanation);
    const settings = useReaderStore((state) => state.settings);

    const { isOpen, highlightId, position } = inlineExplanation;
    const colors = getThemeColors(settings.theme);

    const highlight = highlights.find((h) => h.id === highlightId);
    const highlightExplanations = explanations.filter((e) => e.highlight_id === highlightId);
    const rootExplanations = highlightExplanations.filter((e) => !e.parent_id);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                closeInlineExplanation();
            }
        };
        if (isOpen) {
            const timer = setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);
            return () => {
                clearTimeout(timer);
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [isOpen, closeInlineExplanation]);

    // Escape to close
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) closeInlineExplanation();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, closeInlineExplanation]);

    const handleFollowUp = useCallback((parentId: string) => {
        if (followUpText.trim()) {
            onFollowUp(parentId, followUpText);
            setFollowUpText('');
            setActiveFollowUp(null);
        }
    }, [followUpText, onFollowUp]);

    const toggleExpand = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    if (!isOpen || !position) return null;

    const popupWidth = 450;
    const popupMaxHeight = 520;
    const padding = 16;

    let left = Math.min(position.x, window.innerWidth - popupWidth - padding);
    left = Math.max(padding, left);

    let top = position.y + 10;
    if (top + popupMaxHeight > window.innerHeight - padding) {
        top = Math.max(padding, position.y - popupMaxHeight - 10);
    }

    const renderExplanation = (exp: Explanation, depth: number = 0) => {
        const isExpanded = expanded.has(exp.id);
        const children = explanations.filter((e) => e.parent_id === exp.id);
        const preview = exp.answer_markdown.slice(0, 300);
        const hasMore = exp.answer_markdown.length > 300;

        return (
            <div
                key={exp.id}
                className={`${depth > 0 ? `ml-3 pl-3 border-l-2 ${colors.accentBorder}` : ''} mb-3`}
            >
                <div className={`rounded-lg p-3 ${colors.card}`}>
                    {/* Question header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <p className={`text-sm font-medium ${colors.text}`}>
                            Q: {exp.question}
                        </p>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                                onClick={() => onTogglePin(exp.id, !exp.is_pinned)}
                                className={`p-1 rounded transition-colors ${exp.is_pinned ? 'text-yellow-500' : colors.muted} ${colors.cardHover}`}
                            >
                                <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => onToggleResolved(exp.id, !exp.is_resolved)}
                                className={`p-1 rounded transition-colors ${exp.is_resolved ? 'text-green-500' : colors.muted} ${colors.cardHover}`}
                            >
                                <Check className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Answer */}
                    <div className={`prose prose-sm max-w-none ${colors.text} overflow-hidden`}>
                        <ReactMarkdown
                            remarkPlugins={[remarkMath, remarkGfm]}
                            rehypePlugins={[rehypeKatex]}
                        >
                            {isExpanded ? exp.answer_markdown : preview + (hasMore ? '...' : '')}
                        </ReactMarkdown>
                    </div>

                    {hasMore && (
                        <button
                            onClick={() => toggleExpand(exp.id)}
                            className={`text-xs mt-2 flex items-center gap-1 ${colors.accent} hover:underline`}
                        >
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                    )}

                    {/* Action buttons row */}
                    <div className="flex items-center gap-3 mt-2">
                        <button
                            onClick={() => setActiveFollowUp(activeFollowUp === exp.id ? null : exp.id)}
                            className={`text-xs flex items-center gap-1 ${colors.muted} hover:${colors.accent}`}
                        >
                            <MessageSquare className="w-3 h-3" />
                            Follow-up
                        </button>

                        {/* Explore in Canvas button */}
                        {onExploreInCanvas && highlight && (
                            <button
                                onClick={() => onExploreInCanvas(
                                    highlight.id,
                                    highlight.selected_text,
                                    highlight.page_number || 0,
                                    exp.question,
                                    exp.ask_mode,
                                )}
                                className="text-xs flex items-center gap-1 text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                            >
                                <GitBranch className="w-3 h-3" />
                                Explore in Canvas
                            </button>
                        )}
                    </div>

                    {/* Follow-up input */}
                    {activeFollowUp === exp.id && (
                        <div className="mt-2 flex gap-2">
                            <input
                                type="text"
                                value={followUpText}
                                onChange={(e) => setFollowUpText(e.target.value)}
                                placeholder="Ask a follow-up..."
                                className={`flex-1 px-3 py-1.5 text-sm border rounded-lg ${colors.input} focus:outline-none focus:ring-2`}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && followUpText.trim()) handleFollowUp(exp.id);
                                }}
                                autoFocus
                            />
                            <button
                                onClick={() => handleFollowUp(exp.id)}
                                disabled={!followUpText.trim() || isLoading}
                                className={`p-2 ${colors.accentButton} text-white rounded-lg disabled:opacity-50 transition-colors`}
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                        </div>
                    )}
                </div>

                {children.length > 0 && (
                    <div className="mt-2">
                        {children.map((child) => renderExplanation(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            ref={popupRef}
            className={`fixed z-50 ${colors.bg} rounded-xl ${colors.shadow} border ${colors.border} overflow-hidden`}
            style={{ left, top, width: popupWidth, maxHeight: popupMaxHeight }}
        >
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${colors.border} ${colors.headerBg}`}>
                <div className="flex items-center gap-2">
                    <Sparkles className={`w-4 h-4 ${colors.accent}`} />
                    <span className={`text-sm font-semibold ${colors.text}`}>AI Explanation</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${colors.accentBg} ${colors.accent} border ${colors.accentBorder}`}>
                        {highlightExplanations.length}
                    </span>
                </div>
                <button
                    onClick={closeInlineExplanation}
                    className={`p-1.5 rounded-lg ${colors.cardHover} ${colors.muted} transition-colors`}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Highlighted text */}
            {highlight && (
                <div className={`px-4 py-3 border-b ${colors.border} ${colors.highlightBg}`}>
                    <p className={`text-xs font-medium ${colors.muted} mb-1`}>Selected text:</p>
                    <p className={`text-sm ${colors.text} italic line-clamp-2`}>
                        &ldquo;{highlight.selected_text}&rdquo;
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                        {highlight.page_number && (
                            <button
                                onClick={() => onGoToPdf(highlight.page_number! - 1)}
                                className={`text-xs flex items-center gap-1 ${colors.muted} hover:${colors.accent} transition-colors`}
                            >
                                <FileText className="w-3 h-3" />
                                View in PDF (page {highlight.page_number})
                            </button>
                        )}
                        {/* Top-level explore button for the whole highlight */}
                        {onExploreInCanvas && (
                            <button
                                onClick={() => onExploreInCanvas(
                                    highlight.id,
                                    highlight.selected_text,
                                    highlight.page_number || 0,
                                )}
                                className="text-xs flex items-center gap-1 text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                            >
                                <GitBranch className="w-3 h-3" />
                                Explore in Canvas
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Explanations list */}
            <div className="p-4 overflow-y-auto" style={{ maxHeight: popupMaxHeight - 160 }}>
                {rootExplanations.length > 0 ? (
                    rootExplanations.map((exp) => renderExplanation(exp))
                ) : isLoading ? (
                    <div className={`text-center py-8 ${colors.muted}`}>
                        <Loader2 className={`w-8 h-8 animate-spin mx-auto mb-3 ${colors.accent}`} />
                        <p className="text-sm font-medium">Generating explanation...</p>
                        <p className="text-xs mt-1">This may take a few seconds</p>
                    </div>
                ) : (
                    <div className={`text-center py-8 ${colors.muted}`}>
                        <RefreshCw className="w-8 h-8 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No explanations yet</p>
                        <p className="text-xs mt-1">The explanation may still be loading...</p>
                    </div>
                )}
            </div>
        </div>
    );
}