// apps/web/src/components/canvas/CanvasAIPanel.tsx
'use client';

import { useState } from 'react';
import { AskMode, ASK_MODE_LABELS } from '@/types';
import {
    Sparkles, Calculator, ListOrdered, Brain, Code, GitBranch,
    MessageSquare, Send, Loader2, X
} from 'lucide-react';

interface CanvasAIPanelProps {
    nodeId: string;
    nodeLabel: string;
    onQuery: (question: string, askMode: AskMode) => Promise<void>;
    onClose: () => void;
    isQuerying: boolean;
}

const quickModes: Array<{ mode: AskMode; icon: React.ElementType; label: string }> = [
    { mode: 'explain_simply', icon: Sparkles, label: 'Explain' },
    { mode: 'explain_math', icon: Calculator, label: 'Math' },
    { mode: 'derive_steps', icon: ListOrdered, label: 'Derive' },
    { mode: 'intuition', icon: Brain, label: 'Intuition' },
    { mode: 'pseudocode', icon: Code, label: 'Code' },
    { mode: 'diagram', icon: GitBranch, label: 'Diagram' },
];

export function CanvasAIPanel({
    nodeId,
    nodeLabel,
    onQuery,
    onClose,
    isQuerying,
}: CanvasAIPanelProps) {
    const [question, setQuestion] = useState('');
    const [selectedMode, setSelectedMode] = useState<AskMode>('explain_simply');

    const handleSubmit = async () => {
        if (!question.trim() || isQuerying) return;
        await onQuery(question.trim(), selectedMode);
        setQuestion('');
    };

    const handleQuickAsk = async (mode: AskMode) => {
        if (isQuerying) return;
        setSelectedMode(mode);
        await onQuery(ASK_MODE_LABELS[mode], mode);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-80 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        Ask AI
                    </span>
                </div>
                <button onClick={onClose} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
            </div>

            {/* Context */}
            <div className="px-3 py-1.5 border-b border-gray-50 dark:border-gray-700/50">
                <p className="text-[10px] text-gray-400 truncate">
                    Context: {nodeLabel}
                </p>
            </div>

            {/* Quick mode buttons */}
            <div className="px-3 py-2 grid grid-cols-3 gap-1">
                {quickModes.map(({ mode, icon: Icon, label }) => (
                    <button
                        key={mode}
                        onClick={() => handleQuickAsk(mode)}
                        disabled={isQuerying}
                        className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] transition-all
                            ${isQuerying ? 'opacity-40' : 'hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'}
                            border-gray-100 dark:border-gray-700`}
                    >
                        <Icon className="w-3 h-3" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Custom question */}
            <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                <div className="flex gap-1.5">
                    <input
                        type="text"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
                        placeholder="Ask anything about this node..."
                        className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent outline-none focus:border-blue-400"
                        disabled={isQuerying}
                    />
                    <button
                        onClick={handleSubmit}
                        disabled={!question.trim() || isQuerying}
                        className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
                    >
                        {isQuerying ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Send className="w-3.5 h-3.5" />
                        )}
                    </button>
                </div>
            </div>

            {isQuerying && (
                <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2 text-xs text-blue-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Generating response...
                    </div>
                </div>
            )}
        </div>
    );
}