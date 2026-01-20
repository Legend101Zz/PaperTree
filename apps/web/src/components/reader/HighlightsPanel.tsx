// apps/web/src/components/reader/HighlightsPanel.tsx
'use client';

import { useState, useMemo } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, Explanation } from '@/types';
import {
    ChevronUp, ChevronDown, MessageCircle, Pin, Check,
    Trash2, ExternalLink, Sparkles, X, FileText
} from 'lucide-react';

interface HighlightsPanelProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    onDeleteHighlight?: (highlightId: string) => void;
    onGoToPdf: (page: number) => void;
    onExportToCanvas?: (highlightIds: string[]) => void;
}

export function HighlightsPanel({
    highlights,
    explanations,
    onHighlightClick,
    onDeleteHighlight,
    onGoToPdf,
    onExportToCanvas,
}: HighlightsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const settings = useReaderStore((state) => state.settings);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);

    // Group highlights with their explanations
    const highlightsWithExplanations = useMemo(() => {
        return highlights.map((h) => ({
            ...h,
            explanations: explanations.filter((e) => e.highlight_id === h.id),
        }));
    }, [highlights, explanations]);

    // Stats
    const stats = useMemo(() => ({
        total: highlights.length,
        withExplanations: highlightsWithExplanations.filter((h) => h.explanations.length > 0).length,
        pinned: explanations.filter((e) => e.is_pinned).length,
        resolved: explanations.filter((e) => e.is_resolved).length,
    }), [highlights, highlightsWithExplanations, explanations]);

    // Theme
    const isDark = settings.theme === 'dark';
    const isSepia = settings.theme === 'sepia';
    const colors = {
        bg: isDark ? 'bg-gray-900' : isSepia ? 'bg-[#faf6ed]' : 'bg-white',
        border: isDark ? 'border-gray-700' : isSepia ? 'border-[#d4c4a8]' : 'border-gray-200',
        text: isDark ? 'text-gray-100' : isSepia ? 'text-[#5c4b37]' : 'text-gray-800',
        muted: isDark ? 'text-gray-400' : isSepia ? 'text-[#8b7355]' : 'text-gray-500',
        card: isDark ? 'bg-gray-800' : isSepia ? 'bg-[#f0e6d3]' : 'bg-gray-50',
        hover: isDark ? 'hover:bg-gray-700' : isSepia ? 'hover:bg-[#e8dcc8]' : 'hover:bg-gray-100',
    };

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        if (selectedIds.size === highlights.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(highlights.map((h) => h.id)));
        }
    };

    if (highlights.length === 0) return null;

    return (
        <div className={`fixed bottom-4 left-4 z-40 ${colors.bg} rounded-xl shadow-xl border ${colors.border} overflow-hidden transition-all duration-300`}
            style={{ width: isExpanded ? 380 : 200, maxHeight: isExpanded ? '60vh' : 'auto' }}>

            {/* Header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`w-full flex items-center justify-between px-4 py-3 ${colors.hover} transition-colors`}
            >
                <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-yellow-500" />
                    <span className={`font-medium ${colors.text}`}>
                        {stats.total} Highlight{stats.total !== 1 ? 's' : ''}
                    </span>
                    {stats.withExplanations > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${colors.card} ${colors.muted}`}>
                            {stats.withExplanations} with AI
                        </span>
                    )}
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>

            {/* Expanded content */}
            {isExpanded && (
                <>
                    {/* Actions bar */}
                    <div className={`flex items-center justify-between px-4 py-2 border-t ${colors.border} ${colors.card}`}>
                        <button
                            onClick={selectAll}
                            className={`text-xs ${colors.muted} hover:text-blue-500`}
                        >
                            {selectedIds.size === highlights.length ? 'Deselect all' : 'Select all'}
                        </button>
                        {selectedIds.size > 0 && onExportToCanvas && (
                            <button
                                onClick={() => onExportToCanvas(Array.from(selectedIds))}
                                className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                                <ExternalLink className="w-3 h-3" />
                                Export to Canvas ({selectedIds.size})
                            </button>
                        )}
                    </div>

                    {/* Highlights list */}
                    <div className="max-h-[45vh] overflow-y-auto">
                        {highlightsWithExplanations.map((highlight) => {
                            const isActive = activeHighlightId === highlight.id;
                            const isSelected = selectedIds.has(highlight.id);
                            const expCount = highlight.explanations.length;

                            return (
                                <div
                                    key={highlight.id}
                                    className={`px-4 py-3 border-t ${colors.border} transition-colors
                                        ${isActive ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}
                                        ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {/* Checkbox */}
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(highlight.id)}
                                            className="mt-1 rounded border-gray-300"
                                        />

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            {/* Highlighted text */}
                                            <p
                                                onClick={() => {
                                                    // Position near the panel
                                                    onHighlightClick(highlight.id, { x: 400, y: 300 });
                                                }}
                                                className={`text-sm ${colors.text} cursor-pointer hover:text-blue-500 line-clamp-2`}
                                            >
                                                "{highlight.selected_text}"
                                            </p>

                                            {/* Meta info */}
                                            <div className="flex items-center gap-2 mt-1.5">
                                                {highlight.page_number && (
                                                    <button
                                                        onClick={() => onGoToPdf(highlight.page_number! - 1)}
                                                        className={`text-xs flex items-center gap-1 ${colors.muted} hover:text-blue-500`}
                                                    >
                                                        <FileText className="w-3 h-3" />
                                                        p.{highlight.page_number}
                                                    </button>
                                                )}

                                                {expCount > 0 && (
                                                    <span className={`text-xs flex items-center gap-1 ${colors.muted}`}>
                                                        <Sparkles className="w-3 h-3 text-blue-500" />
                                                        {expCount} explanation{expCount > 1 ? 's' : ''}
                                                    </span>
                                                )}

                                                {highlight.explanations.some((e) => e.is_pinned) && (
                                                    <Pin className="w-3 h-3 text-yellow-500" />
                                                )}

                                                {highlight.explanations.some((e) => e.is_resolved) && (
                                                    <Check className="w-3 h-3 text-green-500" />
                                                )}
                                            </div>

                                            {/* First explanation preview */}
                                            {highlight.explanations.length > 0 && (
                                                <div className={`mt-2 p-2 rounded ${colors.card} text-xs ${colors.muted}`}>
                                                    <span className="font-medium">Q:</span> {highlight.explanations[0].question}
                                                </div>
                                            )}
                                        </div>

                                        {/* Delete button */}
                                        {onDeleteHighlight && (
                                            <button
                                                onClick={() => onDeleteHighlight(highlight.id)}
                                                className={`p-1 rounded ${colors.muted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20`}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Footer stats */}
                    <div className={`px-4 py-2 border-t ${colors.border} ${colors.card} flex items-center justify-between text-xs ${colors.muted}`}>
                        <span>{stats.pinned} pinned</span>
                        <span>{stats.resolved} resolved</span>
                    </div>
                </>
            )}
        </div>
    );
}