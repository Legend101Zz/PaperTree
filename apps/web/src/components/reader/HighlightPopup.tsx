// apps/web/src/components/reader/HighlightPopup.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    Loader2, Sparkles, Code, Calculator, MessageSquare,
    Brain, ListOrdered, GitBranch, Tag
} from 'lucide-react';
import {
    AskMode, ASK_MODE_LABELS,
    HighlightCategory, HIGHLIGHT_CATEGORY_LABELS, HIGHLIGHT_CATEGORY_COLORS,
} from '@/types';

interface HighlightPopupProps {
    position: { x: number; y: number };
    onAskAI: (question: string, askMode: AskMode, category?: HighlightCategory) => void;
    onClose: () => void;
    isLoading: boolean;
}

const askModeOptions: Array<{
    mode: AskMode;
    icon: React.ElementType;
    label: string;
    description: string;
}> = [
        { mode: 'explain_simply', icon: Sparkles, label: 'Explain Simply', description: 'Clear, beginner-friendly' },
        { mode: 'explain_math', icon: Calculator, label: 'Math', description: 'Equations & notation' },
        { mode: 'derive_steps', icon: ListOrdered, label: 'Derive', description: 'Step-by-step' },
        { mode: 'intuition', icon: Brain, label: 'Intuition', description: 'Mental models' },
        { mode: 'pseudocode', icon: Code, label: 'Code', description: 'Algorithm' },
        { mode: 'diagram', icon: GitBranch, label: 'Diagram', description: 'Flowchart' },
    ];

const categoryOptions: Array<{
    category: HighlightCategory;
    color: string;
    label: string;
}> = [
        { category: 'key_finding', color: HIGHLIGHT_CATEGORY_COLORS.key_finding, label: 'Key Finding' },
        { category: 'question', color: HIGHLIGHT_CATEGORY_COLORS.question, label: 'Question' },
        { category: 'methodology', color: HIGHLIGHT_CATEGORY_COLORS.methodology, label: 'Method' },
        { category: 'definition', color: HIGHLIGHT_CATEGORY_COLORS.definition, label: 'Definition' },
        { category: 'important', color: HIGHLIGHT_CATEGORY_COLORS.important, label: 'Important' },
        { category: 'todo', color: HIGHLIGHT_CATEGORY_COLORS.todo, label: 'To Do' },
    ];

export function HighlightPopup({ position, onAskAI, onClose, isLoading }: HighlightPopupProps) {
    const [customQuestion, setCustomQuestion] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<HighlightCategory>('none');
    const [showCategories, setShowCategories] = useState(false);
    const [selectedMode, setSelectedMode] = useState<AskMode | null>(null);

    const handleAsk = (mode: AskMode, question?: string) => {
        if (isLoading || selectedMode) return;
        setSelectedMode(mode);
        const q = question || ASK_MODE_LABELS[mode];
        onAskAI(q, mode, selectedCategory !== 'none' ? selectedCategory : undefined);
    };

    // Position calculation to keep popup in viewport
    const top = Math.min(position.y, window.innerHeight - 380);
    const left = Math.min(position.x + 10, window.innerWidth - 320);

    return (
        <div
            className="fixed z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            style={{ top, left }}
        >
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-72 overflow-hidden">
                {/* Category selector (collapsible) */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <button
                        onClick={() => setShowCategories(!showCategories)}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 w-full"
                    >
                        <Tag className="w-3 h-3" />
                        <span>
                            {selectedCategory !== 'none'
                                ? HIGHLIGHT_CATEGORY_LABELS[selectedCategory]
                                : 'Add category (optional)'}
                        </span>
                        {selectedCategory !== 'none' && (
                            <span
                                className="w-2.5 h-2.5 rounded-full ml-auto"
                                style={{ backgroundColor: HIGHLIGHT_CATEGORY_COLORS[selectedCategory] }}
                            />
                        )}
                    </button>
                    {showCategories && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {categoryOptions.map(({ category, color, label }) => (
                                <button
                                    key={category}
                                    onClick={() => {
                                        setSelectedCategory(
                                            selectedCategory === category ? 'none' : category
                                        );
                                    }}
                                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${selectedCategory === category
                                            ? 'font-semibold scale-105'
                                            : 'opacity-70 hover:opacity-100'
                                        }`}
                                    style={{
                                        borderColor: color,
                                        backgroundColor:
                                            selectedCategory === category ? `${color}25` : 'transparent',
                                        color: color,
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Ask AI header */}
                <div className="px-3 py-2">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Ask AI about this selection
                    </p>

                    {/* Mode buttons */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {askModeOptions.map(({ mode, icon: Icon, label, description }) => {
                            const isSelected = selectedMode === mode;
                            const isOtherSelected = selectedMode && selectedMode !== mode;

                            return (
                                <button
                                    key={mode}
                                    onClick={() => handleAsk(mode)}
                                    disabled={isLoading || !!selectedMode}
                                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-center transition-all ${isSelected
                                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                                            : isOtherSelected
                                                ? 'opacity-40'
                                                : 'border-gray-100 dark:border-gray-700 hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                                        }`}
                                >
                                    {isSelected && isLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                    ) : (
                                        <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                                    )}
                                    <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
                                        {label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Custom question */}
                <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    {showCustomInput ? (
                        <div className="flex gap-1.5">
                            <input
                                type="text"
                                value={customQuestion}
                                onChange={(e) => setCustomQuestion(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && customQuestion.trim()) {
                                        handleAsk('custom', customQuestion.trim());
                                    }
                                }}
                                placeholder="Ask anything..."
                                className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent outline-none focus:border-blue-400"
                                autoFocus
                                disabled={isLoading || !!selectedMode}
                            />
                            <Button
                                size="sm"
                                onClick={() => handleAsk('custom', customQuestion.trim())}
                                disabled={!customQuestion.trim() || isLoading || !!selectedMode}
                            >
                                {isLoading && selectedMode === 'custom' ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    'Ask'
                                )}
                            </Button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowCustomInput(true)}
                            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-500 transition-colors w-full"
                            disabled={isLoading || !!selectedMode}
                        >
                            <MessageSquare className="w-3 h-3" />
                            Custom question...
                        </button>
                    )}
                </div>

                {/* Close */}
                <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
                    <button
                        onClick={onClose}
                        className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}