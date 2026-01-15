'use client';

import { OutlineItem } from '@/types';
import { ChevronRight } from 'lucide-react';

interface OutlinePanelProps {
    outline: OutlineItem[];
    onSectionClick: (section: OutlineItem) => void;
}

export function OutlinePanel({ outline, onSectionClick }: OutlinePanelProps) {
    if (outline.length === 0) {
        return (
            <div className="p-4 text-sm text-gray-500">
                No outline available
            </div>
        );
    }

    return (
        <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Outline
            </h3>
            <nav className="space-y-1">
                {outline.map((item, index) => (
                    <button
                        key={index}
                        onClick={() => onSectionClick(item)}
                        className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
                        style={{ paddingLeft: `${item.level * 12 + 8}px` }}
                    >
                        <ChevronRight className="w-3 h-3 text-gray-400" />
                        <span className="truncate">{item.title}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
}