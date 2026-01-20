// apps/web/src/components/reader/PDFMinimap.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { useReaderStore } from '@/store/readerStore';
import { papersApi } from '@/lib/api';
import {
    ChevronLeft, ChevronRight, Maximize2,
    GripVertical, FileText, X, Moon, Sun
} from 'lucide-react';

// PDF.js worker
if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface PDFMinimapProps {
    paperId: string;
    pageCount: number;
    onSwitchToPDF: (page: number) => void;
}

const SIZE_CONFIGS = {
    small: { width: 200 },
    medium: { width: 300 },
    large: { width: 420 },
    hidden: { width: 0 },
};

export function PDFMinimap({ paperId, pageCount, onSwitchToPDF }: PDFMinimapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [customWidth, setCustomWidth] = useState<number | null>(null);
    const [displayPage, setDisplayPage] = useState(1);

    const settings = useReaderStore((state) => state.settings);
    const currentPdfPage = useReaderStore((state) => state.currentPdfPage);
    const setMinimapSize = useReaderStore((state) => state.setMinimapSize);
    const setInvertMinimap = useReaderStore((state) => state.setInvertMinimap);
    const setCurrentPdfPage = useReaderStore((state) => state.setCurrentPdfPage);

    const pdfUrl = papersApi.getFileUrl(paperId);

    const baseWidth = customWidth || SIZE_CONFIGS[settings.minimapSize]?.width || 300;
    const isHidden = settings.minimapSize === 'hidden';
    const isDark = settings.invertMinimap;

    // FIXED: Sync displayPage with store's currentPdfPage
    useEffect(() => {
        const newPage = Math.max(1, Math.min(pageCount, currentPdfPage + 1));
        if (newPage !== displayPage) {
            console.log('Minimap: syncing to page', newPage, 'from store page', currentPdfPage);
            setDisplayPage(newPage);
        }
    }, [currentPdfPage, pageCount, displayPage]);

    // Handle page navigation
    const goToPage = useCallback((page: number) => {
        const validPage = Math.max(0, Math.min(pageCount - 1, page));
        console.log('Minimap: goToPage', validPage);
        setDisplayPage(validPage + 1);
        setCurrentPdfPage(validPage);
    }, [pageCount, setCurrentPdfPage]);

    // Handle resize drag
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);

        const startX = e.clientX;
        const startWidth = baseWidth;

        const handleMouseMove = (e: MouseEvent) => {
            const diff = startX - e.clientX;
            const newWidth = Math.max(180, Math.min(600, startWidth + diff));
            setCustomWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [baseWidth]);

    // Show collapsed button when hidden
    if (isHidden) {
        return (
            <button
                onClick={() => setMinimapSize('medium')}
                className="fixed right-4 top-1/2 -translate-y-1/2 z-30 p-3 bg-white dark:bg-gray-800 
                   rounded-lg shadow-lg border border-gray-200 dark:border-gray-700
                   hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                title="Show PDF preview"
            >
                <FileText className="w-5 h-5" />
            </button>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`fixed right-0 top-14 bottom-0 z-30 flex transition-all duration-200
                  ${isResizing ? 'select-none' : ''}`}
            style={{ width: baseWidth }}
        >
            {/* Resize handle */}
            <div
                onMouseDown={handleResizeStart}
                className="w-2 h-full cursor-ew-resize flex items-center justify-center
                   hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group"
            >
                <GripVertical className="w-3 h-3 text-gray-400 group-hover:text-blue-500" />
            </div>

            {/* Main panel */}
            <div className={`flex-1 border-l border-gray-200 dark:border-gray-700 
                      shadow-xl flex flex-col overflow-hidden
                      ${isDark ? 'bg-gray-900' : 'bg-white dark:bg-gray-900'}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-3 py-2 border-b 
                        ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex items-center gap-2">
                        <FileText className={`w-4 h-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                        <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : ''}`}>
                            Page {displayPage} / {pageCount}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setInvertMinimap(!isDark)}
                            className={`p-1.5 rounded transition-colors ${isDark
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title={isDark ? 'Light mode' : 'Dark mode'}
                        >
                            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </button>

                        {(['small', 'medium', 'large'] as const).map((size) => (
                            <button
                                key={size}
                                onClick={() => {
                                    setCustomWidth(null);
                                    setMinimapSize(size);
                                }}
                                className={`w-6 h-6 text-xs rounded transition-colors ${settings.minimapSize === size && !customWidth
                                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                            >
                                {size[0].toUpperCase()}
                            </button>
                        ))}

                        <button
                            onClick={() => onSwitchToPDF(displayPage - 1)}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                            title="Open in PDF mode"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>

                        <button
                            onClick={() => setMinimapSize('hidden')}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                            title="Hide preview"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* PDF Preview */}
                <div className={`flex-1 overflow-auto p-2 ${isDark ? 'bg-gray-950' : 'bg-gray-100 dark:bg-gray-950'}`}>
                    <div className={`relative ${isDark ? 'pdf-inverted' : ''}`}>
                        <Document
                            file={pdfUrl}
                            loading={
                                <div className="flex items-center justify-center h-64">
                                    <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                                </div>
                            }
                            error={
                                <div className="p-4 text-center text-red-500 text-sm">
                                    Failed to load PDF
                                </div>
                            }
                        >
                            <Page
                                key={`page-${displayPage}`}
                                pageNumber={displayPage}
                                width={baseWidth - 20}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                className="shadow-md"
                            />
                        </Document>
                    </div>
                </div>

                {/* Page navigation */}
                <div className={`flex items-center justify-between px-3 py-2 border-t
                        ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <button
                        onClick={() => goToPage(displayPage - 2)}
                        disabled={displayPage <= 1}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-1">
                        <input
                            type="number"
                            min={1}
                            max={pageCount}
                            value={displayPage}
                            onChange={(e) => {
                                const page = parseInt(e.target.value) || 1;
                                goToPage(page - 1);
                            }}
                            className={`w-12 px-2 py-1 text-center text-sm border rounded 
                         ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'dark:bg-gray-800 dark:border-gray-700'}`}
                        />
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>/ {pageCount}</span>
                    </div>

                    <button
                        onClick={() => goToPage(displayPage)}
                        disabled={displayPage >= pageCount}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Go to PDF button */}
                <button
                    onClick={() => onSwitchToPDF(displayPage - 1)}
                    className="m-2 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg 
                     font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                    <Maximize2 className="w-4 h-4" />
                    Open Full PDF
                </button>
            </div>
        </div>
    );
}