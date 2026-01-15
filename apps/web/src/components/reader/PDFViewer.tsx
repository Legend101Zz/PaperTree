'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { useReaderStore } from '@/store/readerStore';
import { Highlight } from '@/types';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
    const { settings, activeHighlightId, setActiveHighlight } = useReaderStore();

    // Adjust page width on container resize
    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                const width = Math.min(settings.pageWidth, containerRef.current.clientWidth - 48);
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

    const onDocumentLoadError = (error: Error) => {
        console.error('PDF load error:', error);
        setError('Failed to load PDF. Please try again.');
    };

    const handleMouseUp = useCallback((pageNumber: number) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!text || text.length < 3) return;

        // Get selection rectangles
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

    // Get highlights for a specific page
    const getPageHighlights = (pageNumber: number) => {
        return highlights.filter(
            h => h.mode === 'pdf' && h.page_number === pageNumber
        );
    };

    const getBackgroundColor = () => {
        switch (settings.theme) {
            case 'dark': return '#171717';
            case 'sepia': return '#f8f1e7';
            default: return '#ffffff';
        }
    };

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center p-6" style={{ backgroundColor: getBackgroundColor() }}>
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
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
            className="flex-1 overflow-auto p-6"
            style={{ backgroundColor: getBackgroundColor() }}
        >
            <Document
                file={fileUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                className="flex flex-col items-center gap-4"
                loading={
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    </div>
                }
                error={
                    <div className="text-red-500 p-4">
                        Failed to load PDF. Please check if the file exists.
                    </div>
                }
            >
                {numPages > 0 && Array.from(new Array(numPages), (_, index) => (
                    <div
                        key={`page_container_${index + 1}`}
                        className="relative shadow-lg"
                        style={{ backgroundColor: '#fff' }}
                    >
                        <Page
                            key={`page_${index + 1}`}
                            pageNumber={index + 1}
                            width={pageWidth}
                            onMouseUp={() => handleMouseUp(index + 1)}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                            className="relative"
                        />
                        {/* Render highlight overlays */}
                        {getPageHighlights(index + 1).map(highlight => (
                            highlight.rects?.map((rect, rectIdx) => (
                                <div
                                    key={`${highlight.id}-${rectIdx}`}
                                    className={`absolute pointer-events-auto cursor-pointer ${activeHighlightId === highlight.id
                                            ? 'bg-yellow-400/60 animate-pulse'
                                            : 'bg-yellow-300/40 hover:bg-yellow-400/50'
                                        }`}
                                    style={{
                                        left: `${rect.x * 100}%`,
                                        top: `${rect.y * 100}%`,
                                        width: `${rect.w * 100}%`,
                                        height: `${rect.h * 100}%`,
                                    }}
                                    onClick={() => setActiveHighlight(highlight.id)}
                                />
                            ))
                        ))}
                    </div>
                ))}
            </Document>

            {numPages > 0 && (
                <div className="text-center text-sm text-gray-500 mt-4">
                    {numPages} page{numPages !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}