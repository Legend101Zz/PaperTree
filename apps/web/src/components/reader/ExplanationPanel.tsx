'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Explanation, Highlight } from '@/types';
import { Button } from '@/components/ui/Button';
import {
    Pin,
    Check,
    MessageSquare,
    ChevronDown,
    ChevronRight,
    FileText,
    Layout
} from 'lucide-react';
import { formatDate, truncateText } from '@/lib/utils';

interface ExplanationPanelProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onFollowUp: (explanationId: string, question: string) => void;
    onTogglePin: (explanationId: string, isPinned: boolean) => void;
    onToggleResolved: (explanationId: string, isResolved: boolean) => void;
    onSummarize: (explanationId: string) => void;
    onHighlightClick: (highlightId: string) => void;
    onSendToCanvas: (highlightId: string, explanations: Explanation[]) => void;
    isLoading: boolean;
    activeHighlightId: string | null;
}

export function ExplanationPanel({
    highlights,
    explanations,
    onFollowUp,
    onTogglePin,
    onToggleResolved,
    onSummarize,
    onHighlightClick,
    onSendToCanvas,
    isLoading,
    activeHighlightId
}: ExplanationPanelProps) {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [followUpInputs, setFollowUpInputs] = useState<Record<string, string>>({});

    // Group explanations by highlight
    const groupedExplanations = highlights.map(highlight => ({
        highlight,
        explanations: explanations.filter(exp => exp.highlight_id === highlight.id)
    })).filter(group => group.explanations.length > 0);

    const toggleExpand = (id: string) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedIds(newExpanded);
    };

    const renderExplanation = (exp: Explanation, depth: number = 0) => {
        const isExpanded = expandedIds.has(exp.id);
        const children = explanations.filter(e => e.parent_id === exp.id);
        const followUpInput = followUpInputs[exp.id] || '';

        return (
            <div
                key={exp.id}
                className={`border-l-2 ${depth > 0 ? 'ml-4' : ''} ${exp.is_resolved ? 'border-green-500' : 'border-blue-500'
                    }`}
            >
                <div className="pl-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                            Q: {exp.question}
                        </p>
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                onClick={() => onTogglePin(exp.id, !exp.is_pinned)}
                                className={`p-1 rounded ${exp.is_pinned ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'
                                    }`}
                            >
                                <Pin className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => onToggleResolved(exp.id, !exp.is_resolved)}
                                className={`p-1 rounded ${exp.is_resolved ? 'text-green-500' : 'text-gray-400 hover:text-green-500'
                                    }`}
                            >
                                <Check className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {isExpanded ? exp.answer_markdown : truncateText(exp.answer_markdown, 300)}
                        </ReactMarkdown>
                    </div>

                    {exp.answer_markdown.length > 300 && (
                        <button
                            onClick={() => toggleExpand(exp.id)}
                            className="text-sm text-blue-500 hover:text-blue-600 mt-2"
                        >
                            {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                        <input
                            type="text"
                            value={followUpInput}
                            onChange={(e) => setFollowUpInputs({ ...followUpInputs, [exp.id]: e.target.value })}
                            placeholder="Follow-up question..."
                            className="flex-1 px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && followUpInput.trim()) {
                                    onFollowUp(exp.id, followUpInput);
                                    setFollowUpInputs({ ...followUpInputs, [exp.id]: '' });
                                }
                            }}
                        />
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                if (followUpInput.trim()) {
                                    onFollowUp(exp.id, followUpInput);
                                    setFollowUpInputs({ ...followUpInputs, [exp.id]: '' });
                                }
                            }}
                            disabled={!followUpInput.trim() || isLoading}
                        >
                            <MessageSquare className="w-4 h-4" />
                        </Button>
                    </div>

                    {children.length > 0 && (
                        <div className="mt-2">
                            <button
                                onClick={() => toggleExpand(`children-${exp.id}`)}
                                className="text-sm text-gray-500 flex items-center gap-1"
                            >
                                {expandedIds.has(`children-${exp.id}`) ? (
                                    <ChevronDown className="w-4 h-4" />
                                ) : (
                                    <ChevronRight className="w-4 h-4" />
                                )}
                                {children.length} follow-up{children.length > 1 ? 's' : ''}
                            </button>

                            {expandedIds.has(`children-${exp.id}`) && (
                                <div className="mt-2">
                                    {children.map(child => renderExplanation(child, depth + 1))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    if (groupedExplanations.length === 0) {
        return (
            <div className="p-4 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">No explanations yet</p>
                <p className="text-xs mt-1">Highlight text and ask AI to get started</p>
            </div>
        );
    }

    return (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {groupedExplanations.map(({ highlight, explanations: groupExps }) => (
                <div
                    key={highlight.id}
                    className={`p-4 ${activeHighlightId === highlight.id ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
                        }`}
                >
                    <div
                        className="cursor-pointer mb-3"
                        onClick={() => onHighlightClick(highlight.id)}
                    >
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 line-clamp-2">
                            "{truncateText(highlight.selected_text, 100)}"
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            {formatDate(highlight.created_at)}
                        </p>
                    </div>

                    <div className="space-y-2">
                        {groupExps
                            .filter(exp => !exp.parent_id)
                            .map(exp => renderExplanation(exp))}
                    </div>

                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSummarize(groupExps[0].id)}
                            disabled={isLoading}
                        >
                            Summarize
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onSendToCanvas(highlight.id, groupExps)}
                        >
                            <Layout className="w-4 h-4 mr-1" />
                            To Canvas
                        </Button>
                    </div>
                </div>
            ))}
        </div>
    );
}