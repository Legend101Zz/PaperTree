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
    onCollapse: () => void;
}

export function PDFMinimap({ paperId, pageCount, onSwitchToPDF, onCollapse }: PDFMinimapProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [displayPage, setDisplayPage] = useState(1);

    const settings = useReaderStore((state) => state.settings);
    const currentPdfPage = useReaderStore((state) => state.currentPdfPage);
    const setMinimapWidth = useReaderStore((state) => state.setMinimapWidth);
    const setInvertMinimap = useReaderStore((state) => state.setInvertMinimap);
    const setCurrentPdfPage = useReaderStore((state) => state.setCurrentPdfPage);

    const pdfUrl = papersApi.getFileUrl(paperId);
    const isDark = settings.invertMinimap;
    const currentWidth = settings.minimapWidth;

    // Sync displayPage with store's currentPdfPage
    useEffect(() => {
        const newPage = Math.max(1, Math.min(pageCount, currentPdfPage + 1));
        if (newPage !== displayPage) {
            setDisplayPage(newPage);
        }
    }, [currentPdfPage, pageCount, displayPage]);

    // Handle page navigation
    const goToPage = useCallback((page: number) => {
        const validPage = Math.max(0, Math.min(pageCount - 1, page));
        setDisplayPage(validPage + 1);
        setCurrentPdfPage(validPage);
    }, [pageCount, setCurrentPdfPage]);

    // Handle resize drag on the left edge
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = currentWidth;

        const handleMouseMove = (e: MouseEvent) => {
            // Dragging left increases width, dragging right decreases
            const diff = startX - e.clientX;
            const newWidth = Math.max(200, Math.min(500, startWidth + diff));
            setMinimapWidth(newWidth);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [currentWidth, setMinimapWidth]);

    // Quick size presets
    const sizePresets = [
        { key: 'S', width: 220 },
        { key: 'M', width: 300 },
        { key: 'L', width: 400 },
    ];

    return (
        <div
            ref={containerRef}
            className="h-full flex"
            style={{ width: currentWidth }}
        >
            {/* Resize handle on the left */}
            <div
                onMouseDown={handleResizeStart}
                className="w-2 h-full cursor-ew-resize flex items-center justify-center
                   hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group flex-shrink-0"
            >
                <GripVertical className="w-3 h-3 text-gray-400 group-hover:text-blue-500" />
            </div>

            {/* Main panel content */}
            <div className={`flex-1 flex flex-col overflow-hidden min-w-0
                      ${isDark ? 'bg-gray-900' : 'bg-white dark:bg-gray-900'}`}>

                {/* Header */}
                <div className={`flex items-center justify-between px-3 py-2 border-b flex-shrink-0
                        ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                        <span className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : ''}`}>
                            Page {displayPage}/{pageCount}
                        </span>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Dark mode toggle */}
                        <button
                            onClick={() => setInvertMinimap(!isDark)}
                            className={`p-1.5 rounded transition-colors ${isDark
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                            title={isDark ? 'Light mode' : 'Dark mode'}
                        >
                            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        </button>

                        {/* Size presets */}
                        {sizePresets.map(({ key, width }) => (
                            <button
                                key={key}
                                onClick={() => setMinimapWidth(width)}
                                className={`w-6 h-6 text-xs rounded transition-colors ${Math.abs(currentWidth - width) < 30
                                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                title={`${key} size (${width}px)`}
                            >
                                {key}
                            </button>
                        ))}

                        {/* Expand to full PDF */}
                        <button
                            onClick={() => onSwitchToPDF(displayPage - 1)}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                            title="Open in PDF mode"
                        >
                            <Maximize2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Collapse */}
                        <button
                            onClick={onCollapse}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                            title="Hide preview"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* PDF Preview - scrollable */}
                <div className={`flex-1 overflow-auto p-2 min-h-0 ${isDark ? 'bg-gray-950' : 'bg-gray-100 dark:bg-gray-950'}`}>
                    <div className={`${isDark ? 'pdf-inverted' : ''}`}>
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
                                width={currentWidth - 20}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                className="shadow-md mx-auto"
                            />
                        </Document>
                    </div>
                </div>

                {/* Page navigation */}
                <div className={`flex items-center justify-between px-3 py-2 border-t flex-shrink-0
                        ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <button
                        onClick={() => goToPage(displayPage - 2)}
                        disabled={displayPage <= 1}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
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
                                ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white dark:bg-gray-800 dark:border-gray-700'}`}
                        />
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            / {pageCount}
                        </span>
                    </div>

                    <button
                        onClick={() => goToPage(displayPage)}
                        disabled={displayPage >= pageCount}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                {/* Open full PDF button */}
                <button
                    onClick={() => onSwitchToPDF(displayPage - 1)}
                    className="m-2 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg 
                        font-medium text-sm transition-colors flex items-center justify-center gap-2 flex-shrink-0"
                >
                    <Maximize2 className="w-4 h-4" />
                    Open Full PDF
                </button>
            </div>
        </div>
    );
}