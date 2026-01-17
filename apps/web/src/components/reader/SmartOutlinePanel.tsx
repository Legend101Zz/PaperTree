// apps/web/src/components/reader/SmartOutlinePanel.tsx
'use client';

import { SmartOutlineItem } from '@/types';
import { useReaderStore } from '@/store/readerStore';
import { ChevronRight, FileText, BookOpen } from 'lucide-react';

interface SmartOutlinePanelProps {
    outline: SmartOutlineItem[];
    onSectionClick: (sectionId: string) => void;
    onPdfPageClick: (page: number) => void;
}

export function SmartOutlinePanel({
    outline,
    onSectionClick,
    onPdfPageClick
}: SmartOutlinePanelProps) {
    const currentSectionId = useReaderStore((state) => state.currentSectionId);
    const settings = useReaderStore((state) => state.settings);

    if (outline.length === 0) {
        return (
            <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Contents
                </h3>
                <div className="text-center py-8">
                    <FileText className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Generate book content to see outline
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Contents
            </h3>

            <nav className="space-y-1">
                {outline.map((item, index) => {
                    const isActive = currentSectionId === item.section_id;

                    return (
                        <div key={item.id} className="group">
                            <button
                                onClick={() => onSectionClick(item.section_id)}
                                className={`w-full text-left px-2 py-2 rounded-lg transition-all duration-200
                           flex items-start gap-2 ${isActive
                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                                    }`}
                                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                            >
                                <ChevronRight className={`w-3 h-3 mt-1.5 flex-shrink-0 transition-transform ${isActive ? 'rotate-90 text-blue-500' : 'text-gray-400'
                                    }`} />

                                <div className="flex-1 min-w-0">
                                    <span className="block text-sm line-clamp-2">{item.title}</span>
                                    {item.description && (
                                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                            {item.description}
                                        </span>
                                    )}
                                </div>

                                {/* Page indicator */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPdfPageClick(item.pdf_page);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-xs 
                             bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 
                             dark:hover:bg-gray-600 transition-all"
                                    title="Go to PDF page"
                                >
                                    p.{item.pdf_page + 1}
                                </button>
                            </button>
                        </div>
                    );
                })}
            </nav>
        </div>
    );
}