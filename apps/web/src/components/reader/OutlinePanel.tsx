'use client';

import { OutlineItem } from '@/types';
import { useReaderStore } from '@/store/readerStore';
import { ChevronRight, FileText } from 'lucide-react';

interface OutlinePanelProps {
    outline: OutlineItem[];
    onBlockClick: (blockId: string) => void;
}

export function OutlinePanel({ outline, onBlockClick }: OutlinePanelProps) {
    const currentBlockId = useReaderStore((state) => state.currentBlockId);

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
                </div>
            </div>
        );
    }

    // Find current section
    const currentSectionIndex = outline.findIndex(item => item.block_id === currentBlockId);

    return (
        <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Outline ({outline.length} sections)
            </h3>
            <nav className="space-y-0.5 max-h-[calc(100vh-200px)] overflow-y-auto">
                {outline.map((item, index) => {
                    const isActive = item.block_id === currentBlockId ||
                        (currentSectionIndex === -1 && index === 0) ||
                        (index < currentSectionIndex && (index + 1 >= outline.length || outline[index + 1].block_id !== currentBlockId));

                    return (
                        <button
                            key={`${item.block_id}-${index}`}
                            onClick={() => onBlockClick(item.block_id)}
                            className={`
                                w-full text-left px-2 py-2 text-sm rounded-lg 
                                transition-colors flex items-start gap-2 group
                                ${isActive
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                                }
                            `}
                            style={{ paddingLeft: `${item.level * 12 + 8}px` }}
                            title={`${item.title} (Page ${item.page + 1})`}
                        >
                            <ChevronRight className={`w-3 h-3 mt-1 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400 group-hover:text-blue-500'
                                }`} />
                            <span className="line-clamp-2">
                                {item.title}
                            </span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}