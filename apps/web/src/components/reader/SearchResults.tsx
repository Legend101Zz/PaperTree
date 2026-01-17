'use client';

import { useReaderStore } from '@/store/readerStore';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

interface SearchResultsProps {
    onClose: () => void;
}

export function SearchResults({ onClose }: SearchResultsProps) {
    const search = useReaderStore((state) => state.search);
    const nextResult = useReaderStore((state) => state.nextSearchResult);
    const prevResult = useReaderStore((state) => state.prevSearchResult);
    const clearSearch = useReaderStore((state) => state.clearSearch);

    if (!search.query || search.results.length === 0) return null;

    const handleClose = () => {
        clearSearch();
        onClose();
    };

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400">
                {search.currentIndex + 1} of {search.results.length} results
            </span>

            <div className="flex items-center gap-1">
                <button
                    onClick={prevResult}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Previous (Shift+Enter)"
                >
                    <ChevronUp className="w-4 h-4" />
                </button>
                <button
                    onClick={nextResult}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Next (Enter)"
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            </div>

            <button
                onClick={handleClose}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="Close (Esc)"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}