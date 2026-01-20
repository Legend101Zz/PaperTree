// apps/web/src/components/reader/InlineExplanation.tsx
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, Explanation } from '@/types';
import {
    X, MessageSquare, Pin, Check, ChevronDown, ChevronUp,
    Sparkles, Send, Loader2, FileText, RefreshCw
} from 'lucide-react';

interface InlineExplanationProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onFollowUp: (parentId: string, question: string) => void;
    onTogglePin: (id: string, isPinned: boolean) => void;
    onToggleResolved: (id: string, isResolved: boolean) => void;
    onGoToPdf: (page: number) => void;
    isLoading: boolean;
}

export function InlineExplanation({
    highlights,
    explanations,
    onFollowUp,
    onTogglePin,
    onToggleResolved,
    onGoToPdf,
    isLoading,
}: InlineExplanationProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [followUpText, setFollowUpText] = useState('');
    const [activeFollowUp, setActiveFollowUp] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const inlineExplanation = useReaderStore((state) => state.inlineExplanation);
    const closeInlineExplanation = useReaderStore((state) => state.closeInlineExplanation);
    const settings = useReaderStore((state) => state.settings);

    const { isOpen, highlightId, position } = inlineExplanation;

    // Get the highlight and its explanations
    const highlight = highlights.find((h) => h.id === highlightId);

    // FIXED: Get all explanations for this highlight
    const highlightExplanations = explanations.filter((e) => e.highlight_id === highlightId);
    const rootExplanations = highlightExplanations.filter((e) => !e.parent_id);

    // Debug log
    useEffect(() => {
        if (isOpen && highlightId) {
            console.log('InlineExplanation opened for highlight:', highlightId);
            console.log('All explanations:', explanations);
            console.log('Highlight explanations:', highlightExplanations);
            console.log('Root explanations:', rootExplanations);
        }
    }, [isOpen, highlightId, explanations, highlightExplanations, rootExplanations]);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                closeInlineExplanation();
            }
        };

        if (isOpen) {
            // Delay to prevent immediate close
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
            if (e.key === 'Escape' && isOpen) {
                closeInlineExplanation();
            }
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

    // Position calculation
    const popupWidth = 450;
    const popupMaxHeight = 520;
    const padding = 16;

    let left = Math.min(position.x, window.innerWidth - popupWidth - padding);
    left = Math.max(padding, left);

    let top = position.y + 10;
    if (top + popupMaxHeight > window.innerHeight - padding) {
        top = Math.max(padding, position.y - popupMaxHeight - 10);
    }

    // Theme
    const isDark = settings.theme === 'dark';
    const isSepia = settings.theme === 'sepia';

    const colors = {
        bg: isDark ? 'bg-gray-900' : isSepia ? 'bg-[#faf6ed]' : 'bg-white',
        border: isDark ? 'border-gray-700' : isSepia ? 'border-[#d4c4a8]' : 'border-gray-200',
        text: isDark ? 'text-gray-100' : isSepia ? 'text-[#5c4b37]' : 'text-gray-800',
        muted: isDark ? 'text-gray-400' : isSepia ? 'text-[#8b7355]' : 'text-gray-500',
        card: isDark ? 'bg-gray-800' : isSepia ? 'bg-[#f0e6d3]' : 'bg-gray-50',
        input: isDark ? 'bg-gray-800 border-gray-600' : isSepia ? 'bg-[#faf6ed] border-[#d4c4a8]' : 'bg-white border-gray-300',
    };

    const renderExplanation = (exp: Explanation, depth: number = 0) => {
        const isExpanded = expanded.has(exp.id);
        const children = explanations.filter((e) => e.parent_id === exp.id);
        const preview = exp.answer_markdown.slice(0, 300);
        const hasMore = exp.answer_markdown.length > 300;

        return (
            <div
                key={exp.id}
                className={`${depth > 0 ? 'ml-3 pl-3 border-l-2 border-blue-300 dark:border-blue-700' : ''} mb-3`}
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
                                className={`p-1 rounded ${exp.is_pinned ? 'text-yellow-500' : colors.muted} hover:bg-gray-200 dark:hover:bg-gray-700`}
                            >
                                <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => onToggleResolved(exp.id, !exp.is_resolved)}
                                className={`p-1 rounded ${exp.is_resolved ? 'text-green-500' : colors.muted} hover:bg-gray-200 dark:hover:bg-gray-700`}
                            >
                                <Check className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Answer content */}
                    <div className={`prose prose-sm max-w-none ${colors.text} overflow-hidden`}>
                        <ReactMarkdown
                            remarkPlugins={[remarkMath, remarkGfm]}
                            rehypePlugins={[rehypeKatex]}
                        >
                            {isExpanded ? exp.answer_markdown : preview + (hasMore ? '...' : '')}
                        </ReactMarkdown>
                    </div>

                    {/* Expand/collapse */}
                    {hasMore && (
                        <button
                            onClick={() => toggleExpand(exp.id)}
                            className={`text-xs mt-2 flex items-center gap-1 text-blue-500 hover:text-blue-600`}
                        >
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                    )}

                    {/* Follow-up toggle */}
                    <button
                        onClick={() => setActiveFollowUp(activeFollowUp === exp.id ? null : exp.id)}
                        className={`text-xs mt-2 flex items-center gap-1 ${colors.muted} hover:text-blue-500`}
                    >
                        <MessageSquare className="w-3 h-3" />
                        Ask follow-up
                    </button>

                    {/* Follow-up input */}
                    {activeFollowUp === exp.id && (
                        <div className="mt-2 flex gap-2">
                            <input
                                type="text"
                                value={followUpText}
                                onChange={(e) => setFollowUpText(e.target.value)}
                                placeholder="Ask a follow-up..."
                                className={`flex-1 px-3 py-1.5 text-sm border rounded-lg ${colors.input}`}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && followUpText.trim()) {
                                        handleFollowUp(exp.id);
                                    }
                                }}
                                autoFocus
                            />
                            <button
                                onClick={() => handleFollowUp(exp.id)}
                                disabled={!followUpText.trim() || isLoading}
                                className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                        </div>
                    )}
                </div>

                {/* Children */}
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
            className={`fixed z-50 ${colors.bg} rounded-xl shadow-2xl border ${colors.border} overflow-hidden`}
            style={{
                left,
                top,
                width: popupWidth,
                maxHeight: popupMaxHeight,
            }}
        >
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${colors.border} ${colors.card}`}>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className={`text-sm font-semibold ${colors.text}`}>
                        AI Explanation
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${colors.card} ${colors.muted} border ${colors.border}`}>
                        {highlightExplanations.length}
                    </span>
                </div>
                <button
                    onClick={closeInlineExplanation}
                    className={`p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 ${colors.muted}`}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Highlighted text */}
            {highlight && (
                <div className={`px-4 py-3 border-b ${colors.border} ${colors.card}`}>
                    <p className={`text-xs font-medium ${colors.muted} mb-1`}>Selected text:</p>
                    <p className={`text-sm ${colors.text} italic line-clamp-2`}>
                        "{highlight.selected_text}"
                    </p>
                    {highlight.page_number && (
                        <button
                            onClick={() => onGoToPdf(highlight.page_number! - 1)}
                            className={`mt-2 text-xs flex items-center gap-1 ${colors.muted} hover:text-blue-500`}
                        >
                            <FileText className="w-3 h-3" />
                            View in PDF (page {highlight.page_number})
                        </button>
                    )}
                </div>
            )}

            {/* Explanations list */}
            <div className="p-4 overflow-y-auto" style={{ maxHeight: popupMaxHeight - 160 }}>
                {rootExplanations.length > 0 ? (
                    rootExplanations.map((exp) => renderExplanation(exp))
                ) : isLoading ? (
                    <div className={`text-center py-8 ${colors.muted}`}>
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
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