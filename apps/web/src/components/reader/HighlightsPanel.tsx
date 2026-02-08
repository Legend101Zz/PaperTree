// apps/web/src/components/reader/HighlightsPanel.tsx
'use client';

import { useState, useMemo } from 'react';
import { useReaderStore } from '@/store/readerStore';
import {
    Highlight,
    Explanation,
    HighlightCategory,
    HIGHLIGHT_CATEGORY_LABELS,
    HIGHLIGHT_CATEGORY_COLORS,
    AskMode,
} from '@/types';
import {
    ChevronUp, ChevronDown, MessageCircle, Pin, Check,
    Trash2, ExternalLink, Sparkles, FileText, Search, Filter, X, GitBranch
} from 'lucide-react';

interface HighlightsPanelProps {
    highlights: Highlight[];
    explanations: Explanation[];
    onHighlightClick: (highlightId: string, position: { x: number; y: number }) => void;
    onDeleteHighlight?: (highlightId: string) => void;
    onGoToPdf: (page: number) => void;
    onExportToCanvas?: (highlightIds: string[]) => void;
    onUpdateHighlight?: (highlightId: string, data: { category?: HighlightCategory }) => void;
    onExploreInCanvas?: (
        highlightId: string,
        selectedText: string,
        pageNumber: number,
        question?: string,
        askMode?: AskMode,
    ) => void;
    isExporting?: boolean;
}

function getThemeColors(theme: string) {
    const themes = {
        light: {
            bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-800',
            muted: 'text-gray-500', card: 'bg-gray-50', hover: 'hover:bg-gray-100',
            accent: 'text-amber-600', accentBg: 'bg-amber-50', accentIcon: 'text-amber-500',
            activeHighlight: 'bg-amber-50', selectedHighlight: 'bg-blue-50',
            shadow: 'shadow-xl shadow-gray-200/50', input: 'bg-gray-100 border-gray-200',
        },
        dark: {
            bg: 'bg-gray-900', border: 'border-gray-700', text: 'text-gray-100',
            muted: 'text-gray-400', card: 'bg-gray-800', hover: 'hover:bg-gray-700',
            accent: 'text-cyan-400', accentBg: 'bg-cyan-500/10', accentIcon: 'text-cyan-400',
            activeHighlight: 'bg-cyan-500/15', selectedHighlight: 'bg-blue-500/20',
            shadow: 'shadow-2xl shadow-black/30', input: 'bg-gray-800 border-gray-600',
        },
        sepia: {
            bg: 'bg-[#faf6ed]', border: 'border-[#d4c4a8]', text: 'text-[#5c4b37]',
            muted: 'text-[#8b7355]', card: 'bg-[#f0e6d3]', hover: 'hover:bg-[#e8dcc8]',
            accent: 'text-orange-700', accentBg: 'bg-orange-100/50', accentIcon: 'text-orange-600',
            activeHighlight: 'bg-orange-100/50', selectedHighlight: 'bg-blue-100/50',
            shadow: 'shadow-xl shadow-[#c9b896]/30', input: 'bg-[#f0e6d3] border-[#c9b896]',
        },
    };
    return themes[theme as keyof typeof themes] || themes.light;
}

const ALL_CATEGORIES: HighlightCategory[] = [
    'none', 'key_finding', 'question', 'methodology', 'definition', 'important', 'todo',
];

