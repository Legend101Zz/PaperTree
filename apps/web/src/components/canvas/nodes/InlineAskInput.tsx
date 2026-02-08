// apps/web/src/components/canvas/nodes/InlineAskInput.tsx
'use client';

import { useState } from 'react';
import {
    Sparkles, Calculator, ListOrdered, Brain, Code, GitBranch,
    Send, Loader2, X,
} from 'lucide-react';
import type { AskMode } from '@/types/canvas';

const QUICK_MODES: Array<{ mode: AskMode; icon: React.ElementType; label: string }> = [
    { mode: 'explain_simply', icon: Sparkles, label: 'Explain' },
    { mode: 'explain_math', icon: Calculator, label: 'Math' },
    { mode: 'derive_steps', icon: ListOrdered, label: 'Derive' },
    { mode: 'intuition', icon: Brain, label: 'Intuition' },
    { mode: 'pseudocode', icon: Code, label: 'Code' },
    { mode: 'diagram', icon: GitBranch, label: 'Diagram' },
];

interface InlineAskInputProps {
    parentNodeId: string;
    onAsk: (parentNodeId: string, question: string, mode: AskMode) => Promise<void>;
    onClose: () => void;
    isLoading: boolean;
    position: { x: number; y: number };
}

export function InlineAskInput({ parentNodeId, onAsk, onClose, isLoading, position }: InlineAskInputProps) {
    const [question, setQuestion] = useState('');
    const [mode, setMode] = useState<AskMode>('explain_simply');

    const handleSubmit = async () => {
        if (!question.trim() || isLoading) return;
        await onAsk(parentNodeId, question.trim(), mode);
        setQuestion('');
    };

    const handleQuickMode = async (m: AskMode) => {
        setMode(m);
        const label = QUICK_MODES.find(qm => qm.mode === m)?.label || 'Explain';
        await onAsk(parentNodeId, label + ' this', m);
    };

    return (
        <div
            className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-80 overflow-hidden"
            style={{
                top: Math.min(position.y, window.innerHeight - 300),
                left: Math.min(position.x, window.innerWidth - 340),
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Ask AI</span>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
            </div>

            {/* Quick modes */}
            <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-gray-100 dark:border-gray-700">
                {QUICK_MODES.map(({ mode: m, icon: Icon, label }) => (
                    <button
                        key={m}
                        onClick={() => handleQuickMode(m)}
                        disabled={isLoading}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors
              ${mode === m
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200'
                            } disabled:opacity-50`}
                    >
                        <Icon className="w-3 h-3" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Input */}
            <div className="p-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                        placeholder="Ask a question..."
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isLoading}
                        autoFocus
                    />
                    <button
                        onClick={handleSubmit}
                        disabled={!question.trim() || isLoading}
                        className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
}