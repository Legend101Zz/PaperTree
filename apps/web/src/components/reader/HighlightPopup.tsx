'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sparkles, BookOpen, Code, Calculator, MessageSquare } from 'lucide-react';

interface HighlightPopupProps {
    position: { x: number; y: number };
    onAskAI: (question: string) => void;
    onClose: () => void;
    isLoading: boolean;
}

const presetQuestions = [
    { icon: Sparkles, label: 'Explain simply', question: 'Explain this in simple terms' },
    { icon: Calculator, label: 'Explain math', question: 'Explain the mathematical intuition behind this' },
    { icon: BookOpen, label: 'Give example', question: 'Give me a practical example of this concept' },
    { icon: Code, label: 'Code intuition', question: 'Explain this with a code analogy or example' },
];

export function HighlightPopup({ position, onAskAI, onClose, isLoading }: HighlightPopupProps) {
    const [customQuestion, setCustomQuestion] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);

    return (
        <div
            className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 w-72"
            style={{
                left: Math.min(position.x, window.innerWidth - 300),
                top: position.y + 10
            }}
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ask AI about this
                </span>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                    ×
                </button>
            </div>

            <div className="space-y-2">
                {presetQuestions.map(({ icon: Icon, label, question }) => (
                    <button
                        key={label}
                        onClick={() => onAskAI(question)}
                        disabled={isLoading}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                        <Icon className="w-4 h-4 text-blue-500" />
                        {label}
                    </button>
                ))}

                {showCustomInput ? (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <textarea
                            value={customQuestion}
                            onChange={(e) => setCustomQuestion(e.target.value)}
                            placeholder="Type your question..."
                            className="w-full px-3 py-2 text-sm border rounded-lg resize-none dark:bg-gray-700 dark:border-gray-600"
                            rows={2}
                            autoFocus
                        />
                        <Button
                            size="sm"
                            onClick={() => {
                                if (customQuestion.trim()) {
                                    onAskAI(customQuestion);
                                }
                            }}
                            disabled={!customQuestion.trim() || isLoading}
                            isLoading={isLoading}
                            className="w-full mt-2"
                        >
                            Ask
                        </Button>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowCustomInput(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-t border-gray-200 dark:border-gray-700 mt-2 pt-2"
                    >
                        <MessageSquare className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-500">Custom question...</span>
                    </button>
                )}
            </div>
        </div>
    );
}