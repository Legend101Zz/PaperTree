// apps/web/src/components/reader/HighlightPopup.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    Loader2, Sparkles, BookOpen, Code, Calculator, MessageSquare,
    Brain, ListOrdered, GitBranch
} from 'lucide-react';
import { AskMode, ASK_MODE_LABELS } from '@/types';

interface HighlightPopupProps {
    position: { x: number; y: number };
    onAskAI: (question: string, askMode: AskMode) => void;
    onClose: () => void;
    isLoading: boolean;
}

const askModeOptions: Array<{
    mode: AskMode;
    icon: React.ElementType;
    label: string;
    description: string;
}> = [
        {
            mode: 'explain_simply',
            icon: Sparkles,
            label: 'Explain Simply',
            description: 'Clear, beginner-friendly explanation'
        },
        {
            mode: 'explain_math',
            icon: Calculator,
            label: 'Explain Mathematically',
            description: 'With equations and formal notation'
        },
        {
            mode: 'derive_steps',
            icon: ListOrdered,
            label: 'Derive Step-by-Step',
            description: 'Show all intermediate steps'
        },
        {
            mode: 'intuition',
            icon: Brain,
            label: 'Build Intuition',
            description: 'Mental models and analogies'
        },
        {
            mode: 'pseudocode',
            icon: Code,
            label: 'Convert to Code',
            description: 'Pseudocode or algorithm'
        },
        {
            mode: 'diagram',
            icon: GitBranch,
            label: 'Make a Diagram',
            description: 'Visual flowchart or diagram'
        },
    ];

export function HighlightPopup({ position, onAskAI, onClose, isLoading }: HighlightPopupProps) {
    const [customQuestion, setCustomQuestion] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);
    const [selectedMode, setSelectedMode] = useState<AskMode | null>(null);

    const handleAsk = (mode: AskMode, question?: string) => {
        const defaultQuestions: Record<AskMode, string> = {
            explain_simply: 'Explain this in simple terms',
            explain_math: 'Explain the mathematical formulation',
            derive_steps: 'Derive this step by step',
            intuition: 'Help me build intuition for this concept',
            pseudocode: 'Convert this into pseudocode',
            diagram: 'Create a diagram explaining this',
            custom: question || customQuestion,
        };

        onAskAI(question || defaultQuestions[mode], mode);
    };

    // Calculate safe position
    const popupWidth = 320;
    const safeX = Math.min(position.x, window.innerWidth - popupWidth - 20);
    const safeY = position.y + 10;
    return (
        <div
            className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            style={{
                left: Math.max(20, safeX),
                top: safeY,
                width: popupWidth,
            }}
        >
            {/* Loading overlay */}
            {isLoading && (
                <div className="absolute inset-0 bg-white/95 dark:bg-gray-800/95 rounded-xl 
                      flex items-center justify-center backdrop-blur-sm z-10">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            AI is thinking...
                        </span>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        Ask AI
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                >
                    ×
                </button>
            </div>

            {/* Ask mode options */}
            <div className="p-2 max-h-80 overflow-y-auto">
                {askModeOptions.map(({ mode, icon: Icon, label, description }) => (
                    <button
                        key={mode}
                        onClick={() => handleAsk(mode)}
                        disabled={isLoading}
                        className="w-full flex items-start gap-3 px-3 py-2.5 text-left rounded-lg 
                        hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50
                        group"
                    >
                        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition-colors">
                            <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                {label}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                                {description}
                            </div>
                        </div>
                    </button>
                ))}

                {/* Custom question */}
                <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
                    {showCustomInput ? (
                        <div className="px-2 pb-2">
                            <textarea
                                value={customQuestion}
                                onChange={(e) => setCustomQuestion(e.target.value)}
                                placeholder="Type your own question..."
                                className="w-full px-3 py-2 text-sm border rounded-lg resize-none 
                                dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500"
                                rows={2}
                                autoFocus
                            />
                            <div className="flex gap-2 mt-2">
                                <Button
                                    size="sm"
                                    onClick={() => handleAsk('custom', customQuestion)}
                                    disabled={!customQuestion.trim() || isLoading}
                                    isLoading={isLoading}
                                    className="flex-1"
                                >
                                    Ask
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setShowCustomInput(false);
                                        setCustomQuestion('');
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowCustomInput(true)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg 
                            hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700">
                                <MessageSquare className="w-4 h-4 text-gray-500" />
                            </div>
                            <span className="text-sm text-gray-500">Custom question...</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-400 text-center">
                    ✨ Notes auto-saved to Canvas
                </p>
            </div>
        </div>
    );
}