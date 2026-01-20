
'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Explanation, Highlight } from '@/types';
import { Button } from '@/components/ui/Button';
import { X, MessageSquare, Pin, Check, Loader2 } from 'lucide-react';
import { formatDate, truncateText } from '@/lib/utils';

interface ExplanationModalProps {
    highlight: Highlight | null;
    explanations: Explanation[];
    onClose: () => void;
    onFollowUp: (explanationId: string, question: string) => void;
    onTogglePin: (explanationId: string, isPinned: boolean) => void;
    onToggleResolved: (explanationId: string, isResolved: boolean) => void;
    isLoading: boolean;
}

export function ExplanationModal({
    highlight,
    explanations,
    onClose,
    onFollowUp,
    onTogglePin,
    onToggleResolved,
    isLoading
}: ExplanationModalProps) {
    const [followUpInput, setFollowUpInput] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    if (!highlight) return null;

    const rootExplanations = explanations.filter(exp => !exp.parent_id);

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

        return (
            <div key={exp.id} className={`${depth > 0 ? 'ml-4 mt-3 border-l-2 border-blue-300 pl-3' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-medium">Q: {exp.question}</p>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onTogglePin(exp.id, !exp.is_pinned)}
                            className={`p-1 rounded ${exp.is_pinned ? 'text-yellow-500' : 'text-gray-400'}`}
                        >
                            <Pin className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onToggleResolved(exp.id, !exp.is_resolved)}
                            className={`p-1 rounded ${exp.is_resolved ? 'text-green-500' : 'text-gray-400'}`}
                        >
                            <Check className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="prose prose-sm max-w-none mb-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {isExpanded ? exp.answer_markdown : truncateText(exp.answer_markdown, 200)}
                    </ReactMarkdown>
                </div>

                {exp.answer_markdown.length > 200 && (
                    <button
                        onClick={() => toggleExpand(exp.id)}
                        className="text-sm text-blue-500 hover:underline mb-2"
                    >
                        {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                )}

                {/* Follow-up for this explanation */}
                <div className="flex items-center gap-2 mt-2">
                    <input
                        type="text"
                        placeholder="Ask follow-up..."
                        className="flex-1 px-3 py-1.5 text-sm border rounded-lg"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                onFollowUp(exp.id, e.currentTarget.value);
                                e.currentTarget.value = '';
                            }
                        }}
                    />
                </div>

                {/* Render children */}
                {children.length > 0 && (
                    <div className="mt-2">
                        {children.map(child => renderExplanation(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] 
                          flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-start justify-between p-4 border-b">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-2 mb-1">
                            "{truncateText(highlight.selected_text, 150)}"
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(highlight.created_at)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                    {rootExplanations.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No explanations yet</p>
                            <p className="text-xs mt-1">Ask a question to get started</p>
                        </div>
                    ) : (
                        rootExplanations.map(exp => renderExplanation(exp))
                    )}
                </div>

                {/* Footer - New question */}
                <div className="border-t p-4">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={followUpInput}
                            onChange={(e) => setFollowUpInput(e.target.value)}
                            placeholder="Ask a new question about this highlight..."
                            className="flex-1 px-4 py-2 border rounded-lg"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && followUpInput.trim()) {
                                    const firstExp = rootExplanations[0];
                                    if (firstExp) {
                                        onFollowUp(firstExp.id, followUpInput);
                                    }
                                    setFollowUpInput('');
                                }
                            }}
                        />
                        <Button
                            onClick={() => {
                                if (followUpInput.trim()) {
                                    const firstExp = rootExplanations[0];
                                    if (firstExp) {
                                        onFollowUp(firstExp.id, followUpInput);
                                    }
                                    setFollowUpInput('');
                                }
                            }}
                            disabled={!followUpInput.trim() || isLoading}
                            isLoading={isLoading}
                        >
                            <MessageSquare className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}