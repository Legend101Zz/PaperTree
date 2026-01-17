// apps/web/src/components/reader/PDFViewer.tsx
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { useReaderStore } from '@/store/readerStore';
import { Highlight } from '@/types';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface PDFViewerProps {
    fileUrl: string;
    highlights: Highlight[];
    onTextSelect: (text: string, pageNumber: number, rects: any[]) => void;
}

export function PDFViewer({ fileUrl, highlights, onTextSelect }: PDFViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageWidth, setPageWidth] = useState(800);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const settings = useReaderStore((state) => state.settings);
    const activeHighlightId = useReaderStore((state) => state.activeHighlightId);
    const setActiveHighlight = useReaderStore((state) => state.setActiveHighlight);

    const invertPdf = settings.invertPdf;

    // Adjust page width on resize
    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                const width = Math.min(settings.pageWidth + 100, containerRef.current.clientWidth - 48);
                setPageWidth(width);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, [settings.pageWidth]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setError(null);
    };

    const handleMouseUp = useCallback((pageNumber: number) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!text || text.length < 3) return;

        const range = selection.getRangeAt(0);
        const rects = Array.from(range.getClientRects()).map(rect => ({
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height
        }));

        if (rects.length > 0) {
            onTextSelect(text, pageNumber, rects);
        }
    }, [onTextSelect]);

    const getPageHighlights = (pageNumber: number) => {
        return highlights.filter(h => h.mode === 'pdf' && h.page_number === pageNumber);
    };

    const getBgColor = () => {
        if (invertPdf) return '#111';
        switch (settings.theme) {
            case 'dark': return '#171717';
            case 'sepia': return '#f8f1e7';
            default: return '#f3f4f6';
        }
    };

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center p-6" style={{ backgroundColor: getBgColor() }}>
                <div className="text-center max-w-md">
                    <p className="text-red-500 font-medium mb-4">{error}</p>
                    <button
                        onClick={() => setError(null)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`flex-1 overflow-auto p-6 ${invertPdf ? 'pdf-inverted' : ''}`}
            style={{ backgroundColor: getBgColor() }}
        >
            <Document
                file={fileUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(e) => setError(`Failed to load PDF: ${e.message}`)}
                className="flex flex-col items-center gap-4"
                loading={
                    <div className="flex flex-col items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
                        <p className="text-gray-500">Loading PDF...</p>
                    </div>
                }
            >
                {numPages > 0 && Array.from({ length: numPages }, (_, index) => (
                    <div
                        key={`page_${index + 1}`}
                        className="relative shadow-lg"
                        style={{ backgroundColor: invertPdf ? '#1a1a1a' : 'white' }}
                    >
                        <Page
                            pageNumber={index + 1}
                            width={pageWidth}
                            onMouseUp={() => handleMouseUp(index + 1)}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                            loading={
                                <div className="flex items-center justify-center h-[800px] w-full bg-gray-100 dark:bg-gray-800">
                                    <div className="animate-pulse text-gray-400">Loading page {index + 1}...</div>
                                </div>
                            }
                        />

                        {/* Highlight overlays */}
                        {getPageHighlights(index + 1).map(highlight => (
                            highlight.rects?.map((rect, rectIdx) => (
                                <div
                                    key={`${highlight.id}-${rectIdx}`}
                                    className={`absolute pointer-events-auto cursor-pointer transition-colors ${activeHighlightId === highlight.id ? 'animate-pulse' : ''
                                        }`}
                                    style={{
                                        left: `${rect.x * 100}%`,
                                        top: `${rect.y * 100}%`,
                                        width: `${rect.w * 100}%`,
                                        height: `${rect.h * 100}%`,
                                        backgroundColor: activeHighlightId === highlight.id
                                            ? 'rgba(255, 213, 0, 0.6)'
                                            : 'rgba(255, 213, 0, 0.4)',
                                        filter: invertPdf ? 'invert(1) hue-rotate(180deg)' : 'none',
                                    }}
                                    onClick={() => setActiveHighlight(highlight.id)}
                                />
                            ))
                        ))}
                    </div>
                ))}
            </Document>

            {numPages > 0 && (
                <div className={`text-center text-sm mt-4 pb-4 ${invertPdf ? 'text-gray-400' : 'text-gray-500'}`}>
                    {numPages} page{numPages !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}