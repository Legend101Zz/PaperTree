// apps/web/src/components/reader/HighlightsPanel.tsx
'use client';

import { useState, useMemo } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { Highlight, Explanation } from '@/types';
import {
    ChevronUp, ChevronDown, MessageCircle, Pin, Check,
    Trash2, ExternalLink, Sparkles, FileText
} from 'lucide-react';

interface HighlightsPanelProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    onDeleteHighlight?: (highlightId: string) => void;
    onGoToPdf: (page: number) => void;
    onExportToCanvas?: (highlightIds: string[]) => void;
}

/**
 * Get theme-specific colors for the highlights panel
 */
function getThemeColors(theme: string) {
    const themes = {
        light: {
            bg: 'bg-white',
            border: 'border-gray-200',
            text: 'text-gray-800',
            muted: 'text-gray-500',
            card: 'bg-gray-50',
            hover: 'hover:bg-gray-100',
            accent: 'text-amber-600',
            accentBg: 'bg-amber-50',
            accentIcon: 'text-amber-500',
            activeHighlight: 'bg-amber-50',
            selectedHighlight: 'bg-blue-50',
            shadow: 'shadow-xl shadow-gray-200/50'
        },
        dark: {
            bg: 'bg-gray-900',
            border: 'border-gray-700',
            text: 'text-gray-100',
            muted: 'text-gray-400',
            card: 'bg-gray-800',
            hover: 'hover:bg-gray-700',
            accent: 'text-cyan-400',
            accentBg: 'bg-cyan-500/10',
            accentIcon: 'text-cyan-400',
            activeHighlight: 'bg-cyan-500/15',
            selectedHighlight: 'bg-blue-500/20',
            shadow: 'shadow-2xl shadow-black/30'
        },
        sepia: {
            bg: 'bg-[#faf6ed]',
            border: 'border-[#d4c4a8]',
            text: 'text-[#5c4b37]',
            muted: 'text-[#8b7355]',
            card: 'bg-[#f0e6d3]',
            hover: 'hover:bg-[#e8dcc8]',
            accent: 'text-orange-700',
            accentBg: 'bg-orange-100/50',
            accentIcon: 'text-orange-600',
            activeHighlight: 'bg-orange-100/50',
            selectedHighlight: 'bg-blue-100/50',
            shadow: 'shadow-xl shadow-[#c9b896]/30'
        }
    };

    return themes[theme as keyof typeof themes] || themes.light;
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

    const colors = getThemeColors(settings.theme);

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
        <div
            className={`fixed bottom-4 left-4 z-40 ${colors.bg} rounded-xl ${colors.shadow} border ${colors.border} overflow-hidden transition-all duration-300`}
            style={{ width: isExpanded ? 380 : 200, maxHeight: isExpanded ? '60vh' : 'auto' }}
        >
            {/* Header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`w-full flex items-center justify-between px-4 py-3 ${colors.hover} transition-colors`}
            >
                <div className="flex items-center gap-2">
                    <MessageCircle className={`w-4 h-4 ${colors.accentIcon}`} />
                    <span className={`font-medium ${colors.text}`}>
                        {stats.total} Highlight{stats.total !== 1 ? 's' : ''}
                    </span>
                    {stats.withExplanations > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${colors.accentBg} ${colors.accent}`}>
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
                            className={`text-xs ${colors.muted} hover:${colors.accent} transition-colors`}
                        >
                            {selectedIds.size === highlights.length ? 'Deselect all' : 'Select all'}
                        </button>
                        {selectedIds.size > 0 && onExportToCanvas && (
                            <button
                                onClick={() => onExportToCanvas(Array.from(selectedIds))}
                                className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                            >
                                <ExternalLink className="w-3 h-3" />
                                Export ({selectedIds.size})
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
                                        ${isActive ? colors.activeHighlight : ''}
                                        ${isSelected ? colors.selectedHighlight : ''}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {/* Checkbox */}
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(highlight.id)}
                                            className="mt-1 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                        />

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            {/* Highlighted text */}
                                            <p
                                                onClick={() => {
                                                    onHighlightClick(highlight.id, { x: 400, y: 300 });
                                                }}
                                                className={`text-sm ${colors.text} cursor-pointer hover:${colors.accent} line-clamp-2 transition-colors`}
                                            >
                                                "{highlight.selected_text}"
                                            </p>

                                            {/* Meta info */}
                                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                {highlight.page_number && (
                                                    <button
                                                        onClick={() => onGoToPdf(highlight.page_number! - 1)}
                                                        className={`text-xs flex items-center gap-1 ${colors.muted} hover:${colors.accent} transition-colors`}
                                                    >
                                                        <FileText className="w-3 h-3" />
                                                        p.{highlight.page_number}
                                                    </button>
                                                )}

                                                {expCount > 0 && (
                                                    <span className={`text-xs flex items-center gap-1 ${colors.accent}`}>
                                                        <Sparkles className="w-3 h-3" />
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
                                                className={`p-1 rounded ${colors.muted} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
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