export function HighlightsPanel({
    highlights,
    explanations,
    onHighlightClick,
    onDeleteHighlight,
    onGoToPdf,
    onExportToCanvas,
    onUpdateHighlight,
    onExploreInCanvas,
    isExporting = false,
}: HighlightsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState<HighlightCategory | 'all'>('all');

    const settings = useReaderStore((state) => state.settings);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const colors = getThemeColors(settings.theme);

    const filteredHighlights = useMemo(() => {
        let result = highlights;
        if (filterCategory !== 'all') {
            result = result.filter((h) => h.category === filterCategory);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (h) =>
                    h.selected_text.toLowerCase().includes(q) ||
                    (h.note && h.note.toLowerCase().includes(q))
            );
        }
        return result;
    }, [highlights, filterCategory, searchQuery]);

    const highlightsWithExplanations = useMemo(() => {
        return filteredHighlights.map((h) => ({
            ...h,
            explanations: explanations.filter((e) => e.highlight_id === h.id),
        }));
    }, [filteredHighlights, explanations]);

    const stats = useMemo(() => ({
        total: highlights.length,
        filtered: filteredHighlights.length,
        withExplanations: highlights.filter(
            (h) => explanations.some((e) => e.highlight_id === h.id)
        ).length,
    }), [highlights, filteredHighlights, explanations]);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        if (selectedIds.size === filteredHighlights.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredHighlights.map((h) => h.id)));
        }
    };

    if (highlights.length === 0) return null;

    return (
        <div
            className={`fixed bottom-4 left-4 z-40 ${colors.bg} rounded-xl ${colors.shadow} border ${colors.border} overflow-hidden transition-all duration-300`}
            style={{ width: isExpanded ? 400 : 200, maxHeight: isExpanded ? '65vh' : 'auto' }}
        >
            {/* Header */}
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

            {isExpanded && (
                <>
                    {/* Search + Filter */}
                    <div className={`px-3 py-2 border-t ${colors.border} ${colors.card} space-y-2`}>
                        <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${colors.input} border`}>
                            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <input
                                type="text"
                                placeholder="Search highlights..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent text-xs outline-none"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')}>
                                    <X className="w-3 h-3 text-gray-400" />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                            <button
                                onClick={() => setFilterCategory('all')}
                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${filterCategory === 'all'
                                    ? 'bg-gray-800 text-white border-gray-800 dark:bg-white dark:text-gray-900 dark:border-white'
                                    : `${colors.border} ${colors.muted}`
                                    }`}
                            >
                                All
                            </button>
                            {ALL_CATEGORIES.filter((c) => c !== 'none').map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
                                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${filterCategory === cat
                                        ? 'border-current font-medium'
                                        : `${colors.border} ${colors.muted}`
                                        }`}
                                    style={filterCategory === cat ? { color: HIGHLIGHT_CATEGORY_COLORS[cat] } : {}}
                                >
                                    <span
                                        className="w-2 h-2 rounded-full inline-block"
                                        style={{ backgroundColor: HIGHLIGHT_CATEGORY_COLORS[cat] }}
                                    />
                                    {HIGHLIGHT_CATEGORY_LABELS[cat]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions bar */}
                    <div className={`flex items-center justify-between px-4 py-2 border-t ${colors.border} ${colors.card}`}>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={selectAll}
                                className={`text-xs ${colors.muted} hover:underline transition-colors`}
                            >
                                {selectedIds.size === filteredHighlights.length ? 'Deselect all' : 'Select all'}
                            </button>
                            {stats.filtered !== stats.total && (
                                <span className={`text-xs ${colors.muted}`}>({stats.filtered} shown)</span>
                            )}
                        </div>
                        {selectedIds.size > 0 && onExportToCanvas && (
                            <button
                                onClick={() => onExportToCanvas(Array.from(selectedIds))}
                                disabled={isExporting}
                                className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
                            >
                                {isExporting ? (
                                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <ExternalLink className="w-3 h-3" />
                                )}
                                Export ({selectedIds.size})
                            </button>
                        )}
                    </div>

                    {/* Highlights list */}
                    <div className="max-h-[40vh] overflow-y-auto">
                        {highlightsWithExplanations.length === 0 ? (
                            <div className={`px-4 py-6 text-center ${colors.muted} text-sm`}>
                                {searchQuery || filterCategory !== 'all'
                                    ? 'No highlights match your filters.'
                                    : 'No highlights yet.'}
                            </div>
                        ) : (
                            highlightsWithExplanations.map((highlight) => {
                                const isActive = activeHighlightId === highlight.id;
                                const isSelected = selectedIds.has(highlight.id);
                                const expCount = highlight.explanations.length;

                                return (
                                    <div
                                        key={highlight.id}
                                        className={`group px-4 py-3 border-t ${colors.border} transition-colors cursor-pointer
                                            ${isActive ? colors.activeHighlight : ''}
                                            ${isSelected ? colors.selectedHighlight : ''}
                                            ${!isActive && !isSelected ? colors.hover : ''}
                                        `}
                                    >
                                        <div className="flex items-start gap-2">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelect(highlight.id)}
                                                className="mt-1 shrink-0"
                                            />
                                            <span
                                                className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                                                style={{ backgroundColor: highlight.color || '#eab308' }}
                                                title={HIGHLIGHT_CATEGORY_LABELS[highlight.category] || 'Uncategorized'}
                                            />

                                            {/* Content — click to open inline explanation */}
                                            <div
                                                className="flex-1 min-w-0"
                                                onClick={() => onHighlightClick(highlight.id, { x: 200, y: 200 })}
                                            >
                                                <p className={`text-xs ${colors.text} line-clamp-2`}>
                                                    {highlight.selected_text}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    {highlight.category !== 'none' && (
                                                        <span
                                                            className="text-[10px] px-1.5 py-0.5 rounded-full"
                                                            style={{
                                                                backgroundColor: `${highlight.color}20`,
                                                                color: highlight.color,
                                                            }}
                                                        >
                                                            {HIGHLIGHT_CATEGORY_LABELS[highlight.category]}
                                                        </span>
                                                    )}
                                                    {expCount > 0 && (
                                                        <span className={`text-[10px] ${colors.accent} flex items-center gap-0.5`}>
                                                            <Sparkles className="w-3 h-3" />
                                                            {expCount}
                                                        </span>
                                                    )}
                                                    {highlight.page_number && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onGoToPdf(highlight.page_number!);
                                                            }}
                                                            className={`text-[10px] ${colors.muted} hover:underline`}
                                                        >
                                                            p.{highlight.page_number}
                                                        </button>
                                                    )}
                                                </div>
                                                {highlight.note && (
                                                    <p className={`text-[10px] ${colors.muted} mt-1 italic line-clamp-1`}>
                                                        {highlight.note}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Action buttons — visible on hover */}
                                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {/* Explore in Canvas */}
                                                {onExploreInCanvas && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onExploreInCanvas(
                                                                highlight.id,
                                                                highlight.selected_text,
                                                                highlight.page_number || 0,
                                                            );
                                                        }}
                                                        className="p-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                                                        title="Explore in Canvas"
                                                    >
                                                        <GitBranch className="w-3.5 h-3.5 text-indigo-500" />
                                                    </button>
                                                )}
                                                {/* Delete */}
                                                {onDeleteHighlight && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteHighlight(highlight.id);
                                                        }}
                                                        className={`p-1 rounded ${colors.hover} ${colors.muted}`}
                                                        title="Delete highlight"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </div>
    );
}