'use client';

import { OutlineItem } from '@/types';
import { ChevronRight, FileText } from 'lucide-react';

interface OutlinePanelProps {
    outline: OutlineItem[];
    onSectionClick: (section: OutlineItem) => void;
}

export function OutlinePanel({ outline, onSectionClick }: OutlinePanelProps) {
    if (outline.length === 0) {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Outline
                </h3>
                <div className="text-center py-8">
                    <FileText className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No outline detected
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Section headings will appear here if found
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Outline ({outline.length} sections)
            </h3>
            <nav className="space-y-0.5">
                {outline.map((item, index) => (
                    <button
                        key={`${item.title}-${index}`}
                        onClick={() => onSectionClick(item)}
                        className={`
              w-full text-left px-2 py-2 text-sm rounded-lg 
              hover:bg-gray-100 dark:hover:bg-gray-800 
              transition-colors flex items-start gap-2
              group
            `}
                        style={{ paddingLeft: `${item.level * 12 + 8}px` }}
                        title={item.title}
                    >
                        <ChevronRight className="w-3 h-3 mt-1 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
                        <span className="line-clamp-2 text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {item.title}
                        </span>
                    </button>
                ))}
            </nav>
        </div>
    );
}