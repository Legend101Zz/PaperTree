// apps/web/src/components/canvas/CanvasToolbar.tsx
'use client';

import { useState } from 'react';
import {
    TreePine, HelpCircle, Scale, Lightbulb, Loader2, Plus
} from 'lucide-react';

type CanvasTemplate = 'summary_tree' | 'question_branch' | 'critique_map' | 'concept_map';

interface CanvasToolbarProps {
    onCreateTemplate: (template: CanvasTemplate) => Promise<void>;
    onAddNote: () => void;
    isCreating: boolean;
}

const templates: Array<{
    id: CanvasTemplate;
    icon: React.ElementType;
    label: string;
    description: string;
}> = [
        {
            id: 'summary_tree',
            icon: TreePine,
            label: 'Summary Tree',
            description: 'Break paper into key sections',
        },
        {
            id: 'question_branch',
            icon: HelpCircle,
            label: 'Question Branch',
            description: 'Critical questions about the paper',
        },
        {
            id: 'critique_map',
            icon: Scale,
            label: 'Critique Map',
            description: 'Strengths, weaknesses, and questions',
        },
        {
            id: 'concept_map',
            icon: Lightbulb,
            label: 'Concept Map',
            description: 'Extract and connect key concepts',
        },
    ];

export function CanvasToolbar({ onCreateTemplate, onAddNote, isCreating }: CanvasToolbarProps) {
    const [showTemplates, setShowTemplates] = useState(false);

    return (
        <div className="flex items-center gap-2">
            {/* Add Note */}
            <button
                onClick={onAddNote}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
            >
                <Plus className="w-3.5 h-3.5" />
                Note
            </button>

            {/* Templates dropdown */}
            <div className="relative">
                <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    disabled={isCreating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {isCreating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <TreePine className="w-3.5 h-3.5" />
                    )}
                    Templates
                </button>

                {showTemplates && !isCreating && (
                    <div className="absolute top-full mt-1 right-0 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-64 overflow-hidden z-50">
                        {templates.map(({ id, icon: Icon, label, description }) => (
                            <button
                                key={id}
                                onClick={async () => {
                                    setShowTemplates(false);
                                    await onCreateTemplate(id);
                                }}
                                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left border-b border-gray-50 dark:border-gray-700/50 last:border-0"
                            >
                                <Icon className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                                        {label}
                                    </p>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                                        {description}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}